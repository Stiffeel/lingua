/* ================= Yulengua · core ================= */
'use strict';

const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
};

const CFG_DEFAULT = {
  key: '', model: 'gpt-4.1', azKey: '', azReg: 'westeurope',
  modelBy: {},      // 按语言覆盖模型，留空则跟随全局；用来只给藏语这类语言上强模型
  corpusBy: {},     // 按语言覆盖「选材规则」提示词，留空则用内置的那一段
  voiceBy: {},      // 按语言指定朗读音色（存 voiceURI）；留空 = 交给系统。音色是设备相关的，不上云
  diff: {},         // 每种语言的难度微调，整数，0 = 基准
  boPron: '',       // 用户自定义的安多话注音标准（样例对照表）
  autoSpeak: false, // 场景对话自动朗读
  hand: true,       // 俄语/哈萨克语是否显示西里尔手写体那一行
  lastBackup: 0,    // 上次导出备份的时间戳
  cfgTs: 0,         // 设置最后一次修改的时间戳（云端合并用）
  lastCloud: 0,     // 上次云端同步成功的时间戳
  oss: null         // 阿里云 OSS：{ep,bucket,ak,sk,on,cache}。AccessKey 只存本机
};
const S = {
  cfg: Object.assign({}, CFG_DEFAULT, LS.get('lg.cfg', {})),
  cards: [],
  seen: {},         // 每种语言最近读过的句子（难度基准线）
  bo: {},           // 藏语发音库：归一化词 -> {w,p 注音,h 音频哈希,x 扩展名,ts}
  del: {},          // 卡片删除墓碑：'lang|front' -> 删除时间戳。没有它，删掉的卡会被云端复活
  pulse: {},        // Daily Pulse：{known:{lang:{词:ts}}, cur:{lang:[词]}, gl:{lang:{词:释义}}}
  trash: null,
  stack: [],
  store: 'ls'       // 'idb' | 'ls'
};
/* 三个「按语言」的字典字段：既补上缺失的，也【复制一份】。
   不复制的话，没存过设置时它们直接引用 CFG_DEFAULT 里的那个对象，
   一改就把默认值本身污染了，清空数据时反而恢复不回去。 */
function normCfg() {
  ['diff', 'modelBy', 'corpusBy', 'voiceBy'].forEach(k => {
    const v = S.cfg[k];
    S.cfg[k] = (v && typeof v === 'object' && !Array.isArray(v)) ? Object.assign({}, v) : {};
  });
}
normCfg();

/* ---------------- 本地存储：IndexedDB 为主，localStorage 兜底 ----------------
   iPhone 上两者都存在设备本地、不上云。选 IndexedDB 是因为 localStorage 在
   WebKit 上只有约 5 MB，而 IndexedDB 的配额是磁盘容量的一个百分比，且可以
   通过 navigator.storage.persist() 申请「持久化」，从而免于系统的存储回收。 */
const DB_NAME = 'yulengua', DB_STORE = 'kv';
let dbPromise = null;
function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((res, rej) => {
    if (!window.indexedDB) { rej(new Error('no-idb')); return; }
    let r;
    try { r = indexedDB.open(DB_NAME, 1); } catch (e) { rej(e); return; }
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains(DB_STORE)) d.createObjectStore(DB_STORE);
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error || new Error('idb-open'));
    r.onblocked = () => rej(new Error('idb-blocked'));
    setTimeout(() => rej(new Error('idb-timeout')), 6000);
  });
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
}
function idb(mode, fn) {
  return openDB().then(d => new Promise((res, rej) => {
    let tx;
    try { tx = d.transaction(DB_STORE, mode); } catch (e) { rej(e); return; }
    let out;
    try { out = fn(tx.objectStore(DB_STORE)); } catch (e) { rej(e); return; }
    tx.oncomplete = () => res(out && typeof out === 'object' && 'result' in out ? out.result : out);
    tx.onerror = () => rej(tx.error);
    tx.onabort = () => rej(tx.error);
  }));
}
const idbGet = k => idb('readonly', st => st.get(k));
const idbSet = (k, v) => idb('readwrite', st => { st.put(v, k); });

function lsWrite(key, val) {
  if (key === 'cards') LS.set('lg.cards', val);
  else if (key === 'del') LS.set('lg.del', val);
  else if (key === 'pulse') LS.set('lg.pulse', val);
  else if (key === 'cbmeta') LS.set('lg.cbmeta', val);
  else if (key === 'cfg') LS.set('lg.cfg', val);
  else if (key === 'bo') LS.set('lg.bo', val);
  else if (key === 'seen') LK.forEach(k => LS.set('lg.seen.' + k, val[k] || []));
}
function persistKey(key, val) {
  if (S.store === 'idb') {
    idbSet(key, val).catch(() => { S.store = 'ls'; try { lsWrite(key, val); } catch (e) {} });
  } else lsWrite(key, val);
}
/* quiet = true 表示这次写入本身就是云端同步的结果，不要再触发一次回传 */
const saveCards = q => { persistKey('cards', S.cards); persistKey('del', S.del); if (!q) cloudTouch(); };
const saveSeen = q => { persistKey('seen', S.seen); if (!q) cloudTouch(); };
const saveBo = q => { persistKey('bo', S.bo); if (!q) cloudTouch(); };
/* cfg 很小，额外在 localStorage 留一份镜像，保证首屏不用等 IndexedDB 就能读到设置 */
const saveCfg = q => {
  if (!q) S.cfg.cfgTs = Date.now();
  LS.set('lg.cfg', S.cfg); persistKey('cfg', S.cfg);
  if (!q) cloudTouch();
};

let persistState = 'unknown';
async function requestPersist() {
  try {
    if (!navigator.storage) { persistState = 'unsupported'; return; }
    if (navigator.storage.persisted && await navigator.storage.persisted()) { persistState = 'granted'; return; }
    if (navigator.storage.persist) persistState = (await navigator.storage.persist()) ? 'granted' : 'denied';
    else persistState = 'unsupported';
  } catch (e) { persistState = 'unsupported'; }
}
async function storageInfo() {
  let used = null, quota = null;
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const e = await navigator.storage.estimate();
      used = e.usage; quota = e.quota;
    }
  } catch (e) {}
  return { used: used, quota: quota, persist: persistState, store: S.store };
}
function fmtBytes(n) {
  if (n == null) return '未知';
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(0) + ' KB';
  if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB';
  return (n / 1073741824).toFixed(2) + ' GB';
}

