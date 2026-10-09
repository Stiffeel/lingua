/* ================= Yulengua · 卡片库（App 内复习）=================
   列表只用索引（S.cards：原文 + 语言 + 时间），详解（翻译、解析、追问）展开时才从
   本机缓存 / 云端取。点卡片本体展开；右边两个按钮：发音、移到最后。
   墨墨格式不再是主功能，只在展开后留一个「复制墨墨格式」。 */

const LIB = { open: {}, lang: null, cache: new Map() };   // cache: 展开中的卡片正文，id -> {bv, b}

VIEWS.lib = function () { paintLib(); };

/* 当前标签页：没选过就落在第一个有卡片的语言 */
function libLang() {
  if (!LIB.lang || !LANGS[LIB.lang]) LIB.lang = LK.find(k => S.cards.some(c => c.lang === k)) || LK[0];
  return LIB.lang;
}
const libTabName = k => k === 'bo' ? '藏语' : LANGS[k].zh;

/* 从添加到现在过了多久 */
function agoText(ts) {
  const s = Math.max(0, Date.now() - ts) / 1000;
  if (s < 60) return '刚刚添加';
  if (s < 3600) return '已添加 ' + Math.floor(s / 60) + ' 分钟';
  if (s < 86400) return '已添加 ' + Math.floor(s / 3600) + ' 小时';
  const d = Math.floor(s / 86400);
  if (d < 30) return '已添加 ' + d + ' 天';
  if (d < 365) return '已添加 ' + Math.floor(d / 30) + ' 个月';
  const y = Math.floor(d / 365), mo = Math.floor((d - y * 365) / 30);
  return '已添加 ' + y + ' 年' + (mo ? ' ' + mo + ' 个月' : '');
}

const ICON_SPK = '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16.5 8.5a5 5 0 010 7"/></svg>';
const ICON_END = '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4l5 5 5-5M7 10l5 5 5-5M5 20h14"/></svg>';

function paintLib() {
  if (!S.cards.length) {
    shell('卡片库',
      '<div class="empty"><span class="big">&#9634;</span>卡片库是空的<br>在句子阅读里生成详解、点「保存到卡片库」后，卡片会出现在这里</div>' +
      (S.trash ? '<button class="btn wide" onclick="undoDel()">撤销上一次删除（' + S.trash.items.length + ' 张）</button>' : ''));
    return;
  }
  const k = libLang();
  const list = S.cards.filter(c => c.lang === k);          // S.cards 本来就按 pos 排好了
  let body = '<div class="ltabs">' + LK.map(x => {
    const n = S.cards.filter(c => c.lang === x).length;
    return '<button class="' + (x === k ? 'on' : '') + '" data-tab="' + x + '">' + libTabName(x) +
      (n ? '<i>' + n + '</i>' : '') + '</button>';
  }).join('') + '</div>';

  if (!ossReady()) {
    body += '<p class="note" style="margin-top:0">云端没有启用：卡片详解目前只存在这台设备上，换设备或重装会丢。到「设置 → 云端同步」打开后会自动上传。</p>';
  }
  if (S.trash) body += '<div class="row" style="margin-bottom:6px"><button class="btn sm" onclick="undoDel()">撤销删除（' + S.trash.items.length + ' 张）</button></div>';

  if (!list.length) {
    body += '<div class="empty" style="padding:10vh 20px">还没有' + esc(LANGS[k].zh) + '卡片</div>';
    shell('卡片库', body); bindLib(); return;
  }

  body += '<p class="note" style="margin:6px 0 12px">共 ' + list.length + ' 张。点卡片展开详解；还不熟的点右侧「移到最后」，下一轮还会轮到它。</p>' +
    '<div class="lib">';
  list.forEach(c => {
    const L = LANGS[c.lang] || {};
    const op = !!LIB.open[c.id];
    body += '<div class="lc lcd' + (op ? ' open' : '') + '">' +
      '<div class="top" data-tog="' + c.id + '">' +
      '<div class="fr ' + scriptCls(c.lang) + '">' + esc(c.front) + '</div>' +
      '<div class="side">' +
      (L.tts ? '<button class="ib" data-spk="' + c.id + '" title="发音" aria-label="发音">' + ICON_SPK + '</button>' : '') +
      '<button class="ib" data-last="' + c.id + '" title="移到最后" aria-label="移到最后">' + ICON_END + '</button>' +
      '</div></div>' +
      (op ? '<div class="lbody" data-body="' + c.id + '">' + libBodyHtml(c) + '</div>' : '') +
      '</div>';
  });
  body += '</div>';
  shell('卡片库', body);
  bindLib();
  list.forEach(c => { if (LIB.open[c.id]) libFill(c); });
}

