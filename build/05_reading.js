/* ================= Yulengua · 句子阅读 ================= */

const R = { lang: null, hist: [], idx: -1, busy: false, err: '' };
const cur = () => R.hist[R.idx] || null;

const getSeen = k => (S.seen && Array.isArray(S.seen[k])) ? S.seen[k] : [];
function pushSeen(k, t) {
  S.seen[k] = getSeen(k).concat([t]).slice(-40);
  saveSeen();
}

VIEWS.read = function (k) {
  if (R.lang !== k) { R.lang = k; R.hist = []; R.idx = -1; R.err = ''; }
  paintRead();
  if (!cur() && !R.busy) nextSent();
};

function speakBtn(k, text, label) {
  if (!LANGS[k] || !LANGS[k].tts) return '';
  return '<button class="btn sm" onclick="say(\'' + k + '\',' + jsq(text) + ',this)">&#9654;' +
    (label === false ? '' : ' ' + (label || '发音')) + '</button>';
}

function sentHtml() {
  const k = R.lang, s = cur().sent;
  const toks = s.tokens.length ? s.tokens : segUnits(k, s.text);
  const j = (k === 'ja' || k === 'bo') ? '' : ' ';
  /* 藏语：录过音的词加一个小圆点，一眼看得出哪些已经读过 */
  const words = toks.map((t, i) => {
    const rec = k === 'bo' && boGet(t);
    const cls = 'w' + (rec && rec.h ? ' has' : (rec && rec.p ? ' pron' : ''));
    return '<span class="' + cls + '" data-i="' + i + '">' + esc(t) + '</span>';
  }).join(j);
  let h = '<div class="sent ' + scriptCls(k) + '">' + words + '</div>';
  if (k === 'kk' && s.alt) h += '<div class="sent ar" style="margin-top:14px">' + esc(s.alt) + '</div>';
  if ((k === 'bo' || k === 'kk' || k === 'ru') && s.translit) h += '<div class="translit">' + esc(s.translit) + '</div>';
  h += handHtml(k, s.text);
  return h;
}

function paintRead() {
  const k = R.lang, L = LANGS[k], c = cur();
  let body = '';
  if (R.err) body += '<div class="err">' + esc(R.err) +
    '<div class="row" style="margin-top:10px"><button class="btn sm" onclick="regenSent()">&#8635; 重试</button></div></div>';

  if (!c) {
    body += R.busy
      ? '<div class="empty"><span class="big">&#8230;</span>正在生成' + L.zh + '例句</div>'
      : '<div class="empty"><span class="big">&#8212;</span>点击下方按钮开始</div><button class="btn pri wide" onclick="nextSent()">生成例句</button>';
    shell(L.zh, body);
    return;
  }
  const s = c.sent;

  body += '<div class="card">' + sentHtml();

  if (c.show) {
    body += '<div class="trans">' + esc(s.zh) +
      (L.en && s.en ? '<div class="en">' + esc(s.en) + '</div>' : '') +
      (k === 'ja' && s.translit ? '<div class="en">' + esc(s.translit) + '</div>' : '') +
      '</div>';
  }

  body += '<div class="row" style="margin-top:18px">' +
    '<button class="btn sm' + (c.show ? ' on' : '') + '" onclick="toggleTrans()">' + (c.show ? '隐藏译文' : '显示译文') + '</button>' +
    speakBtn(k, s.text) +
    '<button class="btn sm" onclick="regenSent()" title="换一句">&#8635; 重新生成</button>' +
    '<span class="hint" style="margin-left:auto">' + (R.idx + 1) + ' / ' + R.hist.length + '</span>' +
    '</div>';
  body += '<p class="hint" style="margin-top:14px">点击任意单词查看释义</p></div>';

  if (c.qa.length) {
    body += '<div class="qa">' + c.qa.map(x =>
      '<div class="q">' + esc(x.q) + '</div><div class="a">' + esc(x.a) + '</div>').join('') + '</div>';
  }
  if (R.busy) body += '<div style="margin-top:18px">' + LOADER + '</div>';

  const nwq = wordQaFor(k, s.text).length;
  body += '<div class="spacer"></div><div class="spacer"></div>' +
    '<button class="btn pri wide" onclick="makeDetail(this)">保存到卡片库</button>' +
    (nwq ? '<p class="note" style="text-align:center">会一并带上你在词卡里追问的 ' + nwq + ' 条内容</p>' : '') +
    '<div class="spacer"></div>' +
    '<div class="split">' +
    '<button class="btn" onclick="prevSent()"' + (R.idx <= 0 ? ' disabled' : '') + '>&#8249; 上一句</button>' +
    '<button class="btn" onclick="nextSent()">下一句 &#8250;</button>' +
    '</div>';

  const bar = '<div class="askbar">' +
    '<textarea id="askin" rows="1" placeholder="继续追问这句话…" oninput="autosize(this)"></textarea>' +
    '<button class="go" id="askgo" onclick="askSent()">&#8593;</button></div>';

  shell(L.zh, body, { bar: bar, right: NAV_LIB });

  document.querySelectorAll('.sent .w').forEach(el => {
    el.onclick = () => openWord(parseInt(el.dataset.i, 10), el);
  });
}