async function loadAll() {
  try { await openDB(); S.store = 'idb'; } catch (e) { S.store = 'ls'; }

  if (S.store === 'idb') {
    try {
      const cfg = await idbGet('cfg');
      const cards = await idbGet('cards');
      const seen = await idbGet('seen');
      const bo = await idbGet('bo');
      const del = await idbGet('del');
      const pulse = await idbGet('pulse');
      const cbm = await idbGet('cbmeta');
      if (cbm && typeof cbm === 'object') CB.meta = cbm;
      if (bo && typeof bo === 'object') S.bo = bo;
      if (del && typeof del === 'object') S.del = del;
      if (pulse && typeof pulse === 'object') S.pulse = pulse;
      if (cfg) S.cfg = Object.assign({}, CFG_DEFAULT, cfg);
      normCfg();

      if (Array.isArray(cards)) S.cards = cards;
      else {                                    // 首次运行：从 localStorage 迁移
        const old = LS.get('lg.cards', null);
        S.cards = Array.isArray(old) ? old : [];
        await idbSet('cards', S.cards);
      }
      if (seen && typeof seen === 'object') S.seen = seen;
      else {
        const o = {};
        LK.forEach(k => { const v = LS.get('lg.seen.' + k, null); if (Array.isArray(v)) o[k] = v; });
        S.seen = o;
        await idbSet('seen', o);
      }
      if (!cfg) await idbSet('cfg', S.cfg);
      /* 迁移完成后清掉 localStorage 里的大块数据，把那 5 MB 让出来 */
      try {
        localStorage.removeItem('lg.cards');
        LK.forEach(k => localStorage.removeItem('lg.seen.' + k));
      } catch (e) {}
    } catch (e) { S.store = 'ls'; }
  }
  if (S.store === 'ls') {
    S.cards = LS.get('lg.cards', []);
    S.bo = LS.get('lg.bo', {}) || {};
    S.del = LS.get('lg.del', {}) || {};
    S.pulse = LS.get('lg.pulse', {}) || {};
    CB.meta = LS.get('lg.cbmeta', {}) || {};
    S.seen = {};
    LK.forEach(k => { S.seen[k] = LS.get('lg.seen.' + k, []); });
  }
  if (!Array.isArray(S.cards)) S.cards = [];
  if (!S.seen || typeof S.seen !== 'object') S.seen = {};
  if (!S.bo || typeof S.bo !== 'object') S.bo = {};
  if (!S.del || typeof S.del !== 'object') S.del = {};
  pruneDel();
  prunePulse();
  /* 老卡片的内联详解搬进正文存储；下一次云端同步会把它们传上去 */
  const legacy = S.cards.some(c => typeof c.detail === 'string' || 'added' in c);
  S.cards.forEach(cardSlim);
  /* 索引里已经没有的卡，本机的正文缓存也不用留了 */
  const live = new Set(S.cards.map(c => c.id));
  Object.keys(CB.meta).forEach(id => { if (!live.has(id)) cbDrop(id); });
  if (normCards() || legacy) saveCards(legacy ? false : true);
  requestPersist();
}

/* ---------------- 删除墓碑 ----------------
   「本地没有这张卡」有两种截然不同的含义：从来没有过，或者是我刚删掉的。
   云端合并里分不清这两者，删掉的卡就会在下一次同步时原样长回来。
   所以删除必须留痕：记下 'lang|front' 和删除时间，只有比墓碑更新的远端版本才准复活。 */
const cardKey = c => (c.lang || '') + '|' + (c.front || '');
const DEL_KEEP = 180 * 86400000;                // 墓碑保留 180 天，之后自然淡出
function pruneDel() {
  const cut = Date.now() - DEL_KEEP;
  Object.keys(S.del).forEach(k => { if (!(S.del[k] > cut)) delete S.del[k]; });
}
function markDel(c) { S.del[cardKey(c)] = Date.now(); }
function unmarkDel(c) { delete S.del[cardKey(c)]; }

/* ---------------- 卡片排序 ----------------
   排列顺序用单独的 pos（越大越靠前），不能拿 ts 排：ts 是云端合并用的「最后修改时间」，
   勾一下「已添加」、移一下位置都会变；拿它排序的话，勾一下就会跳到最前面。
   新卡 pos = 创建时刻；重新保存同一句 pos = 现在（回到最前）；「移到最后」压到全库最小值以下。 */
const cardPos = c => (c && c.pos != null) ? c.pos : ((c && c.ts) || 0);
const byPos = (a, b) => cardPos(b) - cardPos(a);
/* 创建时间：新卡存在 ct 里；老卡没有，就从 id（'c' + 毫秒时间戳 + 随机串）里还原 */
function cardCreated(c) {
  if (c.ct) return c.ct;
  const m = /^c(\d{13})/.exec(c.id || '');
  return m ? +m[1] : (c.ts || 0);
}
/* 老卡没有 pos：按【现在的显示顺序】补上，一张都不挪位置 */
function normCards() {
  if (!S.cards.some(c => c.pos == null)) return false;
  if (S.cards.every(c => c.pos == null)) {
    const top = Math.max(Date.now() - 1000, ...S.cards.map(c => c.ts || 0));
    S.cards.forEach((c, i) => { c.pos = top - i; });
  } else {
    S.cards.forEach(c => { if (c.pos == null) c.pos = c.ts || cardCreated(c); });
    S.cards.sort(byPos);
  }
  return true;
}

/* ---------------- 卡片正文：云端为准，本机只留一小撮缓存 ----------------
   S.cards 只是索引（原文、语言、时间、排序、正文版本 bv），每张几十字节，随 data.json 同步；
   翻译 + 详解 + 追问（正文 {d, n, bv}）单独存成云端 cards/<id>.json，展开卡片时才取。
   本机缓存只留最近用过的 CB_KEEP 张【已确认传上云端】的；还没传上去的（或没开云端的）
   本机这份就是唯一的一份，永远不回收。
   bv = 正文最后一次被编辑的时间。不能拿 ts 比：ts 还会因为「移到最后」而变，
   那会让本机缓存白白失效。缓存的 bv 和索引的 bv 不一致 = 缓存是旧的。 */
const CB_KEEP = 30;
const CB = { meta: {}, busy: new Map() };          // meta: id -> {bv, at 最近使用, up 云端是否已有这一版}
const cbKey = id => 'cards/' + id + '.json';
const cbRawGet = id => S.store === 'idb' ? idbGet('cb:' + id).catch(() => null) : Promise.resolve(LS.get('lg.cb.' + id, null));
const cbRawSet = (id, b) => S.store === 'idb' ? idbSet('cb:' + id, b).catch(() => {}) : Promise.resolve(LS.set('lg.cb.' + id, b));
const cbRawDel = id => S.store === 'idb'
  ? idb('readwrite', st => { st.delete('cb:' + id); }).catch(() => {})
  : Promise.resolve((() => { try { localStorage.removeItem('lg.cb.' + id); } catch (e) {} })());
const saveCbMeta = () => persistKey('cbmeta', CB.meta);

/* 同步登记 meta，落盘是异步的（IndexedDB 按事务顺序执行，紧跟着读也读得到） */
function cbPut(id, b, up) {
  CB.meta[id] = { bv: b.bv, at: Date.now(), up: !!up };
  cbRawSet(id, { d: b.d || '', n: b.n || '', bv: b.bv });
  cbEvict();
  saveCbMeta();
}
function cbDrop(id) { delete CB.meta[id]; cbRawDel(id); saveCbMeta(); }
function cbEvict() {
  const ids = Object.keys(CB.meta).filter(id => CB.meta[id].up);
  if (ids.length <= CB_KEEP) return;
  ids.sort((a, b) => CB.meta[a].at - CB.meta[b].at).slice(0, ids.length - CB_KEEP).forEach(id => {
    delete CB.meta[id]; cbRawDel(id);
  });
}

/* 取一张卡的正文：本机缓存版本对得上就用，否则去云端拿 */
async function cbLoad(c) {
  const m = CB.meta[c.id];
  if (m && m.bv === c.bv) {
    const b = await cbRawGet(c.id);
    if (b) { m.at = Date.now(); return b; }
  }
  if (CB.busy.has(c.id)) return CB.busy.get(c.id);
  const p = (async () => {
    if (!ossReady()) throw new Error('云端没有启用，本机也没有这张卡的详解');
    let j;
    try { j = JSON.parse(await ossGetText(cbKey(c.id))); }
    catch (e) {
      if (e.code === 'NoSuchKey') throw new Error('云端还没有这张卡的详解（另一台设备可能还没传完，稍后再试）');
      throw new Error(ossHint(e));
    }
    const b = { d: String(j.d || ''), n: String(j.n || ''), bv: j.bv || c.bv };
    cbPut(c.id, b, true);
    return b;
  })();
  CB.busy.set(c.id, p);
  try { return await p; } finally { CB.busy.delete(c.id); }
}

/* 老版本把正文直接内联在卡片的 detail 里（连同「已添加」勾选）：搬进正文存储，
   索引里只留轻量字段。本机老数据、云端老 data.json、老备份文件都走这里。 */