/* 展开区：正文已在内存里就直接画；否则先放占位，再异步取 */
function libBodyHtml(c) {
  const hit = LIB.cache.get(c.id);
  if (hit && hit.bv === c.bv) return libDetailHtml(c, hit.b);
  return '<div class="note" style="margin:12px 0">' + LOADER + ' 正在取详解</div>';
}
function libDetailHtml(c, b) {
  return '<div class="rend lrend ' + scriptCls(c.lang) + '">' + renderCodes(b.d) + '</div>' +
    (b.n ? '<div class="lsec">追问详解</div><div class="rend lrend">' + renderCodes(b.n) + '</div>' : '') +
    '<div class="mt">' + esc(agoText(cardCreated(c))) + ' · ' + new Date(cardCreated(c)).toLocaleDateString('zh-CN') + '</div>' +
    '<div class="acts">' +
    '<button class="btn sm pri" data-copy="' + c.id + '">复制墨墨格式</button>' +
    '<button class="btn sm" data-edit="' + c.id + '">编辑</button>' +
    '<button class="btn sm" data-del="' + c.id + '">删除</button>' +
    '</div>';
}
async function libFill(c) {
  const hit = LIB.cache.get(c.id);
  if (hit && hit.bv === c.bv) return;
  let html;
  try {
    const b = await cbLoad(c);
    LIB.cache.set(c.id, { bv: c.bv, b: b });
    html = libDetailHtml(c, b);
  } catch (e) {
    html = '<div class="err" style="margin:12px 0">' + esc(e.message) + '</div>' +
      '<div class="acts"><button class="btn sm" data-retry="' + c.id + '">重试</button>' +
      '<button class="btn sm" data-del="' + c.id + '">删除</button></div>';
  }
  /* 等的这会儿用户可能已经收起了这张卡、切了标签页，或者整页重画过：只填还在的那个格子 */
  const el = document.querySelector('[data-body="' + c.id + '"]');
  if (el && LIB.open[c.id]) el.innerHTML = html;
}

function bindLib() {
  const root = document.querySelector('.body');
  if (!root) return;
  /* 整个页面只挂一个点击处理：按钮各管各的，点卡片其他位置才展开/收起 */
  root.onclick = e => {
    const t = e.target;
    const tab = t.closest('[data-tab]');
    if (tab) { LIB.lang = tab.dataset.tab; paintLib(); return; }
    const b = t.closest('[data-spk],[data-last],[data-copy],[data-edit],[data-del],[data-retry]');
    if (b) {
      const d = b.dataset, id = d.spk || d.last || d.copy || d.edit || d.del || d.retry;
      const c = S.cards.find(x => x.id === id);
      if (!c) return;
      if (d.spk) { say(c.lang, c.front, b); return; }
      if (d.last) { moveToEnd(id); return; }
      if (d.del) { delCards([id]); return; }
      if (d.retry) { libFill(c); return; }
      const hit = LIB.cache.get(id);
      if (!hit) return;
      if (d.copy) copyText(mjCard(hit.b.d, hit.b.n));
      if (d.edit) go('cedit', { id: id, lang: c.lang, text: hit.b.d, notes: hit.b.n });
      return;
    }
    const tog = t.closest('[data-tog]');
    if (tog) {
      const id = tog.dataset.tog;
      LIB.open[id] = !LIB.open[id];
      if (!LIB.open[id]) LIB.cache.delete(id);               // 收起就把正文放掉，不在内存里攒
      paintLib();
    }
  };
}