function toggleTrans() { const c = cur(); if (c) { c.show = !c.show; paintRead(); } }

function buildSent(j, k) {
  let txt = (j.text || '').trim();
  let trl = (j.translit || '').trim();
  let toks = Array.isArray(j.tokens) ? j.tokens : [];
  if (k === 'ru') {
    trl = ruLat(trl || txt);
    txt = ruPlain(txt);
    toks = toks.map(x => ruPlain(String(x == null ? '' : x)));   // 否则带重音符号的 token 在原句里定位不到
  }
  /* 模型的切分不可信，这里按原句本地校准一遍 */
  const fx = fixToks(k, txt, toks, j.gloss);
  return {
    text: txt,
    alt: k === 'kk' ? kkArab(txt) : (j.alt || '').trim(),
    translit: k === 'kk' ? kkLat(txt) : trl,
    zh: (j.zh || '').trim(), en: (j.en || '').trim(), tokens: fx.tokens, gloss: fx.gloss
  };
}

async function nextSent() {
  if (needKey() || R.busy) return;
  if (R.idx < R.hist.length - 1) { R.idx++; R.err = ''; paintRead(); return; }
  R.busy = true; R.err = ''; paintRead();
  try {
    const sent = buildSent(await aiJson(sentencePrompt(R.lang, getSeen(R.lang)), R.lang), R.lang);
    if (!sent.text) throw new Error('模型返回了空句子');
    R.hist.push({ sent: sent, qa: [], show: false });
    if (R.hist.length > 60) R.hist.shift();
    R.idx = R.hist.length - 1;
    pushSeen(R.lang, sent.text);
  } catch (e) { R.err = '生成失败 · ' + e.message; }
  R.busy = false; paintRead();
}

/* 重新生成当前这一句：就地替换，不新增历史，也不把废句留在难度基准里 */
async function regenSent() {
  if (needKey() || R.busy) return;
  const c = cur();
  if (!c) { nextSent(); return; }
  const oldText = c.sent.text;
  R.busy = true; R.err = ''; paintRead();
  try {
    const sent = buildSent(await aiJson(sentencePrompt(R.lang, getSeen(R.lang)), R.lang), R.lang);
    if (!sent.text) throw new Error('模型返回了空句子');
    S.seen[R.lang] = getSeen(R.lang).filter(t => t !== oldText);
    R.hist[R.idx] = { sent: sent, qa: [], show: false };
    pushSeen(R.lang, sent.text);
  } catch (e) { R.err = '重新生成失败 · ' + e.message; }
  R.busy = false; paintRead();
}

function prevSent() {
  if (R.idx <= 0 || R.busy) return;
  R.idx--; R.err = ''; paintRead();
}