function cardSlim(c) {
  if (typeof c.detail === 'string') {
    c.bv = c.bv || c.ts || cardCreated(c) || Date.now();
    cbPut(c.id, { d: c.detail, n: c.notes || '', bv: c.bv }, false);
  }
  delete c.detail; delete c.notes; delete c.added;
  return c;
}
/* 本机缓存里已经过期的那一份（远端换了一版正文）要扔掉，除非它还没传上去 */
function cbStale(mine, next) {
  const m = CB.meta[mine.id];
  if (m && m.up && (mine.id !== next.id || m.bv !== next.bv)) cbDrop(mine.id);
}

async function exportBackup() {
  /* 备份文件是「删掉图标后重装」的唯一退路，所以连同 Key 一起导出。
     文件里含密钥，别随手转发给别人。云端的 data.json 则永远不含 Key。
     卡片正文大多不在本机，要先逐张取回来（6 路并发），否则备份里只有一个空壳索引。 */
  const bodies = {}, miss = [];
  if (S.cards.length) toast('正在收集卡片详解…');
  let next = 0;
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (next < S.cards.length) {
      const c = S.cards[next++];
      try { bodies[c.id] = await cbLoad(c); } catch (e) { miss.push(c.front); }
    }
  }));
  if (miss.length && !confirm(miss.length + ' 张卡片的详解没取到（云端未连通？），备份里这些卡只有原文。\n仍要导出吗？')) return;
  const data = { app: 'yulengua', v: 3, ts: Date.now(), cfg: S.cfg, cards: S.cards, bodies: bodies, seen: S.seen, bo: S.bo, del: S.del, pulse: S.pulse };
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'yulengua-backup-' + new Date().toISOString().slice(0, 10) + '.json';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  S.cfg.lastBackup = Date.now(); saveCfg();
  if (typeof paintStorage === 'function') paintStorage();
  toast('已导出 ' + S.cards.length + ' 张卡片');
}
function importBackup(input) {
  const f = input.files && input.files[0];
  if (!f) return;
  const rd = new FileReader();
  rd.onload = () => {
    try {
      const d = JSON.parse(rd.result);
      if (!d || !Array.isArray(d.cards)) throw new Error('不是 Yulengua 备份文件');
      if (!confirm('导入 ' + d.cards.length + ' 张卡片？\n同一句子的卡片会被备份里的版本覆盖，其余保留。')) return;
      const m = new Map(S.cards.map(c => [c.lang + '|' + c.front, c]));
      /* 备份里明确带回来的卡，就是用户想要的，清掉它的删除墓碑 */
      d.cards.forEach(c => {
        if (!c || !c.front) return;
        /* 新备份把正文放在 bodies 里，老备份内联在 detail 里（cardSlim 处理） */
        const bd = d.bodies && d.bodies[c.id];
        if (bd && typeof c.detail !== 'string') {
          c.bv = c.bv || bd.bv || c.ts || Date.now();
          cbPut(c.id, { d: bd.d, n: bd.n, bv: c.bv }, false);
        }
        cardSlim(c);
        if (!c.bv) c.bv = c.ts || Date.now();
        m.set(c.lang + '|' + c.front, c); unmarkDel(c);
      });
      if (d.del && typeof d.del === 'object') {
        Object.keys(d.del).forEach(k => {
          if (!m.has(k) && (d.del[k] || 0) > (S.del[k] || 0)) S.del[k] = d.del[k];
        });
      }
      S.cards = Array.from(m.values()).sort(byPos);
      normCards();
      if (d.seen && typeof d.seen === 'object') S.seen = Object.assign({}, S.seen, d.seen);
      if (d.bo && typeof d.bo === 'object') {
        Object.keys(d.bo).forEach(k => {
          const r = d.bo[k], mine = S.bo[k];
          if (r && (!mine || (r.ts || 0) > (mine.ts || 0))) S.bo[k] = r;
        });
      }
      if (d.pulse && typeof d.pulse === 'object') { S.pulse = d.pulse; pulseState(); savePulse(true); }
      if (d.cfg) {
        /* 备份里若没带密钥（老版本或手工删过），保留本机现有的，别把它清空 */
        const keep = { key: S.cfg.key, azKey: S.cfg.azKey, oss: S.cfg.oss };
        S.cfg = Object.assign({}, CFG_DEFAULT, d.cfg);
        normCfg();
        if (!S.cfg.key) S.cfg.key = keep.key;
        if (!S.cfg.azKey) S.cfg.azKey = keep.azKey;
        if (!S.cfg.oss || !S.cfg.oss.sk) S.cfg.oss = keep.oss;
        saveCfg();
      }
      saveCards(); saveSeen(); saveBo();
      render(); toast('已导入，现有 ' + S.cards.length + ' 张卡片');
    } catch (e) { toast('导入失败 · ' + e.message); }
  };
  rd.readAsText(f);
  input.value = '';
}

/* ---------------- languages ---------------- */
const LANGS = {
  nl: {
    zh: '荷兰语', native: 'Nederlands', code: 'NL', tts: 'nl-NL', gram: true, en: true,
    level: '初中级', dialogue: '初级',
    corpus: '真实感的初中级荷兰语新闻标题/导语、广告文案、记叙文片段。风格贴近 NOS.nl、nu.nl、AD 的短句，或日常广告与生活叙事。句子长度 6–16 词，可含从句、过去时、完成时、可分动词、被动语态等初中级语法点。陈述句、疑问句、肯定句、否定句均可。',
    sample: 'Hij is met een mes naar agenten gelopen.\nDe Europese Commissie geeft Google twee boetes: 890 miljoen euro.'
  },
  bo: {
    zh: '标准安多藏语', native: 'ཨ་མདོའི་སྐད།', code: 'BO', tts: null, translit: true, en: false,
    level: '入门初级', dialogue: null,
    corpus: '入门初级的标准安多藏语短句（类似青海人民广播电台安多语广播使用的通用安多口语，而非拉萨话、也不是古典书面藏文）。内容围绕日常生活、家庭、学习、工作、社会常识。句子 4–10 个音节组，语法简单，陈述句、疑问句、肯定句、否定句均可。',
    sample: 'མོའི་བུ་མོ་སློབ་ཆུང་ལ་འགྲོ་གི་ཡོད།\nམོའི་ཁྱོ་ག་གཞུང་ཞབས་པ་རེད།'
  },
  kk: {
    zh: '哈萨克语', native: 'Қазақ тілі', code: 'KK', tts: 'api', dual: true, en: false,
    level: '入门初级', dialogue: null,
    corpus: '入门初级的哈萨克语短句，内容围绕日常生活、家庭、饮食、习俗与文化。句子 4–10 词，语法简单（现在时、疑问助词 ба/бе/ма/ме、领属人称、格变化等基础点）。陈述句、疑问句、肯定句、否定句均可。',
    sample: 'Оның әкесі — ханзу.\nСіз шай ішесіз бе, әлде кофе ішесіз бе?'
  },
  ru: {
    zh: '俄语', native: 'Русский', code: 'RU', tts: 'ru-RU', gram: true, en: true, translit: true,
    level: '入门初级', dialogue: null,
    corpus: '入门初级的俄语短句，内容围绕日常生活、学习、家庭、城市与文化。句子 4–12 词，语法控制在：现在时与常用过去时、名词的主格/宾格/属格/前置格、形容词性数一致、常见动词变位与运动动词入门。陈述句、疑问句、肯定句、否定句均可。',
    sample: 'Меня́ зову́т А́нна. Я студе́нтка из Кита́я.\nГде здесь ближа́йшая ста́нция метро́?'
  },
  es: {
    zh: '西班牙语', native: 'Español', code: 'ES', tts: 'es-ES', gram: true, en: true,
    level: '中级', dialogue: '初中级',
    corpus: '真实感的中级西班牙语内容：新闻报道、记叙文、个人叙述、观点评论均可。风格贴近 El País、BBC Mundo，或个人随笔。句子 12–40 词，可含虚拟式、复合时态、连接词等中级语法点。陈述句、疑问句、肯定句、否定句、复合句均可。',
    sample: 'Últimamente estoy aprendiendo tibetano. Aunque mis estudios me generan bastante presión, quiero seguir haciendo cosas que me interesan para darle más sentido a mi vida.'
  },
  ja: {
    zh: '日语', native: '日本語', code: 'JA', tts: 'ja-JP', translit: true, en: false,
    level: '入门初级', dialogue: '初级',
    corpus: '入门初级（N5–N4 相当）的日语短句，内容围绕日常生活与文化。使用常用汉字并控制难度，句子 6–20 字。陈述句、疑问句、肯定句、否定句均可。',
    sample: '私はヨーロッパに留学している中国人学生です。\nすみません、一番近い地下鉄の駅はどこですか？'
  }
};
const LK = ['nl', 'bo', 'kk', 'ru', 'es', 'ja'];

