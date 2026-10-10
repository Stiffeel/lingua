/* ================= Yulengua · 背单词 =================
   每种语言一份固定词库（仓库里的 words/<lang>.csv），每次随机抽 10 个新词。
   勾「熟」的词永久退出；「换一批」之前列表不变，刷新页面也不变。

   词库故意放在应用外面：CSV 用 Excel / Numbers 双击就能编辑，
   在 GitHub 网页上（包括手机）也能直接点铅笔改，而且解析零依赖。
   缺文件时这个模块自己降级提示，不影响 App 的其它部分。 */

const PULSE_N = 10;

/* ---------------- CSV ----------------
   容错优先：分隔符自动判定，表头可有可无、列序随意，# 开头是注释。 */
function csvSplit(text) {
  const t = String(text || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  /* 分隔符只判一次：中文释义里常有全角逗号，但半角逗号也可能出现，
     所以按首行出现次数定死一个，不要逐字符混判。 */
  const head = t.split('\n').find(l => l.trim() && l.trim()[0] !== '#') || '';
  const cand = [',', '\t', ';', '|'];
  let sep = ',', best = -1;
  cand.forEach(c => { const n = head.split(c).length; if (n > best) { best = n; sep = c; } });

  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  row.push(cell); rows.push(row);
  return rows.map(r => r.map(x => x.trim()))
    .filter(r => r.some(x => x) && r[0][0] !== '#');
}

const H_WORD = ['词', '单词', '词条', '生词', 'word', 'words', 'term', 'vocab', '外语', '原文'];
const H_GLOSS = ['释义', '中文', '中文释义', '意思', '翻译', '解释', 'gloss', 'meaning', 'zh', 'definition', 'cn'];
const hIdx = (row, names) => row.findIndex(c => names.indexOf(c.toLowerCase()) > -1);

function parseBank(text) {
  const rows = csvSplit(text);
  if (!rows.length) return [];
  let wi = 0, gi = 1, start = 0;
  const h = rows[0].map(c => c.toLowerCase());
  const w = hIdx(h, H_WORD), g = hIdx(h, H_GLOSS);
  if (w > -1) { wi = w; gi = g > -1 ? g : (w === 0 ? 1 : 0); start = 1; }
  const seen = new Set(), out = [];
  for (let i = start; i < rows.length; i++) {
    const r = rows[i];
    const word = (r[wi] || '').trim();
    if (!word || seen.has(word)) continue;
    seen.add(word);
    out.push({ w: word, g: (r[gi] || '').trim() });
  }
  return out;
}

/* ---------------- 词库加载 ----------------
   先走网络拿最新的，成功就顺手缓存进 IndexedDB；
   离线（主屏图标启动时很常见）就用缓存那一份。 */
const BANK = {};
const bankUrl = k => new URL('words/' + k + '.csv', location.href).href;

/* Excel 在中文 Windows 上存 CSV 默认不是 UTF-8。硬按 UTF-8 解会得到一片 U+FFFD，
   词库看着像坏了。这里按「哪种编码解出来没有替换字符」来选，用户不用管编码。 */
const BANK_ENC = ['utf-8', 'gbk', 'windows-1252'];
function decodeBank(buf) {
  for (const enc of BANK_ENC) {
    let t;
    try { t = new TextDecoder(enc).decode(buf); } catch (e) { continue; }
    if (t.indexOf('\uFFFD') === -1) return t;
  }
  return new TextDecoder('utf-8').decode(buf);
}

async function bankLoad(k, force) {
  if (BANK[k] && !force) return BANK[k];
  let text = null, from = 'net', err = '';
  try {
    const r = await fetch(bankUrl(k), { cache: 'no-cache' });
    if (r.ok) text = decodeBank(await r.arrayBuffer());
    else err = 'HTTP ' + r.status;
  } catch (e) { err = e.message || '网络错误'; }
  if (text != null) { try { await idbSet('bank.' + k, text); } catch (e) {} }
  else {
    from = 'cache';
    try { const c = await idbGet('bank.' + k); if (typeof c === 'string') { text = c; err = ''; } } catch (e) {}
  }
  BANK[k] = text == null
    ? { words: [], from: from, err: err || '没找到词库文件' }
    : { words: parseBank(text), from: from, err: '' };
  return BANK[k];
}

/* 词库里到底有哪些词，惰性建一次 Set 缓存在词库对象上；
   bankLoad 每次都造新对象，所以换了词库这份缓存自然作废。 */
function bankSet(k) {
  const b = BANK[k];
  if (!b) return null;
  if (!b._set) b._set = new Set(b.words.map(x => x.w));
  return b._set;
}

/* ---------------- 状态 ---------------- */
function pulseState() {
  if (!S.pulse || typeof S.pulse !== 'object') S.pulse = {};
  if (!S.pulse.known || typeof S.pulse.known !== 'object') S.pulse.known = {};
  if (!S.pulse.cur || typeof S.pulse.cur !== 'object') S.pulse.cur = {};
  if (!S.pulse.gl || typeof S.pulse.gl !== 'object') S.pulse.gl = {};
  if (!S.pulse.sent || typeof S.pulse.sent !== 'object') S.pulse.sent = {};
  return S.pulse;
}
/* 「明确取消」的记录只需要活到同步完成，留 90 天足够，之后直接丢掉别占地方 */
const PULSE_UNDO_KEEP = 90 * 86400000;
function prunePulse() {
  const p = pulseState(), cut = Date.now() - PULSE_UNDO_KEEP;
  Object.keys(p.known).forEach(k => {
    const m = p.known[k];
    Object.keys(m).forEach(w => { if (m[w] < 0 && -m[w] < cut) delete m[w]; });
  });
}
/* known[语言][词] 存的是【带符号的时间戳】：正数 = 已熟知，负数 = 在那个时刻明确取消了。
   不能只用「有没有这个键」来表示，因为云端合并如果只做并集，取消就永远同步不出去——
   本地取消掉的词会在下一次同步时被远端那份原样加回来，看起来就像「勾一个词，另一个自己也被勾上了」。 */
const pKnown = k => { const p = pulseState(); return p.known[k] || (p.known[k] = {}); };
const pIsKnown = (k, w) => (pKnown(k)[w] || 0) > 0;
function pSetKnown(k, w, on) { pKnown(k)[w] = on ? Date.now() : -Date.now(); }
const pCur = k => { const p = pulseState(); return Array.isArray(p.cur[k]) ? p.cur[k] : []; };
const pGl = k => { const p = pulseState(); return p.gl[k] || (p.gl[k] = {}); };
/* 「已熟」只统计【当前词库里还存在】的词。换过词库之后，历史记录里那些
   已经被你从 CSV 删掉的词不该再算进来——否则「剩」会算少，词库缩小时还会算成负数。
   记录本身不删：万一你又把那个词加回词库，它仍然是熟的。 */
function pulseKnownCount(k) {
  const m = pKnown(k), set = bankSet(k);
  return Object.keys(m).filter(w => m[w] > 0 && (!set || set.has(w))).length;
}
/* 勾选 = 标记熟知，同时也是造句的选词。两件事共用一个勾。 */
const pulseSel = k => pCur(k).filter(w => pIsKnown(k, w));
const pSent = k => { const p = pulseState(); return p.sent[k] || null; };

/* 抽一批。已熟知的永久排除；刚看过的这一批虽然「回到词库」，
   但只要池子还够大就避开它们，免得点了换一批还是同样几个词。 */
function pulseDraw(k, words) {
  const known = pKnown(k), prev = new Set(pCur(k));
  const pool = words.filter(x => !((known[x.w] || 0) > 0));
  let src = pool.filter(x => !prev.has(x.w));
  if (src.length < PULSE_N) src = pool;                 // 池子见底了就允许重复出现
  return pickN(src, PULSE_N).map(x => x.w);
}

/* Fisher–Yates，只洗前 n 个就够 */
function pickN(arr, n) {
  const a = arr.slice(), m = Math.min(n, a.length);
  for (let i = 0; i < m; i++) {
    const j = i + Math.floor(Math.random() * (a.length - i));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a.slice(0, m);
}

/* 换过词库之后，当前这一批里可能混着你已经从 CSV 里删掉的词。
   删掉的就该消失，但没删的要留在原位（「换一批之前列表不变」只对还存在的词成立），
   所以只剔除失效的那几个，再从池子里补满到 10 个。 */
function pulseSyncCur(k, b) {
  const set = bankSet(k);
  if (!set) return false;
  const old = pCur(k);
  const keep = old.filter(w => set.has(w));
  if (keep.length === old.length) return false;
  const have = new Set(keep);
  const pool = b.words.filter(x => !pIsKnown(k, x.w) && !have.has(x.w));
  pulseState().cur[k] = keep.concat(pickN(pool, PULSE_N - keep.length).map(x => x.w));
  return true;
}

const savePulse = q => { persistKey('pulse', pulseState()); if (!q) cloudTouch(); };

/* ---------------- 视图 ---------------- */
const P = { lang: null, busy: false, gen: false, ask: false, err: '', serr: '' };

VIEWS.pulse = async function (k) {
  P.lang = k; P.err = '';
  paintPulse();
  const b = await bankLoad(k);
  if (!b.words.length) { paintPulse(); return; }
  if (!pCur(k).length) { pulseState().cur[k] = pulseDraw(k, b.words); savePulse(); }
  else if (pulseSyncCur(k, b)) savePulse();
  paintPulse();
  pulseFillGloss(k);
};

function pulseWordsNow(k) {
  const b = BANK[k];
  const map = new Map((b ? b.words : []).map(x => [x.w, x.g]));
  const gl = pGl(k);
  return pCur(k).map(w => ({ w: w, g: map.get(w) || gl[w] || '', known: pIsKnown(k, w) }));
}

function paintPulse() {
  const k = P.lang, L = LANGS[k], b = BANK[k];
  let body = '';

  if (!b) { shell(L.zh, '<div style="margin-top:22px">' + LOADER + ' 正在读取词库</div>'); return; }

  if (!b.words.length) {
    shell(L.zh,
      '<div class="empty"><span class="big">&#9633;</span>还没有' + L.zh + '的词库</div>' +
      '<p class="note">把 <b>words/' + k + '.csv</b> 放进你的 GitHub 仓库就能用。' +
      '两列：第一列写词，第二列写中文释义，第一行可以是表头。' +
      (b.err ? '<br>读取失败：' + esc(b.err) : '') + '</p>' +
      '<button class="btn wide" onclick="pulseReload()">重新读取</button>');
    return;
  }

  const items = pulseWordsNow(k);
  const total = b.words.length, kn = pulseKnownCount(k);
  const left = total - kn;

  const sel = pulseSel(k), allOn = items.length > 0 && sel.length === items.length;

  body += '<div class="row" style="margin-bottom:4px">' +
    '<button class="btn sm" onclick="pulseNext(this)">&#8635; 换一批</button>' +
    '<button class="btn sm" onclick="pulseAll(' + (allOn ? 'false' : 'true') + ')">' +
    (allOn ? '全不选' : '全选') + '</button>' +
    '<span class="hint" style="margin-left:auto">词库 ' + total + ' · 已熟 ' + kn + ' · 剩 ' + left + '</span>' +
    '</div>' +
    '<button class="btn pri wide" style="margin-top:10px" onclick="pulseMakeSent(this)"' +
    (sel.length && !P.gen ? '' : ' disabled') + '>' +
    (P.gen ? LOADER + ' 正在造句' : '用勾选的 ' + sel.length + ' 个词造句') + '</button>' +
    '<p class="note" style="margin-bottom:14px">勾「熟」的词以后不会再出现，同时也是造句要用的词。' +
    '没勾的在「换一批」之后会回到词库里。点词看释义，点「详解」调 AI 做完整解析。</p>';

  body += pulseSentHtml(k);

  if (P.busy) body += '<div style="margin-bottom:12px">' + LOADER + ' 正在补齐释义</div>';
  if (P.err) body += '<div class="err">' + esc(P.err) + '</div>';

  body += '<div class="lib">';
  items.forEach((it, i) => {
    body += '<div class="lc' + (it.known ? ' sel' : '') + '">' +
      '<div class="top">' +
      '<button class="cb" data-pk="' + i + '" title="标记熟知">' + (it.known ? '&#10003;' : '') + '</button>' +
      '<div class="fr"><span class="' + scriptCls(k) + '" data-pw="' + i + '" style="font-size:20px">' + esc(it.w) + '</span>' +
      '<div class="mt">' + (it.g ? esc(it.g) : '（词库里没写释义）') + '</div></div>' +
      '</div>' +
      (k === 'kk' ? '<div class="ar" style="font-size:18px;margin-top:6px">' + esc(kkArab(it.w)) + '</div>' : '') +
      (k === 'ru' ? '<div class="translit" style="margin-top:4px">' + esc(ruLat(it.w)) + '</div>' : '') +
      handHtml(k, it.w, true) +
      '<div class="acts">' +
      (L.tts ? '<button class="btn sm" data-ps="' + i + '">&#9654; 发音</button>' : '') +
      '<button class="btn sm pri" data-pd="' + i + '">详解</button>' +
      '<button class="btn sm" data-pc="' + i + '">生成卡片</button>' +
      '</div></div>';
  });
  body += '</div>';

  const ps0 = pSent(k);
  const bar = ps0 ? '<div class="askbar">' +
    '<textarea id="pask" rows="1" placeholder="就这句话继续追问…" oninput="autosize(this)"></textarea>' +
    '<button class="go" onclick="askPulse()">&#8593;</button></div>' : '';
  shell(L.zh, body, { bar: bar, right: NAV_LIB });

  const at = i => pulseWordsNow(k)[i];
  document.querySelectorAll('[data-pk]').forEach(el => el.onclick = () => {
    const it = at(+el.dataset.pk);
    pSetKnown(k, it.w, !pIsKnown(k, it.w));
    savePulse(); paintPulse();
  });
  const ps = pSent(k);
  if (ps) bindTapWords(k, () => ({ text: ps.text, tokens: ps.tokens, gloss: ps.gloss }));
  const open = i => { const it = at(i); showWord(k, it.w, it.g, it.w); };
  document.querySelectorAll('[data-pw]').forEach(el => el.onclick = () => open(+el.dataset.pw));
  document.querySelectorAll('[data-pd]').forEach(el => el.onclick = () => open(+el.dataset.pd));
  document.querySelectorAll('[data-ps]').forEach(el => el.onclick = () => say(k, at(+el.dataset.ps).w, el));
  document.querySelectorAll('[data-pc]').forEach(el => el.onclick = () => {
    const it = at(+el.dataset.pc);
    /* 在这个词的词卡里追问的内容（上下文就是词本身）原样进「追问详解」，
       否则问明白的点生成卡片时就丢了 */
    const notes = wordQaFor(k, [it.w], true).map(x => '问：' + x.q + '\n答：' + x.a).join('\n\n');
    genWordCard({ lang: k, word: it.w, zh: it.g, pos: '', gender: '' }, [], el, notes);
  });
}

function pulseNext(btn) {
  const k = P.lang, b = BANK[k];
  if (!b || !b.words.length) return;
  if (!b.words.some(x => !pIsKnown(k, x.w))) { toast('这门语言的词库已经全部标记为熟知了'); return; }
  if (btn) { btn.disabled = true; }
  pulseState().cur[k] = pulseDraw(k, b.words);
  delete pulseState().sent[k];                  // 换了词，上一句就不该再挂在这里
  P.serr = '';
  savePulse();
  paintPulse();
  pulseFillGloss(k);
}

/* 全选 / 全不选：只动【当前这一批】，不碰历史上标记过的熟知记录 */
function pulseAll(on) {
  const k = P.lang;
  pCur(k).forEach(w => pSetKnown(k, w, on));
  savePulse();
  paintPulse();
}

async function pulseReload() {
  const k = P.lang;
  BANK[k] = null;
  paintPulse();
  const b = await bankLoad(k, true);
  if (b.words.length) {
    if (!pCur(k).length) { pulseState().cur[k] = pulseDraw(k, b.words); savePulse(); }
    else if (pulseSyncCur(k, b)) savePulse();
  }
  paintPulse();
}

/* 词库里释义留空的词，用一次请求把这一批一起补齐，补完缓存起来不再重复花钱 */
async function pulseFillGloss(k) {
  const miss = pulseWordsNow(k).filter(x => !x.g).map(x => x.w);
  if (!miss.length || P.busy) return;
  if (!S.cfg.key || !S.cfg.key.trim()) return;          // 没填 Key 就静默跳过，不弹提示
  P.busy = true; P.err = ''; paintPulse();
  try {
    const j = await aiJson(pulseGlossPrompt(k, miss), k);
    const g = j && j.gloss;
    if (g && typeof g === 'object') {
      Object.keys(g).forEach(w => { const v = String(g[w] || '').trim(); if (v) pGl(k)[w] = unmark(v); });
      savePulse();
    }
  } catch (e) { P.err = '补齐释义失败 · ' + e.message; }
  P.busy = false; paintPulse();
}

/* ---------------- 用勾选的词造句 ----------------
   模型经常「声称」用了某个词其实没用，或者偷偷换成同义词。所以要求它逐词
   交代在句中的实际形式，然后本地逐条核对那个形式是不是真的出现在句子里——
   这一步是确定性的，模型说了不算。 */
function pulseVerify(text, words, used) {
  const t = String(text || ''), tl = t.toLowerCase();
  const m = new Map();
  (Array.isArray(used) ? used : []).forEach(u => {
    if (!u) return;
    const w = String(u.w == null ? '' : u.w).trim();
    const f = String(u.form == null ? '' : u.form).trim();
    if (w && f && !m.has(w)) m.set(w, f);
  });
  const miss = [], forms = [];
  words.forEach(w => {
    const f = m.get(w) || '';
    const hit = (f && (t.indexOf(f) > -1 || tl.indexOf(f.toLowerCase()) > -1)) ||
      t.indexOf(w) > -1 || tl.indexOf(w.toLowerCase()) > -1;
    if (hit) forms.push({ w: w, f: f && f !== w ? f : '' });
    else miss.push(w);
  });
  return { miss: miss, forms: forms };
}

async function pulseMakeSent(btn) {
  if (needKey() || P.gen) return;
  const k = P.lang, words = pulseSel(k);
  if (!words.length) { toast('先勾几个词'); return; }
  P.gen = true; P.serr = ''; paintPulse();
  try {
    const j = await aiJson(pulseSentPrompt(k, words), k);
    const sent = buildSent(j, k);
    if (!sent.text) throw new Error('模型返回了空句子');
    const v = pulseVerify(sent.text, words, j.used);
    pulseState().sent[k] = {
      text: sent.text, alt: sent.alt, translit: sent.translit,
      zh: sent.zh, en: sent.en, tokens: sent.tokens, gloss: sent.gloss,
      note: unmark(j.note || ''), words: words, forms: v.forms, miss: v.miss,
      qa: [],                     // 追问是针对上一句问的，换了句子就不该跟过来
      ts: Date.now()
    };
    savePulse();
  } catch (e) { P.serr = '造句失败 · ' + e.message; }
  P.gen = false; paintPulse();
  const el = document.getElementById('psent');
  if (el) el.scrollIntoView({ block: 'nearest' });
}

function pulseSentHtml(k) {
  const s = pSent(k), L = LANGS[k];
  if (P.serr) return '<div class="err" style="margin-bottom:14px">' + esc(P.serr) +
    '<div class="row" style="margin-top:10px"><button class="btn sm" onclick="pulseMakeSent(this)">重试</button></div></div>';
  if (!s) return '';

  let h = '<div class="card" id="psent" style="margin-bottom:18px">' +
    '<div class="sent ' + scriptCls(k) + '">' + tapWords(k, s.text, s.tokens, s.gloss, 'pv') + '</div>' +
    (k === 'kk' && s.alt ? '<div class="sent ar" style="margin-top:14px">' + esc(s.alt) + '</div>' : '') +
    (s.translit ? '<div class="translit">' + esc(s.translit) + '</div>' : '') +
    handHtml(k, s.text) +
    '<div class="trans">' + esc(s.zh) +
    (s.en ? '<div class="en">' + esc(s.en) + '</div>' : '') + '</div>';

  /* 逐词交代用了什么形式——既是校验结果，也正好是最该记的东西 */
  if (s.forms.length) {
    h += '<div class="forms" style="margin-top:14px">' + s.forms.map(f =>
      '<div><b>' + esc(f.w) + '</b><span>' + (f.f ? esc(f.f) : '原形') + '</span></div>').join('') + '</div>';
  }
  if (s.miss.length) {
    h += '<div class="err" style="margin-top:12px">这一句里没找到：' + esc(s.miss.join('、')) +
      '<br>模型漏用或换成了别的词，建议重新造一句。</div>';
  }
  if (s.note) h += '<div class="expl">' + esc(s.note) + '</div>';

  h += '<div class="row" style="margin-top:16px">' +
    (L.tts ? speakBtn(k, s.text) : '') +
    '<button class="btn sm" onclick="pulseMakeSent(this)">&#8635; 重新造句</button>' +
    '<button class="btn sm" onclick="pulseDropSent()">收起</button>' +
    '</div>' +
    '<p class="hint" style="margin-top:12px">点句中任意单词查看释义，下方输入框可以就这句话继续追问</p>' +
    '</div>';

  const qa = Array.isArray(s.qa) ? s.qa : [];
  if (qa.length) {
    h += '<div class="qa">' + qa.map(x =>
      '<div class="q">' + esc(x.q) + '</div><div class="a">' + esc(x.a) + '</div>').join('') + '</div>';
  }

  /* 词卡里的追问有两种来源：在造出来的句子里点词问的，和在上面词表里点词问的。
     两种都属于这句话，生成卡片时都会带上。 */
  const nwq = wordQaFor(k, [s.text].concat(s.words || [])).length;
  h += '<button class="btn pri wide" style="margin-top:16px" onclick="pulseSentCard(this)">把这句存到卡片库</button>' +
    ((qa.length || nwq)
      ? '<p class="note" style="text-align:center;margin-bottom:18px">会一并带上' +
        (qa.length ? '这句话的 ' + qa.length + ' 条追问' : '') +
        (qa.length && nwq ? '，以及' : '') +
        (nwq ? '词卡里追问的 ' + nwq + ' 条内容' : '') + '</p>'
      : '<div style="margin-bottom:18px"></div>');
  return h;
}

/* 就造出来的这句话继续追问 */
async function askPulse() {
  const k = P.lang, s = pSent(k);
  if (needKey() || !s || P.gen || P.ask) return;
  const ta = $('pask'); if (!ta) return;
  const q = ta.value.trim();
  if (!q) return;
  ta.value = ''; autosize(ta); ta.blur();
  if (!Array.isArray(s.qa)) s.qa = [];
  s.qa.push({ q: q, a: '…' });
  P.ask = true; P.serr = '';
  savePulse(); paintPulse();
  try {
    const a = await ai(askPrompt(k, s, s.qa.slice(0, -1), q), false, k);
    s.qa[s.qa.length - 1].a = a;
  } catch (e) { s.qa.pop(); P.serr = '追问失败 · ' + e.message; }
  P.ask = false;
  savePulse(); paintPulse();
  window.scrollTo(0, document.body.scrollHeight);
}

function pulseDropSent() {
  delete pulseState().sent[P.lang];
  P.serr = '';
  savePulse();
  paintPulse();
}

function pulseSentCard(btn) {
  const k = P.lang, s = pSent(k);
  if (!s) return;
  detailFor(k, { text: s.text, alt: s.alt, translit: s.translit, zh: s.zh, en: s.en },
    Array.isArray(s.qa) ? s.qa.filter(x => x && x.a && x.a !== '…') : [],
    btn, s.words || []);
}