/* ---------- 哈萨克字母形体 ---------- */
const KK_NONJOIN = 'اٵدذرزژوۇۆۋٶءأإآ';
const ZWJ = '\u200D';
function kkForms(ar) {
  const s = String(ar || '').trim();
  if (!s) return null;
  const base = s[s.length - 1];
  const joins = KK_NONJOIN.indexOf(base) === -1;
  return {
    iso: s,
    ini: joins ? s + ZWJ : null,
    med: joins ? ZWJ + s + ZWJ : null,
    fin: ZWJ + s
  };
}
function kkTable(word) {
  const letters = kkLetterRows(word);
  if (!letters.length) return '';
  const cell = v => v == null ? '<b class="na">—</b>' : '<b>' + esc(v) + '</b>';
  let h = '<div class="sec" style="margin-bottom:8px">字母对照</div><div class="klt">' +
    '<div class="hd"><span>西里尔</span><span class="fm">' +
    '<span>单立</span><span>前连</span><span>中连</span><span>后连</span></span><span class="lt">拉丁</span></div>';
  letters.forEach(l => {
    const f = l.ar ? kkForms(l.ar) : null;
    h += '<div class="rw"><span class="cy">' + esc(l.cy || '') + '</span>' +
      '<span class="fm">' + (f ? cell(f.iso) + cell(f.ini) + cell(f.med) + cell(f.fin) : cell(null) + cell(null) + cell(null) + cell(null)) + '</span>' +
      '<span class="lt">' + esc(l.lat || '') + '</span>' +
      (l.note ? '<span class="nt">' + esc(l.note) + '</span>' : '') + '</div>';
  });
  return h + '</div>';
}

/* ---------- word sheet: 第一层翻译 / 第二层详解 ---------- */
const wordCache = new Map();

function tokAt(i) {
  const s = cur().sent;
  const toks = s.tokens.length ? s.tokens : segUnits(R.lang, s.text);
  const raw = String(toks[i] || '');
  return { raw: raw, word: cleanTok(raw), gloss: (s.gloss && s.gloss[i]) || '' };
}

/* 通用词卡：句子阅读和场景对话共用。
   第一层用随句返回的简译，瞬时、零请求；第二层才调 AI。 */
let WSHEET = null;

function showWord(k, word, gloss, context) {
  if (!word) return;
  WSHEET = { k: k, word: word, context: context || word };
  BO.edit = false; BO.busy = '';
  const ck = k + '|' + word + '|' + WSHEET.context;
  if (wordCache.has(ck)) { sheet(wordHtml(wordCache.get(ck))); return; }
  sheet(
    '<div class="wh"><span class="ww ' + scriptCls(k) + '">' + esc(word) + '</span></div>' +
    (k === 'kk' ? '<div class="ar" style="font-size:22px;margin-top:8px">' + esc(kkArab(word)) + '</div>' +
      '<div class="translit" style="margin-top:4px">' + esc(kkLat(word)) + '</div>' : '') +
    (k === 'ru' ? '<div class="translit" style="margin-top:6px">' + esc(ruLat(word)) + '</div>' : '') +
    handHtml(k, word, true) +
    '<div class="gl">' + (gloss ? escp(gloss) : '<span class="hint">这个词没有随句简译，点下方展开详解</span>') + '</div>' +
    (LANGS[k] && LANGS[k].tts ? '<div class="row" style="margin-top:14px">' + speakBtn(k, word) + '</div>' : '') +
    (k === 'bo' ? boPanel(word) : '') +
    '<div class="spacer"></div>' +
    '<button class="btn pri wide" onclick="expandWord(this)">展开详解</button>' +
    '<p class="note" style="text-align:center">展开会调用 AI，生成词性、变位、例句与详细解释</p>'
  );
}

function openWord(i, el) {
  document.querySelectorAll('.sent .w.on').forEach(n => n.classList.remove('on'));
  el && el.classList.add('on');
  const t = tokAt(i);
  showWord(R.lang, t.word, t.gloss, cur().sent.text);
}

async function expandWord(btn) {
  if (needKey() || !WSHEET) return;
  const w = WSHEET;
  const ck = w.k + '|' + w.word + '|' + w.context;
  btn.innerHTML = LOADER + ' 正在解析'; btn.disabled = true;
  try {
    const j = await aiJson(wordPrompt(w.k, w.word, w.context), w.k);
    if (!j || (!String(j.zh || '').trim() && !String(j.note || '').trim())) throw new Error('模型返回了空解析');
    j._lang = w.k; j._ctx = w.context; j._w = w.word;
    wordCache.set(ck, j);
    sheet(wordHtml(j));
  } catch (e) {
    btn.innerHTML = '重试'; btn.disabled = false;
    const p = document.createElement('div');
    p.className = 'err'; p.textContent = '解析失败 · ' + e.message;
    btn.parentNode.insertBefore(p, btn);
  }
}