/* 「选材规则」那段提示词决定了例句长什么样。内置的那份是默认值，
   设置里改过之后走 corpusBy 的覆盖值；留空 = 恢复内置。 */
function corpusFor(k) {
  const v = S.cfg.corpusBy && S.cfg.corpusBy[k];
  const t = String(v == null ? '' : v).trim();
  return t || (LANGS[k] ? LANGS[k].corpus : '');
}
const corpusEdited = k => corpusFor(k) !== (LANGS[k] ? LANGS[k].corpus : '');
const scriptCls = k => k === 'bo' ? 'tb' : (k === 'ja' ? 'jp' : '');

/* ---------------- 西里尔手写体 ----------------
   只是换一套字体，不改一个字符。俄语手写体和印刷体的字形差得很远
   （т 写成 m、д 写成 g、и 写成 u、п 写成 n），不专门看是认不出来的。
   哈萨克语西里尔同理。字体已内嵌，见 build/fonts.py。 */
const HAND_LANGS = { ru: 1, kk: 1 };
const hasHand = k => !!(HAND_LANGS[k] && S.cfg.hand);
function handHtml(k, text, small) {
  if (!hasHand(k) || !/[Ѐ-ӿ]/.test(String(text || ''))) return '';
  return '<div class="handlb">手写体</div><div class="hand' + (small ? ' sm' : '') + '">' + esc(text) + '</div>';
}

/* ================= 哈萨克语：西里尔 → 新疆哈萨克文（töte jazu）=================
   纯算法转换，不经过 AI。托特文正字法的关键规则：
   1. 前元音 ә/ө/ү/і 与后元音 а/о/ұ/ы 共用同一个字母（ا و ۇ ى），
      靠词首的软音符 ٴ (U+0674) 标记整个词读前元音；
   2. 若词中已含 е/э（ە）或 к/г（ك گ），前元音身份已经确定，就不写软音符；
   3. ъ/ь 不写。
   转换结果已与另一套独立实现做过差分验证，并有 29 个已知词形的定点断言。 */
const KK_C2A = {
  'а': 'ا', 'ә': 'ا', 'б': 'ب', 'в': 'ۆ', 'г': 'گ', 'ғ': 'غ', 'д': 'د', 'е': 'ە', 'ё': 'يو',
  'ж': 'ج', 'з': 'ز', 'и': 'ي', 'й': 'ي', 'к': 'ك', 'қ': 'ق', 'л': 'ل', 'м': 'م', 'н': 'ن',
  'ң': 'ڭ', 'о': 'و', 'ө': 'و', 'п': 'پ', 'р': 'ر', 'с': 'س', 'т': 'ت', 'у': 'ۋ', 'ұ': 'ۇ',
  'ү': 'ۇ', 'ф': 'ف', 'х': 'ح', 'һ': 'ھ', 'ц': 'تس', 'ч': 'چ', 'ш': 'ش', 'щ': 'شش',
  'ъ': '', 'ы': 'ى', 'і': 'ى', 'ь': '', 'э': 'ە', 'ю': 'يۋ', 'я': 'يا'
};
const KK_C2L = {
  'а': 'a', 'ә': 'ä', 'б': 'b', 'в': 'v', 'г': 'g', 'ғ': 'ğ', 'д': 'd', 'е': 'e', 'ё': 'yo',
  'ж': 'j', 'з': 'z', 'и': 'ï', 'й': 'y', 'к': 'k', 'қ': 'q', 'л': 'l', 'м': 'm', 'н': 'n',
  'ң': 'ñ', 'о': 'o', 'ө': 'ö', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u', 'ұ': 'ū',
  'ү': 'ü', 'ф': 'f', 'х': 'h', 'һ': 'h', 'ц': 'ts', 'ч': 'ç', 'ш': 'ş', 'щ': 'şş',
  'ъ': '', 'ы': 'ı', 'і': 'i', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya'
};
const KK_THIN = 'әөүі';       // 前元音，需要软音符
const KK_IMPLICIT = 'еэкг';   // 出现即可判定为前元音词，无需软音符
const KK_HAMZA = 'ٴ';
const KK_CYR_WORD = /[Ѐ-ԯ]+/g;

function kkMapWord(w, table, useHamza) {
  const low = w.toLowerCase();
  let out = '';
  for (const ch of low) out += (table[ch] !== undefined ? table[ch] : ch);
  if (!useHamza) return out;
  const cs = Array.from(low);
  const need = cs.some(c => KK_THIN.indexOf(c) > -1) && !cs.some(c => KK_IMPLICIT.indexOf(c) > -1);
  return (need ? KK_HAMZA : '') + out;
}
const kkArab = t => String(t == null ? '' : t).replace(KK_CYR_WORD, w => kkMapWord(w, KK_C2A, true));
const kkLat = t => String(t == null ? '' : t).replace(KK_CYR_WORD, w => kkMapWord(w, KK_C2L, false));
const hasCyr = t => /[Ѐ-ԯ]/.test(String(t == null ? '' : t));

/* 详解后处理：让每一处哈萨克语都同时有西里尔和托特文两种写法。
   连续的西里尔词（只以单个空格相连）作为一个整体转换；绝不跨行、
   也不越过标点，否则会把答案线 --- 一起吞进括号里。 */
const KK_RUN = /[Ѐ-ԯ]+(?:[-'’][Ѐ-ԯ]+)*(?: [Ѐ-ԯ]+(?:[-'’][Ѐ-ԯ]+)*)*/g;

function kkDualInline(t) {
  return t.replace(KK_RUN, (run, off, whole) => {
    const after = whole.slice(off + run.length);
    if (/^\s*（\s*[؀-ۿٴ]/.test(after)) return run;   // 已经并排过
    return run + '（' + kkArab(run) + '）';
  });
}
/* 答案线之前的原句独占一行，托特文另起一行写，比塞进括号好读 */
function kkDualHead(head) {
  const lines = head.split('\n');
  for (let n = lines.length - 1; n >= 0; n--) {
    if (hasCyr(lines[n])) { lines.splice(n + 1, 0, kkArab(lines[n])); break; }
  }
  return lines.join('\n');
}
function kkDual(text) {
  const src = String(text == null ? '' : text);
  const i = src.search(/^---[ \t]*$/m);
  if (i < 0) return kkDualInline(src);
  return kkDualHead(src.slice(0, i)) + kkDualInline(src.slice(i));
}

/* 逐字母对照表：完全本地生成，不依赖 AI */
function kkLetterRows(word) {
  const rows = [];
  Array.from(String(word || '').toLowerCase()).forEach(ch => {
    if (!/[Ѐ-ԯ]/.test(ch)) return;
    const ar = KK_C2A[ch];
    if (ar === undefined) return;
    let note = '';
    if (ar === '') note = '不单独书写';
    else if (ar.length > 1) note = '写作两个字母的组合';
    else if (KK_THIN.indexOf(ch) > -1) note = '与其后元音共用同一字母，靠词首软音符 ٴ 区分';
    rows.push({ cy: ch, ar: ar, lat: KK_C2L[ch] || '', note: note });
  });
  return rows;
}