/* 移到最后：在卡片库里直接复习时，没记住的往后放，下一轮还会轮到。
   pos 压到全库最小值以下；ts 必须一起更新，否则云端合并会拿另一台设备上的旧位置把它打回去。 */
function moveToEnd(id) {
  const i = S.cards.findIndex(x => x.id === id);
  if (i < 0) return;
  const c = S.cards[i];
  const prev = { id: id, i: i, pos: cardPos(c) };
  c.ct = cardCreated(c);
  c.pos = Math.min.apply(null, S.cards.map(cardPos)) - 1;
  c.ts = Date.now();
  S.cards.splice(i, 1);
  S.cards.push(c);
  LIB.open[id] = false; LIB.cache.delete(id);
  saveCards(); paintLib();
  toast('已移到最后', '撤销', () => undoMove(prev));
}
function undoMove(prev) {
  const i = S.cards.findIndex(x => x.id === prev.id);
  if (i < 0) return;
  const c = S.cards[i];
  c.pos = prev.pos;
  c.ts = Date.now();                  // 撤销也是一次新的修改，同样要能同步出去
  S.cards.splice(i, 1);
  S.cards.splice(Math.min(prev.i, S.cards.length), 0, c);
  saveCards(); paintLib();
}

function delCards(ids) {
  const items = [];
  ids.forEach(id => {
    const i = S.cards.findIndex(x => x.id === id);
    if (i > -1) items.push({ i: i, c: S.cards[i] });
  });
  if (!items.length) return;
  items.sort((a, b) => b.i - a.i).forEach(o => S.cards.splice(o.i, 1));
  items.forEach(o => { markDel(o.c); LIB.open[o.c.id] = false; LIB.cache.delete(o.c.id); });   // 留墓碑，否则下一次云端同步会把它们原样长回来
  S.trash = { items: items.slice().sort((a, b) => a.i - b.i) };
  saveCards(); paintLib();
  toast('已删除 ' + items.length + ' 张', '撤销', undoDel);
}
/* 撤销只恢复索引：正文要么还在本机缓存，要么一直在云端（删卡不删云端正文，就是为了能撤销） */
function undoDel() {
  if (!S.trash) { toast('没有可撤销的删除'); return; }
  S.trash.items.forEach(o => {
    S.cards.splice(Math.min(o.i, S.cards.length), 0, o.c);
    unmarkDel(o.c);
  });
  S.trash = null; saveCards(); paintLib(); toast('已恢复');
}

/* edit an existing card's detail */
VIEWS.cedit = function (d) {
  const h = deditBody({ text: d.text, lang: d.lang }, 'ctext') + notesBody(d) +
    '<div class="spacer"></div>' +
    '<div class="split">' +
    '<button class="btn" onclick="copyText(mjCard(deText(\'ctext\'), notesText()))">复制墨墨格式</button>' +
    '<button class="btn pri" onclick="saveEdit()">保存修改</button>' +
    '<button class="btn" onclick="back()">取消</button>' +
    '</div>';
  shell('编辑卡片', h);
  bindDedit('ctext');
};
function saveEdit() {
  const cu = S.stack[S.stack.length - 1].arg;
  const c = S.cards.find(x => x.id === cu.id);
  if (c) {
    const now = Date.now();
    c.bv = now; c.ts = now;                     // 正文变了：bv 让别的设备的缓存失效，ts 让索引合并认这一版
    cbPut(c.id, { d: deText('ctext'), n: notesText(), bv: now }, false);
    LIB.cache.delete(c.id);
    saveCards();
  }
  back(); toast('已保存');
}