/* 把一句话渲染成可点击的词；tokens 缺失时用本地切分兜底 */
function tapWords(k, text, tokens, gloss, group) {
  const toks = (Array.isArray(tokens) && tokens.length) ? tokens : segUnits(k, text);
  const j = (k === 'ja' || k === 'bo') ? '' : ' ';
  return toks.map((t, i) =>
    '<span class="w" data-tw="' + group + '" data-ti="' + i + '">' + esc(t) + '</span>').join(j);
}
/* getSource 返回的对象里可以带 lang，用来覆盖默认语言（反向翻译一页六种语言） */
function bindTapWords(k, getSource) {
  document.querySelectorAll('[data-tw]').forEach(el => {
    el.onclick = () => {
      const src = getSource(el.dataset.tw);
      if (!src) return;
      const lk = src.lang || k;
      const i = +el.dataset.ti;
      const toks = (Array.isArray(src.tokens) && src.tokens.length) ? src.tokens : segUnits(lk, src.text);
      document.querySelectorAll('[data-tw].on').forEach(n => n.classList.remove('on'));
      el.classList.add('on');
      showWord(lk, cleanTok(toks[i]), (src.gloss && src.gloss[i]) || '', src.text);
    };
  });
}

function wordHtml(j) {
  const k = j._lang, L = LANGS[k];
  if (k === 'kk') {
    j.alt = kkArab(j.word || '');
    j.translit = kkLat(j.word || '');
  }
  if (k === 'ru') {
    j.translit = ruLat(j.translit || j.word || '');
    j.word = ruPlain(j.word || '');
    j.lemma = ruPlain(j.lemma || '');
    if (j.example && j.example.text) j.example.text = ruPlain(j.example.text);
    if (Array.isArray(j.forms)) j.forms = j.forms.map(f =>
      ({ k: f.k, v: ruDualInline(String(f.v == null ? '' : f.v)) }));
  }
  /* 界面字段一律走 escp：模型偶尔会把墨墨标记写进来，这里剥掉再显示 */
  let h = '<div class="wh">' +
    '<span class="ww ' + scriptCls(k) + '">' + escp(j.word || '') + '</span>' +
    (j.gender ? '<span class="tag">' + escp(j.gender) + '</span>' : '') +
    (j.pos ? '<span class="tag">' + escp(j.pos) + '</span>' : '') +
    (j.lemma && j.lemma !== j.word ? '<span class="lm">原形 ' + escp(j.lemma) + '</span>' : '') +
    '</div>';
  if (j.alt) h += '<div class="ar" style="font-size:20px;margin-top:8px">' + esc(j.alt) + '</div>';
  if (j.translit) h += '<div class="translit" style="margin-top:6px">' + escp(j.translit) + '</div>';
  h += handHtml(k, unmark(j.word || ''), true);
  if (L.tts) h += '<div class="row" style="margin-top:12px">' + speakBtn(k, unmark(j.word || '')) + '</div>';
  h += '<div class="def">' + escp(j.zh || '') +
    (j.en ? '<div class="hint" style="margin-top:5px;font-size:13.5px">' + escp(j.en) + '</div>' : '') + '</div>';
  if (j.example && j.example.text) {
    const ex = unmark(j.example.text);
    h += '<div class="ex"><span class="' + scriptCls(k) + '">' + esc(ex) + '</span> ' +
      speakBtn(k, ex, false) +
      (k === 'kk' ? '<div class="ar" style="font-size:19px;margin-top:4px">' + esc(kkArab(ex)) + '</div>' +
        '<div class="translit" style="margin-top:2px">' + esc(kkLat(ex)) + '</div>' : '') +
      (k === 'ru' ? '<div class="translit" style="margin-top:4px">' + esc(ruLat(ex)) + '</div>' : '') +
      '<s>' + escp(j.example.zh || '') + '</s></div>';
  }
  if (Array.isArray(j.forms) && j.forms.length) {
    h += '<div class="forms">' + j.forms.map(f =>
      '<div><b>' + escp(f.k || '') + '</b><span>' + escp(f.v || '') + '</span></div>').join('') + '</div>';
  }
  if (j.note) h += '<div class="expl">' + escp(j.note) + '</div>';
  if (k === 'kk') h += kkTable(j.word || '');
  if (k === 'bo') h += boPanel(j.word || (WSHEET && WSHEET.word) || '');
  if (Array.isArray(j._qa) && j._qa.length) {
    h += '<div class="qa">' + j._qa.map(x =>
      '<div class="q">' + esc(x.q) + '</div><div class="a">' + esc(x.a) + '</div>').join('') + '</div>';
  }
  h += '<div class="wask">' +
    '<textarea id="wsin" rows="1" placeholder="就这个词继续追问…" oninput="autosize(this)"></textarea>' +
    '<button class="go" onclick="askWordSheet()">&#8593;</button></div>';
  return h;
}