/* ================= 俄语：西里尔 → 拉丁注音 =================
   显示出来的西里尔一律不带重音符号；重音只体现在拉丁注音上。
   模型负责告诉我们重音在哪（在西里尔里加 U+0301），字母转换和
   锐音符的落位都由这里的算法完成。 */
const RU_C2L = {
  'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'yo', 'ж': 'zh', 'з': 'z',
  'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r',
  'с': 's', 'т': 't', 'у': 'u', 'ф': 'f', 'х': 'kh', 'ц': 'ts', 'ч': 'ch', 'ш': 'sh', 'щ': 'shch',
  'ъ': '', 'ы': 'y', 'ь': '’', 'э': 'e', 'ю': 'yu', 'я': 'ya'
};
const RU_ACUTE = { a: 'á', e: 'é', i: 'í', o: 'ó', u: 'ú', y: 'ý' };
const COMB_ACUTE = '́';

function ruMarkAcute(lat) {
  for (let i = lat.length - 1; i >= 0; i--) {
    const c = lat.charAt(i).toLowerCase();
    if (RU_ACUTE[c]) {
      const up = lat.charAt(i) !== c;
      return lat.slice(0, i) + (up ? RU_ACUTE[c].toUpperCase() : RU_ACUTE[c]) + lat.slice(i + 1);
    }
  }
  return lat;
}
function ruLatWord(w) {
  const cs = Array.from(w);
  let out = '';
  for (let i = 0; i < cs.length; i++) {
    const ch = cs[i];
    if (ch === COMB_ACUTE) continue;
    const low = ch.toLowerCase();
    let lat = RU_C2L[low];
    if (lat === undefined) { out += ch; continue; }
    if (lat && ch !== low) lat = lat.charAt(0).toUpperCase() + lat.slice(1);
    if (lat && (cs[i + 1] === COMB_ACUTE || low === 'ё')) lat = ruMarkAcute(lat);
    out += lat;
  }
  return out;
}
const RU_WORDRUN = /[Ѐ-ԯ́]+/g;
const ruLat = t => String(t == null ? '' : t).replace(RU_WORDRUN, ruLatWord);
const ruPlain = t => String(t == null ? '' : t).replace(/́/g, '');

/* 详解后处理：去掉西里尔上的重音符号，并在后面补一份拉丁注音 */
const RU_RUN = /[Ѐ-ԯ́]+(?:[-’'][Ѐ-ԯ́]+)*(?: [Ѐ-ԯ́]+(?:[-’'][Ѐ-ԯ́]+)*)*/g;
function ruDualInline(t) {
  return t.replace(RU_RUN, (run, off, whole) => {
    const after = whole.slice(off + run.length);
    if (/^\s*（\s*[A-Za-zÀ-ɏ]/.test(after)) return run;
    return ruPlain(run) + '（' + ruLat(run) + '）';
  });
}
function ruDualHead(head) {
  const lines = head.split('\n');
  for (let n = lines.length - 1; n >= 0; n--) {
    if (/[Ѐ-ԯ]/.test(lines[n])) {
      lines[n] = ruPlain(lines[n]);
      lines.splice(n + 1, 0, ruLat(lines[n]));
      break;
    }
  }
  return lines.join('\n');
}
function ruDual(text) {
  const src = String(text == null ? '' : text);
  const i = src.search(/^---[ \t]*$/m);
  if (i < 0) return ruDualInline(src);
  return ruDualHead(src.slice(0, i)) + ruDualInline(src.slice(i));
}

/* ================= 墨墨记忆卡语法检查与自动修复 =================
   规则来自墨墨官方语法文档：
   [T#样式#内容]  样式可组合：B 粗 / U 下划线 / I 斜 / D 删除线 / up 上标 / down 下标
                  / !rrggbb 字色 / !!rrggbb 背景色，用逗号分隔
   [F##内容]      文字挖空
   [P#样式#内容]  段落， [Pic#ID/xx#] 图片， [Audio#A,ID/xx#] 音频
   [E##LaTeX]     公式， [Card#ID/xx#文字] 卡片引用
   ---            答案线，单卡最多 9 条
   关键坑：标记内容里出现 ] 会提前终止标记；标记不能跨行；不支持 markdown。 */
const MJ_TYPES = 'T|P|F|Pic|Audio|E|Choice|Card';
const MJ_STYLE_WORD = /^(B|U|I|D|up|down)$/;
const MJ_STYLE_COLOR = /^!!?[0-9a-fA-F]{3,8}$/;
const MJ_STYLE_LINK = /^link\/".*"$/;

function markjiLint(src) {
  let t = String(src == null ? '' : src);
  const fixed = [], warn = [];

  /* 1. markdown 残留 —— 墨墨不认 markdown */
  if (/^\s*```/m.test(t)) { t = t.replace(/^\s*```.*$/gm, ''); fixed.push('删掉了 ``` 代码围栏'); }
  if (/^\s{0,3}#{1,6}\s+\S/m.test(t)) { t = t.replace(/^(\s{0,3})#{1,6}\s+/gm, '$1'); fixed.push('去掉了 markdown 标题的 #'); }
  if (/\*\*[^*\n]+\*\*/.test(t)) { t = t.replace(/\*\*([^*\n]+)\*\*/g, '[T#B#$1]'); fixed.push('把 **加粗** 换成了 [T#B#…]'); }

  /* 2. 逐个标记检查 */
  const open = new RegExp('\\[(' + MJ_TYPES + ')#', 'g');
  let m, out = '', last = 0;
  while ((m = open.exec(t))) {
    const start = m.index, type = m[1], bodyFrom = m.index + m[0].length;
    const close = t.indexOf(']', bodyFrom);
    const nl = t.indexOf('\n', bodyFrom);

    if (close === -1 || (nl !== -1 && nl < close)) {   // 未闭合或跨行
      const end = nl === -1 ? t.length : nl;
      out += t.slice(last, end) + ']';
      last = end;
      fixed.push('补上了未闭合的 [' + type + '#…');
      open.lastIndex = end;
      continue;
    }

    let body = t.slice(bodyFrom, close);
    let style = '', content = body;
    if (type === 'T' || type === 'P' || type === 'F' || type === 'E' || type === 'Choice') {
      const hash = body.indexOf('#');
      if (hash === -1) {
        warn.push('[' + type + '#' + body.slice(0, 20) + '] 缺少第二个 #，格式应为 [' + type + '#样式#内容]');
        out += t.slice(last, close + 1); last = close + 1; continue;
      }
      style = body.slice(0, hash);
      content = body.slice(hash + 1);
    }

    let newStyle = style, changed = false;
    if (type === 'T' || type === 'P') {
      const toks = style.split(',').filter(x => x !== '');
      const okToks = [];
      toks.forEach(tk => {
        if (MJ_STYLE_WORD.test(tk) || MJ_STYLE_LINK.test(tk) || /^(H1|H2|H3|center|right|L)$/.test(tk)) { okToks.push(tk); return; }
        if (MJ_STYLE_COLOR.test(tk)) {
          const bang = tk.startsWith('!!') ? '!!' : '!';
          let hex = tk.slice(bang.length);
          if (hex.length === 3) { hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2]; changed = true; }
          if (hex.length === 8) { hex = hex.slice(0, 6); changed = true; }
          if (hex.length !== 6) { warn.push('颜色值 ' + tk + ' 不是 6 位十六进制'); okToks.push(tk); return; }
          okToks.push(bang + hex.toLowerCase());
          if (hex !== hex.toLowerCase()) changed = true;
          return;
        }
        warn.push('样式 “' + tk + '” 不是墨墨支持的写法（可用 B/U/I/D/up/down/!色值/!!色值）');
        okToks.push(tk);
      });
      newStyle = okToks.join(',');
      if (newStyle !== style) changed = true;
    }

    if (!content.trim() && type !== 'Pic' && type !== 'Audio') {
      warn.push('[' + type + '#' + style + '#] 里没有内容');
    }

    out += t.slice(last, start) + '[' + type + '#' + (type === 'F' ? '#' : (style === body ? '' : newStyle + '#')) + content + ']';
    if (changed) fixed.push('修正了颜色/样式写法');
    last = close + 1;
    open.lastIndex = close + 1;
  }
  out += t.slice(last);
  t = out;

  /* 3. 内容里裸露的 ] —— 会提前截断标记 */
  const strays = [];
  t.split('\n').forEach((line, i) => {
    let depth = 0;
    for (let c = 0; c < line.length; c++) {
      if (line[c] === '[') depth++;
      else if (line[c] === ']') { if (depth === 0) strays.push(i + 1); else depth--; }
    }
    if (depth > 0) strays.push(i + 1);
  });
  if (strays.length) warn.push('第 ' + Array.from(new Set(strays)).join('、') + ' 行有多余或不配对的方括号，墨墨会在这里提前截断标记');

  /* 4. 答案线：墨墨单卡最多 9 条；本应用的卡片只应有 1 条 */
  const lines = t.split('\n');
  let seen = 0, extra = 0;
  for (let i = 0; i < lines.length; i++) {
    if (/^---[ \t]*$/.test(lines[i])) {
      seen++;
      if (seen > 1) { lines[i] = '———'; extra++; }
    }
  }
  if (extra) { t = lines.join('\n'); fixed.push('把多出来的 ' + extra + ' 条答案线改成了普通分隔线（墨墨会把每条 --- 当成一个答案面）'); }

  return { text: t, fixed: fixed, warn: warn, ok: warn.length === 0 };
}

/* ---------------- dom helpers ---------------- */
const $ = id => document.getElementById(id);
const app = () => $('app');
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

/* 墨墨的标记只该出现在卡片正文里。模型偶尔会把 [T#!!fedcb6#het-woord] 这种
   写进 JSON 字段，那些字段是直接显示在界面上的，标记既不会被渲染、又很难看。
   这里做一层兜底剥离：只留内容，丢掉标记外壳。 */
function unmark(s) {
  let t = String(s == null ? '' : s);
  for (let i = 0; i < 3 && /\[(T|P|F|E|Choice)#/.test(t); i++) {
    t = t.replace(/\[(?:T|P|F|E|Choice)#[^#\]]*#([^\]]*)\]/g, '$1');
  }
  return t.replace(/\[(?:Pic|Audio|Card)#[^\]]*\]/g, '').trim();
}
/* 显示用：先剥标记再转义 */
const escp = s => esc(unmark(s));

/* ================= 分词修复 =================
   句子里的 tokens 是模型给的，实测经常出错：
   · 把两个词并进同一项 —— 点开只查得到前面那个词
   · 整句只返回一个 token —— 根本点不开单个词
   原句 text 本身是可信的，所以这里不信任模型的切分，改成本地确定性校准：
   · 有空格的语言（荷/西/俄/哈）——空格一定是词边界，模型跨过空格的 token 一律拆开
   · 日语 / 藏语没有空格——先按本地规则算出「单元」（藏文按音节点、日语按字种），
     一个 token 覆盖的单元数超过上限就判定为合并错误，按单元拆开
   拆开时把原来的词义给最长的那一段，其余留空——留空的词点开仍然可以展开详解，
   总好过点不动。 */
const TOK_PUNCT = /^[\s.,!?;:«»""''()\[\]—–·¿¡、。，！？；：「」『』…-]+|[\s.,!?;:«»""''()\[\]—–·、。，！？；：「」『』…-]+$/g;
const cleanTok = s => String(s || '').replace(TOK_PUNCT, '') || String(s || '');

/* 一个词最多允许包含几个本地单元（只对无空格的日语/藏语生效） */
const TOK_MAX_UNITS = 4;

/* 本地确定性切分：结果一定覆盖整句，一定不跨空格 */
function segUnits(k, text) {
  const t = String(text == null ? '' : text);
  if (!t.trim()) return [];
  /* 藏文：音节点 ་ 与句点 ། 是确定无疑的边界，分隔符留在词尾 */
  if (k === 'bo') return t.match(/[^\s་།༎༏༐༑]*[་།༎༏༐༑]+|[^\s་།༎༏༐༑]+/g) || [t.trim()];
  /* 日语：没有可靠的本地分词，只按字种切换切（汉字/平假/片假/拉丁/数字），仅作兜底 */
  if (k === 'ja') return t.match(/[一-鿿々〆ヵヶ]+|[ぁ-ゟ]+|[ァ-ヺー]+|[A-Za-zＡ-Ｚａ-ｚ]+|[0-9０-９]+|[^\s]/g) || [t.trim()];
  return t.split(/\s+/).filter(Boolean);
}

/* 退回本地切分时，尽量把模型给的词义按词面认领回来 */
function alignGloss(units, ai, gl) {
  const m = new Map();
  ai.forEach((w, i) => {
    const g = gl[i] || '';
    if (!g) return;
    if (!m.has(w)) m.set(w, g);
    const c = cleanTok(w);
    if (c && !m.has(c)) m.set(c, g);
  });
  return units.map(u => m.get(u) || m.get(cleanTok(u)) || '');
}

/* 判断一个 token 是不是把好几个词并成了一个；是就返回拆开后的若干段 */
function subSplit(k, piece) {
  if (k !== 'ja' && k !== 'bo') {
    const parts = piece.split(/\s+/).filter(Boolean);
    return parts.length > 1 ? parts : [piece];
  }
  const u = segUnits(k, piece);
  return u.length > TOK_MAX_UNITS ? u : [piece];
}

function fixToks(k, text, tokens, gloss) {
  const t = String(text == null ? '' : text);
  if (!t.trim()) return { tokens: [], gloss: [] };
  const units = segUnits(k, t);
  const gl = Array.isArray(gloss) ? gloss.map(x => String(x == null ? '' : x)) : [];
  const ai = (Array.isArray(tokens) ? tokens : [])
    .map(x => String(x == null ? '' : x).trim()).filter(Boolean);

  /* 没给 tokens，或整句被当成一个 token —— 直接用本地切分 */
  if (!ai.length) return { tokens: units, gloss: units.map(() => '') };
  if (ai.length === 1 && units.length > 1) return { tokens: units, gloss: alignGloss(units, ai, gl) };

  /* 1) 把模型的 token 依次在原句里定位；只要有一个对不上（漏字、改字、顺序错），
        整句退回本地切分，只把词义按词面认领回来。 */
  const spans = [];
  let p = 0;
  for (let i = 0; i < ai.length; i++) {
    const at = t.indexOf(ai[i], p);
    if (at < 0 || t.slice(p, at).trim()) return { tokens: units, gloss: alignGloss(units, ai, gl) };
    spans.push({ w: ai[i], g: gl[i] || '' });
    p = at + ai[i].length;
  }
  if (t.slice(p).trim()) return { tokens: units, gloss: alignGloss(units, ai, gl) };

  /* 2) 逐个检查有没有把多个词并成一项，有就拆开 */
  const out = [], og = [];
  spans.forEach(sp => {
    const sub = subSplit(k, sp.w);
    if (sub.length < 2) { out.push(sp.w); og.push(sp.g); return; }
    let best = 0;
    sub.forEach((w, i) => { if (cleanTok(w).length > cleanTok(sub[best]).length) best = i; });
    sub.forEach((w, i) => { out.push(w); og.push(i === best ? sp.g : ''); });
  });
  return { tokens: out, gloss: og };
}
const LOADER = '<span class="load"><span class="dot"></span><span class="dot"></span><span class="dot"></span></span>';
/* safe JS string literal for embedding inside a double-quoted HTML attribute */
function jsq(s) { return esc(JSON.stringify(String(s == null ? '' : s))); }

let toastTimer = null;
function toast(msg, actionLabel, action) {
  const t = $('toast');
  t.innerHTML = '<span>' + esc(msg) + '</span>' + (actionLabel ? '<button id="tact">' + esc(actionLabel) + '</button>' : '');
  t.classList.add('on');
  t.classList.toggle('act', !!actionLabel);
  if (actionLabel) $('tact').onclick = () => { t.classList.remove('on'); action && action(); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), actionLabel ? 6000 : 2200);
}

const XBAR = '<div class="xbar"><button class="xb" onclick="closeSheet()" aria-label="关闭">' +
  '<svg width="15" height="15" viewBox="0 0 14 14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">' +
  '<path d="M1.5 1.5l11 11M12.5 1.5l-11 11"/></svg></button></div>';

const NAV_LIB = '<button class="ic" onclick="go(\'lib\')" aria-label="卡片库">' +
  '<svg width="17" height="17" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4">' +
  '<rect x="3" y="6" width="14" height="10" rx="2"/><path d="M6 3.5h8"/></svg></button>';

function sheet(html, keepScroll) {
  const el = $('sheet');
  const st = keepScroll ? el.scrollTop : 0;
  el.innerHTML = XBAR + html;
  el.scrollTop = st;
  $('mask').classList.add('on');
  requestAnimationFrame(() => el.classList.add('on'));
}
function closeSheet() { $('sheet').classList.remove('on'); $('mask').classList.remove('on'); }

function copyText(txt) {
  const ta = document.createElement('textarea');
  ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, 999999);
  let ok = false; try { ok = document.execCommand('copy'); } catch (e) {}
  document.body.removeChild(ta);
  if (!ok && navigator.clipboard) { navigator.clipboard.writeText(txt).then(() => toast('已复制')); return; }
  toast(ok ? '已复制' : '复制失败');
}

function autosize(ta) {
  ta.style.height = 'auto';
  ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
}

/* ---------------- router ---------------- */
function go(view, arg, replace) {
  if (!replace) S.stack.push({ view, arg });
  else S.stack[S.stack.length - 1] = { view, arg };
  render();
}
function back() {
  closeSheet();
  if (S.stack.length > 1) { S.stack.pop(); render(); }
}
function home() { closeSheet(); S.stack = [{ view: 'home' }]; render(); }

const VIEWS = {};
function render() {
  const cur = S.stack[S.stack.length - 1];
  closeSheet();
  window.scrollTo(0, 0);
  VIEWS[cur.view](cur.arg);
}

function nav(title, rightHtml) {
  const showBack = S.stack.length > 1;
  return '<div class="nav">' +
    (showBack ? '<button class="ic" onclick="back()">&#8249;</button>' : '<span style="width:32px"></span>') +
    '<div class="ttl">' + esc(title) + '</div>' +
    (rightHtml || '<span style="width:32px"></span>') +
    '</div>';
}
function shell(title, bodyHtml, opts) {
  opts = opts || {};
  app().innerHTML = '<div class="screen on">' + nav(title, opts.right) +
    '<div class="body' + (opts.bar ? ' withbar' : '') + '">' + bodyHtml + '</div></div>' + (opts.bar || '');
}

/* ---------------- speech ---------------- */
let voicesReady = false;
/* iOS 上音色列表是异步加载的，第一次 getVoices() 常常是空的。
   列表到了以后，如果设置页开着，就把音色下拉框重新填一遍。 */
function loadVoices() {
  try { speechSynthesis.getVoices(); voicesReady = true; } catch (e) {}
  if (typeof paintVoiceSels === 'function') paintVoiceSels();
}
if (window.speechSynthesis) { loadVoices(); speechSynthesis.onvoiceschanged = loadVoices; }

/* 合成好的音频只留在内存里，上限 30 条，超出就回收最早的，不占设备存储 */
const audioCache = new Map();
function cacheAudio(ck, url) {
  audioCache.set(ck, url);
  while (audioCache.size > 30) {
    const first = audioCache.keys().next().value;
    try { URL.revokeObjectURL(audioCache.get(first)); } catch (e) {}
    audioCache.delete(first);
  }
}

/* ---------------- 朗读音色 ----------------
   以前这里会从音色列表里挑「第一个语言对得上的」硬塞给朗读——在 iPhone 上那通常是
   系统默认的荷兰语男声，于是你在「设置 → 辅助功能 → 朗读内容 → 声音」里选的女声被盖掉了。
   现在：设置里按语言指定了音色就用那一个；没指定就【只设语言、不指定音色】，交给系统挑。
   注意 iOS 26 有个已知回归：系统不再把「朗读内容」里选的音色告诉第三方（包括网页），
   所以想要确定用上那个女声，最可靠的是在 App 设置里直接点名它。 */
const voiceList = () => { try { return speechSynthesis.getVoices() || []; } catch (e) { return []; } };
const vLang = v => String((v && v.lang) || '').replace('_', '-');
const langOfCode = code => LK.find(k => LANGS[k].tts === code) || '';
function voicesFor(k) {
  const base = String((LANGS[k] && LANGS[k].tts) || '').split('-')[0].toLowerCase();
  if (!base) return [];
  return voiceList().filter(v => vLang(v).toLowerCase().split('-')[0] === base);
}
function chosenVoice(k) {
  const want = S.cfg.voiceBy && S.cfg.voiceBy[k];
  if (!want) return null;
  const vs = voiceList();
  return vs.find(v => v.voiceURI === want) || vs.find(v => v.name === want) || null;
}
/* 音色的显示名：名字 · 语言 · 质量。iOS 的 voiceURI 里带 premium / enhanced 字样 */
function voiceLabel(v) {
  const u = String(v.voiceURI || '').toLowerCase();
  const q = u.indexOf('premium') > -1 ? ' · 高级' : (u.indexOf('enhanced') > -1 ? ' · 增强' : '');
  return v.name + ' · ' + vLang(v) + q + (v.localService === false ? ' · 联网' : '');
}
function nativeSpeak(text, code, rate) {
  if (!window.speechSynthesis) { toast('本设备不支持语音'); return; }
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = code; u.rate = rate || 0.92;
  const v = chosenVoice(langOfCode(code));
  if (v) { u.voice = v; u.lang = vLang(v) || code; }
  speechSynthesis.speak(u);
}

/* ---- iOS 自动播放解锁：必须在用户手势里同步调用一次 ---- */
const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQAAAAA=';
let audioEl = null, audioUnlocked = false;
function primeAudio() {
  if (!audioEl) {
    audioEl = new Audio();
    audioEl.setAttribute('playsinline', '');
    audioEl.preload = 'auto';
  }
  if (!audioUnlocked) {
    audioUnlocked = true;
    try { audioEl.src = SILENT_WAV; const p = audioEl.play(); if (p && p.catch) p.catch(() => {}); } catch (e) {}
  }
  return audioEl;
}
function playUrl(url) {
  const el = primeAudio();
  el.src = url;
  try {
    const p = el.play();
    if (p && p.catch) p.catch(() => toast('浏览器拦截了自动播放，请再点一次发音'));
  } catch (e) { toast('播放失败'); }
}

/* ---- Azure Speech SDK（浏览器端唯一受支持的方式，走 WebSocket，不受跨域限制）---- */
const AZ_VOICE = 'kk-KZ-AigulNeural';
const SDK_URLS = [
  'https://cdn.jsdelivr.net/npm/microsoft-cognitiveservices-speech-sdk@1.51.0/distrib/browser/microsoft.cognitiveservices.speech.sdk.bundle-min.js',
  'https://unpkg.com/microsoft-cognitiveservices-speech-sdk@1.51.0/distrib/browser/microsoft.cognitiveservices.speech.sdk.bundle-min.js'
];
let sdkPromise = null;
function loadSpeechSDK() {
  if (window.SpeechSDK) return Promise.resolve(window.SpeechSDK);
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise((resolve, reject) => {
    let i = 0;
    const tryNext = () => {
      if (i >= SDK_URLS.length) { sdkPromise = null; reject(new Error('SDK_LOAD')); return; }
      const s = document.createElement('script');
      s.src = SDK_URLS[i++]; s.async = true;
      s.onload = () => { if (window.SpeechSDK) resolve(window.SpeechSDK); else tryNext(); };
      s.onerror = tryNext;
      document.head.appendChild(s);
    };
    tryNext();
  });
  return sdkPromise;
}

const normReg = r => String(r || 'westeurope').trim().toLowerCase().replace(/\s+/g, '');

async function azureSynth(text) {
  const SDK = await loadSpeechSDK();
  const cfg = SDK.SpeechConfig.fromSubscription((S.cfg.azKey || '').trim(), normReg(S.cfg.azReg));
  cfg.speechSynthesisVoiceName = AZ_VOICE;
  cfg.speechSynthesisOutputFormat = SDK.SpeechSynthesisOutputFormat.Audio24Khz48KBitRateMonoMp3;
  const syn = new SDK.SpeechSynthesizer(cfg, null);   // null = 不自动播放，只拿音频数据
  try {
    const res = await new Promise((resolve, reject) => {
      syn.speakTextAsync(text, resolve, e => reject(new Error(String(e))));
    });
    if (res.reason === SDK.ResultReason.SynthesizingAudioCompleted && res.audioData && res.audioData.byteLength) {
      return new Blob([res.audioData], { type: 'audio/mpeg' });
    }
    throw new Error(res.errorDetails || ('合成未完成（reason ' + res.reason + '）'));
  } finally { try { syn.close(); } catch (e) {} }
}

function azureHint(msg) {
  const m = String(msg || '');
  if (/SDK_LOAD/.test(m)) return '语音组件没能从 CDN 加载。检查网络后重试。';
  if (/401|Unauthorized/i.test(m)) return 'Key 与区域对不上。最常见原因：区域填错了。请到 Azure 门户打开你的 Speech 资源，看「位置」写的是什么，去掉空格全部小写填进来（West Europe → westeurope）。';
  if (/1006|WebSocket|ConnectionFailure|ENOTFOUND|getaddrinfo/i.test(m))
    return '连不上 Azure。多半是区域代码拼错了（会解析到一个不存在的域名），也可能是网络被拦截。';
  if (/403|Forbidden/i.test(m)) return '被拒绝：资源可能已停用、超出免费额度，或该区域不提供 kk-KZ 音色（建议用 westeurope 或 eastus）。';
  if (/429|TooManyRequests|Quota/i.test(m)) return '超出配额或请求过于频繁，稍后再试。';
  if (/400/.test(m)) return '请求被拒（400）：通常是区域字符串里混入了空格或多余字符。';
  return m || '未知错误';
}

/* Kazakh: Azure -> OpenAI TTS -> iOS 俄语音色（最后兜底） */
async function apiSpeak(text, btn) {
  primeAudio();                                  // 必须在手势里同步执行
  const ck = 'kk|' + text;
  if (audioCache.has(ck)) { playUrl(audioCache.get(ck)); return; }
  const old = btn ? btn.innerHTML : null;
  if (btn) { btn.innerHTML = '···'; btn.disabled = true; }
  try {
    let blob = null, why = '';
    if ((S.cfg.azKey || '').trim()) {
      try { blob = await azureSynth(text); }
      catch (e) { why = azureHint(e.message); }
    }
    if (!blob && (S.cfg.key || '').trim()) {
      try { blob = await openaiTTS(text); } catch (e) { if (!why) why = 'OpenAI 语音失败 · ' + e.message; }
    }
    if (blob) {
      const url = URL.createObjectURL(blob);
      cacheAudio(ck, url);
      playUrl(url);
      if (why) toast('Azure 失败，已改用 OpenAI 语音 · ' + why);
    } else {
      nativeSpeak(text, 'ru-RU', 0.85);
      toast(why || '未配置语音，已用俄语音色近似朗读');
    }
  } finally { if (btn) { btn.innerHTML = old; btn.disabled = false; } }
}
async function openaiTTS(text) {
  const r = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + S.cfg.key.trim(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-4o-mini-tts', voice: 'alloy', input: text, speed: 0.92 })
  });
  if (!r.ok) throw new Error('openai tts ' + r.status);
  return await r.blob();
}

function say(lang, text, btn) {
  const L = LANGS[lang];
  if (!L || !L.tts) { toast('该语言暂无可用语音'); return; }
  if (L.tts === 'api') apiSpeak(text, btn);
  else nativeSpeak(text, L.tts);
}
window.say = say;

/* ---------------- 墨墨标记渲染 ----------------
   卡片库里要能直接复习，所以得把墨墨语法完整画出来，而不只是两种高亮：
   [T#样式#文字]  样式可组合（逗号分隔）：B 粗 / U 下划线 / I 斜 / D 删除线 /
                  up 上标 / down 下标 / !色值 字色 / !!色值 背景
   [P#样式#文字]  段落：H1 / H2 / H3 / center / right，也可带上面的文字样式
   [F##文字]      挖空
   [Pic#…] [Audio#…] [Card#…] 这类引用在 App 里没法还原，直接去掉
   ---            答案线
   墨墨规定标记内容里不能有 ]，所以不存在嵌套，一遍替换就够。 */
const hex6 = h => h.length === 3 ? h[0] + h[0] + h[1] + h[1] + h[2] + h[2] : h.slice(0, 6);
function mjStyle(style) {
  const css = [], deco = [];
  let tag = '';
  String(style || '').split(',').map(x => x.trim()).filter(Boolean).forEach(t => {
    let m;
    if (t === 'B') css.push('font-weight:700');
    else if (t === 'I') css.push('font-style:italic');
    else if (t === 'U') deco.push('underline');
    else if (t === 'D') deco.push('line-through');
    else if (t === 'up') tag = 'sup';
    else if (t === 'down') tag = 'sub';
    else if ((m = /^!!([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.exec(t)))
      css.push('background:#' + hex6(m[1]) + ';color:#111;padding:0 3px;border-radius:2px');
    else if ((m = /^!([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.exec(t)))
      css.push('color:#' + hex6(m[1]) + ';font-weight:600');
    else if (t === 'H1') css.push('font-size:1.45em;font-weight:700');
    else if (t === 'H2') css.push('font-size:1.25em;font-weight:700');
    else if (t === 'H3') css.push('font-size:1.1em;font-weight:700');
    else if (t === 'center') css.push('display:block;text-align:center');
    else if (t === 'right') css.push('display:block;text-align:right');
  });
  if (deco.length) css.push('text-decoration:' + deco.join(' '));
  return { css: css.join(';'), tag: tag };
}
function renderCodes(raw) {
  let s = esc(raw);
  /* 独占一行的引用连同那一行一起去掉，免得留下空行 */
  s = s.replace(/^[ \t]*\[(?:Pic|Audio|Card)#[^\]\n]*\][ \t]*\n?/gm, '');
  s = s.replace(/\[(?:Pic|Audio|Card)#[^\]\n]*\]/g, '');
  s = s.replace(/\[F##([^\]\n]*)\]/g,
    (m, t) => '<span class="mjf">' + t + '</span>');
  /* 段落本身已经是块，紧跟的换行要吃掉，否则 pre-wrap 下会多出一行空白 */
  s = s.replace(/\[(T|P)#([^#\]\n]*)#([^\]\n]*)\](\n?)/g, (m, kind, style, t, nl) => {
    const st = mjStyle(style);
    const inner = st.tag ? '<' + st.tag + '>' + t + '</' + st.tag + '>' : t;
    return kind === 'P'
      ? '<span style="display:block;' + st.css + '">' + inner + '</span>'
      : '<span style="' + st.css + '">' + inner + '</span>' + nl;
  });
  s = s.replace(/^---\s*$/gm, '<hr>');
  return s;
}