/* 词卡内追问：问答跟着这个词一起缓存，重新打开还在 */
async function askWordSheet() {
  if (needKey() || !WSHEET) return;
  const ta = $('wsin'); const q = ta.value.trim();
  if (!q) return;
  const ck = WSHEET.k + '|' + WSHEET.word + '|' + WSHEET.context;
  const j = wordCache.get(ck);
  if (!j) { toast('请先展开详解'); return; }
  ta.value = ''; ta.blur();
  j._qa = j._qa || [];
  j._qa.push({ q: q, a: '…' });
  sheet(wordHtml(j), true);
  $('sheet').scrollTop = $('sheet').scrollHeight;
  try {
    const a = await ai(wordAskPrompt(j, WSHEET.context, j._qa.slice(0, -1), q), false, j._lang);
    j._qa[j._qa.length - 1].a = a;
  } catch (e) {
    j._qa.pop();
    toast('追问失败 · ' + e.message);
  }
  sheet(wordHtml(j), true);
  $('sheet').scrollTop = $('sheet').scrollHeight;
  refreshUnderSheet();
}

/* 词卡开着的时候底下那一页也要重画一次，否则「会带上 N 条追问」的计数、
   藏语录音的圆点标记都不会更新。sheet 是独立于 #app 的层，重画不会把它关掉。
   注意必须按【栈顶真正的那一页】来判断：以前藏语存注音/录音时无条件调 paintRead()，
   结果在单词查询里录完音、一关词卡，底下已经被换成句子阅读了。 */
function refreshUnderSheet() {
  const v = S.stack[S.stack.length - 1];
  if (!v) return;
  if (v.view === 'read') { if (cur()) paintRead(); }
  else if (v.view === 'lookup') paintLookup();
  else if (v.view === 'dlg') paintDlg();
  else if (v.view === 'pulse') paintPulse();
  else { const f = VIEWS[v.view]; if (f) f(v.arg); }   // 不能走 render()，那会把词卡关掉
}

/* ---------- ask ---------- */
async function askSent() {
  if (needKey() || R.busy) return;
  const ta = $('askin'); const q = ta.value.trim();
  if (!q) return;
  const c = cur(); if (!c) return;
  ta.value = ''; autosize(ta); ta.blur();
  R.busy = true; R.err = '';
  c.qa.push({ q: q, a: '…' });
  paintRead();
  try {
    const a = await ai(askPrompt(R.lang, c.sent, c.qa.slice(0, -1), q), false, R.lang);
    c.qa[c.qa.length - 1].a = a;
  } catch (e) { c.qa.pop(); R.err = '追问失败 · ' + e.message; }
  R.busy = false; paintRead();
  window.scrollTo(0, document.body.scrollHeight);
}

/* ---------- 生成详解 -> 预览页 ---------- */
/* 你在词卡里就某个词追问过的东西，属于这句话的一部分，生成整句卡片时
   必须一并带上——否则问明白的那些点不会出现在卡片里，等于白问。 */
/* ctx 可以是一句话，也可以是一组上下文——Daily Pulse 里，你可能是在词表上
   点开某个词问的（上下文就是那个词本身），也可能是在造出来的句子里点开问的。
   两种都属于这句话的一部分，生成卡片时都得带上。 */
function wordQaFor(k, ctx) {
  const set = new Set((Array.isArray(ctx) ? ctx : [ctx]).filter(Boolean));
  const out = [];
  wordCache.forEach(j => {
    if (!j || j._lang !== k || !set.has(j._ctx)) return;
    (j._qa || []).forEach(x => {
      if (!x || !x.q || !x.a || x.a === '…') return;
      out.push({ q: '（关于句中的「' + (j._w || j.word || '') + '」）' + x.q, a: x.a });
    });
  });
  return out;
}

async function detailFor(k, sent, qa, btn, extraCtx) {
  if (needKey()) return;
  const old = btn.innerHTML; btn.innerHTML = LOADER + ' 正在生成详解'; btn.disabled = true;
  try {
    const allQa = (qa || []).concat(wordQaFor(k, [sent.text].concat(extraCtx || [])));
    /* 追问不再喂给模型去「整合」进详解：它们原样放进卡片的「追问详解」一栏（保存前可编辑），
       既不丢，也不会和正文重复讲一遍。 */
    const notes = allQa.map(x => '问：' + x.q + '\n答：' + x.a).join('\n\n');
    let txt = await ai(detailPrompt(k, sent, []), false, k);
    if (k === 'kk') txt = kkDual(txt);
    if (k === 'ru') txt = ruDual(txt);
    const lint = markjiLint(txt);
    txt = lint.text;
    if (lint.fixed.length) toast('已自动整理墨墨语法：' + lint.fixed[0] + (lint.fixed.length > 1 ? ' 等 ' + lint.fixed.length + ' 处' : ''));
    DE.mode = 'raw';
    go('dedit', { lang: k, front: sent.text, text: txt.trim(), notes: notes });
  } catch (e) {
    btn.innerHTML = old; btn.disabled = false;
    toast('生成失败 · ' + e.message);
  }
}

function makeDetail(btn) {
  const c = cur(); if (!c) return;
  detailFor(R.lang, c.sent, c.qa, btn);
}

/* ---------- 详解预览 / 编辑 ---------- */
let DE = { mode: 'raw' };

function lintBar(text, id) {
  const r = markjiLint(text);
  const canFix = r.text !== text;
  if (r.ok && !canFix) return '<div class="lint"><b>&#10003; 墨墨语法检查通过</b>可以直接复制进墨墨记忆卡。</div>';
  let h = '<div class="lint' + (r.warn.length ? ' bad' : '') + '"><b>' +
    (r.warn.length ? '墨墨语法检查发现 ' + r.warn.length + ' 处问题' : '有可以自动整理的地方') + '</b>';
  if (r.warn.length) h += '<ul>' + r.warn.map(w => '<li>' + esc(w) + '</li>').join('') + '</ul>';
  if (canFix) h += '<div class="row" style="margin-top:9px"><button class="btn sm" onclick="applyLint(\'' + id + '\')">一键整理</button></div>';
  return h + '</div>';
}
function applyLint(id) {
  const cu = S.stack[S.stack.length - 1].arg;
  const r = markjiLint(deText(id));
  cu.text = r.text;
  render();
  toast(r.fixed.length ? '已整理：' + r.fixed.join('；') : '没有可自动整理的问题');
}

function deditBody(d, id) {
  return '<div class="row" style="margin-bottom:12px">' +
    '<button class="btn sm' + (DE.mode === 'raw' ? ' on' : '') + '" onclick="DE.mode=\'raw\';render()">原文</button>' +
    '<button class="btn sm' + (DE.mode === 'view' ? ' on' : '') + '" onclick="DE.mode=\'view\';render()">渲染预览</button>' +
    (existingCard(d) ? '<span class="hint" style="margin-left:auto">卡片库中已有这一条，保存将覆盖</span>' : '') +
    '</div>' +
    (DE.mode === 'raw'
      ? '<textarea class="fld" id="' + id + '" style="min-height:54vh;font-size:14px;line-height:1.75;font-family:ui-monospace,Menlo,monospace">' + esc(d.text) + '</textarea>'
      : '<div class="rend">' + renderCodes(d.text) + '</div>') +
    lintBar(d.text, id);
}
function bindDedit(id) {
  if (DE.mode === 'raw' && $(id)) $(id).oninput = () => { S.stack[S.stack.length - 1].arg.text = $(id).value; };
  if (DE.mode === 'raw' && $('ntext')) $('ntext').oninput = () => { S.stack[S.stack.length - 1].arg.notes = $('ntext').value; };
}
/* 追问详解：你在阅读里追问得到的解答，和详解正文分开存。保存前可以随便删改，留空也行 */
function notesBody(d) {
  return '<div class="sec" style="margin-top:26px">追问详解</div>' +
    (DE.mode === 'raw'
      ? '<textarea class="fld" id="ntext" placeholder="你追问得到的解答会放在这里，可以删改；没有就留空。" style="min-height:22vh;font-size:14px;line-height:1.75">' + esc(d.notes || '') + '</textarea>'
      : '<div class="rend">' + (d.notes ? renderCodes(d.notes) : '<span class="hint">（空）</span>') + '</div>');
}
function notesText() {
  const cu = S.stack[S.stack.length - 1].arg;
  return ((DE.mode === 'raw' && $('ntext')) ? $('ntext').value : (cu.notes || '')).trim();
}
/* 导出给墨墨的整张卡：详解在前，追问详解接在答案面末尾 */
function mjCard(detail, notes) {
  let t = String(detail || '').trim();
  const n = String(notes || '').trim();
  if (n) t += '\n\n[T#B#追问详解]\n' + n;
  return markjiLint(t).text;
}
function deText(id) {
  const cu = S.stack[S.stack.length - 1].arg;
  return ((DE.mode === 'raw' && $(id)) ? $(id).value : cu.text).trim();
}
function existingCard(d) {
  return d.front ? S.cards.find(x => x.lang === d.lang && x.front === d.front) : null;
}

VIEWS.dedit = function (d) {
  const h = '<div class="sec">预览与编辑</div>' + deditBody(d, 'dtext') + notesBody(d) +
    '<p class="note">高亮指令 [T#!色#字] / [T#!!色#字] 与答案线 --- 会原样保留。发音标记 [Audio#…] 需你自己后加。' +
    '复制墨墨格式时，追问详解会接在答案面末尾。</p>' +
    '<div class="spacer"></div>' +
    '<div class="split">' +
    '<button class="btn" onclick="copyDetail()">复制</button>' +
    '<button class="btn pri" onclick="saveDetail()">保存到卡片库</button>' +
    '<button class="btn" onclick="back()">取消</button>' +
    '</div>';
  shell('句子详解', h);
  bindDedit('dtext');
};

function copyDetail() { copyText(mjCard(deText('dtext'), notesText())); }

async function saveDetail() {
  const cu = S.stack[S.stack.length - 1].arg;
  const text = deText('dtext'), notes = notesText();
  const old = existingCard(cu);
  const now = Date.now();
  if (old) {
    /* 取不到旧正文（离线且没缓存）就当作变了，宁可多覆盖一次也别把新内容丢掉 */
    const ob = await cbLoad(old).catch(() => null);
    const changed = !ob || ob.d !== text || ob.n !== notes;
    if (changed) { old.bv = now; cbPut(old.id, { d: text, n: notes, bv: now }, false); }
    old.ts = now; old.pos = now; old.ct = cardCreated(old); unmarkDel(old);
    S.cards = [old].concat(S.cards.filter(x => x !== old));
    saveCards(); back();
    toast(changed ? '已更新卡片库中的这一条' : '内容无变化，已保留原卡片');
    return;
  }
  const fresh = {
    id: 'c' + now + Math.random().toString(36).slice(2, 6),
    lang: cu.lang, front: cu.front,
    ts: now, pos: now, ct: now, bv: now
  };
  cbPut(fresh.id, { d: text, n: notes, bv: now }, false);
  S.cards.unshift(fresh);
  unmarkDel(fresh);                 // 删过又重新存的，墓碑要撤掉
  saveCards(); back();
  toast('已存入卡片库（共 ' + S.cards.length + ' 张）');
}
