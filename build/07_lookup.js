/* ================= Yulengua · 单词查询 / 整句翻译 ================= */

const W = {
  q: '', items: [], sel: 0, qa: [], busy: false, err: '', mode: 'word',
  sent: null, sqa: [],
  rev: null, rsel: 0, rqa: []          // 反向翻译：中/英 → 六种语言
};

const W_TITLE = { word: '单词查询', sent: '整句翻译', rev: '译成六语' };

VIEWS.lookup = function () { paintLookup(); };

function paintLookup() {
  let body = '<input class="fld" id="wq" autocapitalize="off" spellcheck="false" ' +
    'placeholder="查一个词，粘贴一整句，或输入中文/英文…" value="' + esc(W.q) + '" ' +
    'onkeydown="if(event.key===\'Enter\'){event.preventDefault();doLookup()}">' +
    '<div class="spacer"></div>' +
    '<div class="split">' +
    '<button class="btn' + (W.mode === 'word' ? ' pri' : '') + '" onclick="doLookup()">查词</button>' +
    '<button class="btn' + (W.mode === 'sent' ? ' pri' : '') + '" onclick="doTranslate()">翻译整句</button>' +
    '<button class="btn' + (W.mode === 'rev' ? ' pri' : '') + '" onclick="doReverse()">译成六语</button>' +
    '</div>' +
    '<p class="note">「查词」返回跨六种语言的候选词条；「翻译整句」判断语言后把外语译成中文；' +
    '「译成六语」方向相反——输入中文或英文（词或整句都行），一次给出六种语言的说法。三者都可以点词、追问、存成卡片。</p>';

  if (W.err) body += '<div class="err">' + esc(W.err) + '</div>';
  if (W.busy) body += '<div style="margin-top:22px">' + LOADER + ' 正在' +
    (W.mode === 'sent' ? '翻译' : W.mode === 'rev' ? '译成六种语言' : '查询') + '</div>';

  body += W.mode === 'sent' ? transHtml() : W.mode === 'rev' ? revHtml() : itemsHtml();

  if (W.mode === 'word' && W.qa.length) {
    body += '<div class="qa">' + W.qa.map(x =>
      '<div class="q">' + esc(x.q) + '</div><div class="a">' + esc(x.a) + '</div>').join('') + '</div>';
  }

  const canAsk = W.mode === 'sent' ? !!W.sent : W.mode === 'rev' ? !!(W.rev && W.rev.items.length) : !!W.items.length;
  const ph = W.mode === 'sent' ? '就这句话继续追问…'
    : W.mode === 'rev' ? '就选中的那一条继续追问…' : '对结果继续追问…';
  const askFn = W.mode === 'sent' ? 'askTrans()' : W.mode === 'rev' ? 'askRev()' : 'askWord()';
  const bar = canAsk ? '<div class="askbar">' +
    '<textarea id="wask" rows="1" placeholder="' + ph + '" oninput="autosize(this)"></textarea>' +
    '<button class="go" onclick="' + askFn + '">&#8593;</button></div>' : '';

  shell(W_TITLE[W.mode] || '单词查询', body, { bar: bar, right: NAV_LIB });

  if (W.mode === 'sent') bindTrans();
  else if (W.mode === 'rev') bindRev();
  else bindItems();
}

/* ---------------- 查词 ---------------- */
function itemsHtml() {
  if (!W.items.length) return '';
  let body = '<div class="sec">结果 · 共 ' + W.items.length + ' 条</div>';
  W.items.forEach((it, i) => {
    const L = LANGS[it.lang] || LANGS.nl;
    body += '<div class="card" style="margin-bottom:14px;' + (i === W.sel ? 'border-color:var(--fg2)' : '') + '" data-pick="' + i + '">' +
      '<div class="wh">' +
      '<span class="ww ' + scriptCls(it.lang) + '" style="font-size:23px">' + escp(it.word || '') + '</span>' +
      (it.gender ? '<span class="tag">' + escp(it.gender) + '</span>' : '') +
      (it.pos ? '<span class="tag">' + escp(it.pos) + '</span>' : '') +
      '<span class="lm">' + esc(L.zh) + '</span>' +
      '</div>' +
      (it.alt ? '<div class="ar" style="font-size:19px;margin-top:6px">' + esc(it.alt) + '</div>' : '') +
      (it.translit ? '<div class="translit" style="margin-top:5px">' + escp(it.translit) + '</div>' : '') +
      handHtml(it.lang, unmark(it.word || ''), true) +
      '<div class="def" style="font-size:15.5px">' + escp(it.zh || '') +
      (it.en ? '<div class="hint" style="margin-top:4px;font-size:13px">' + escp(it.en) + '</div>' : '') + '</div>' +
      (it.example && it.example.text
        ? '<div class="ex"><span class="' + scriptCls(it.lang) + '">' + esc(it.example.text) + '</span>' +
          (it.lang === 'kk' ? '<div class="ar" style="font-size:18px;margin-top:4px">' + esc(kkArab(it.example.text)) + '</div>' : '') +
          (it.lang === 'ru' ? '<div class="translit" style="margin-top:3px">' + esc(ruLat(it.example.text)) + '</div>' : '') +
          '<s>' + esc(it.example.zh || '') + '</s></div>' : '') +
      (Array.isArray(it.forms) && it.forms.length
        ? '<div class="forms">' + it.forms.map(f => '<div><span>' + esc(typeof f === 'string' ? f : (f.k ? f.k + '：' + f.v : f.v)) + '</span></div>').join('') + '</div>' : '') +
      '<div class="row" style="margin-top:16px">' +
      (L.tts ? '<button class="btn sm" data-spk="' + i + '">&#9654; 发音</button>' : '') +
      '<button class="btn sm" data-card="' + i + '">生成卡片</button>' +
      (i === W.sel ? '<span class="hint" style="margin-left:auto">追问对象</span>' : '') +
      '</div></div>';
  });
  return body;
}

function bindItems() {
  document.querySelectorAll('[data-pick]').forEach(c => {
    c.addEventListener('click', e => {
      if (e.target.closest('button')) return;
      W.sel = +c.dataset.pick; paintLookup();
    });
  });
  document.querySelectorAll('[data-spk]').forEach(b => {
    b.onclick = () => { const it = W.items[+b.dataset.spk]; say(it.lang, it.word, b); };
  });
  document.querySelectorAll('[data-card]').forEach(b => {
    b.onclick = () => makeWordCard(+b.dataset.card, b);
  });
}

async function doLookup() {
  if (needKey()) return;
  const q = $('wq').value.trim();
  if (!q) return;
  $('wq').blur();
  W.q = q; W.mode = 'word'; W.busy = true; W.err = ''; W.items = []; W.qa = []; W.sel = 0;
  W.sent = null; W.rev = null; W.rqa = []; W.rsel = 0;
  paintLookup();
  try {
    const j = await aiJson(lookupPrompt(q), guessLang(q));
    W.items = (j.items || []).filter(x => x && x.word && LANGS[x.lang]);
    W.items.forEach(it => {
      if (it.lang === 'kk') { it.alt = kkArab(it.word); it.translit = kkLat(it.word); }
      if (it.lang === 'ru') {
        it.translit = ruLat(it.translit || it.word);
        it.word = ruPlain(it.word);
        if (it.example && it.example.text) it.example.text = ruPlain(it.example.text);
      }
    });
    if (!W.items.length) W.err = '没有找到匹配的词，换个写法试试。';
  } catch (e) { W.err = '查询失败 · ' + e.message; }
  W.busy = false; paintLookup();
}

async function askWord() {
  if (needKey() || W.busy) return;
  const ta = $('wask'); const q = ta.value.trim();
  if (!q) return;
  ta.value = ''; autosize(ta); ta.blur();
  W.busy = true; W.qa.push({ q: q, a: '…' }); paintLookup();
  try {
    const a = await ai(lookupAskPrompt(W.items[W.sel], W.qa.slice(0, -1), q), false, W.items[W.sel].lang);
    W.qa[W.qa.length - 1].a = a;
  } catch (e) { W.qa.pop(); W.err = '追问失败 · ' + e.message; }
  W.busy = false; paintLookup();
  window.scrollTo(0, document.body.scrollHeight);
}

/* 词汇卡片生成：查词结果和反向翻译结果共用 */
async function genWordCard(item, qa, btn, notes) {
  if (needKey()) return;
  const old = btn.innerHTML; btn.innerHTML = '生成中…'; btn.disabled = true;
  try {
    let txt = await ai(wordCardPrompt(item, qa), false, item.lang);
    if (item.lang === 'kk') txt = kkDual(txt);
    if (item.lang === 'ru') txt = ruDual(txt);
    txt = markjiLint(txt).text;
    DE.mode = 'raw';
    go('dedit', { lang: item.lang, front: item.word, text: txt.trim(), notes: notes || '' });
  } catch (e) {
    btn.innerHTML = old; btn.disabled = false;
    toast('生成失败 · ' + e.message);
  }
}

function makeWordCard(i, btn) { genWordCard(W.items[i], W.qa, btn); }

/* ---------------- 整句翻译 ----------------
   语言由 AI 判定，但模型的选择在发请求之前就用字符集本地猜好了，
   所以贴一句藏语进来，用的就是你给藏语指定的那个模型。 */
function transHtml() {
  const t = W.sent;
  if (!t) return '';
  const k = t.lang, L = LANGS[k] || null;
  const s = t.sent;

  let body = '<div class="card">' +
    '<div class="sent ' + scriptCls(k) + '">' + tapWords(k, s.text, s.tokens, s.gloss, 'tr') + '</div>' +
    (k === 'kk' && s.alt ? '<div class="sent ar" style="margin-top:14px">' + esc(s.alt) + '</div>' : '') +
    ((k === 'bo' || k === 'kk' || k === 'ru') && s.translit ? '<div class="translit">' + esc(s.translit) + '</div>' : '') +
    handHtml(k, s.text) +
    '<div class="trans">' + esc(s.zh) +
    (s.en ? '<div class="en">' + esc(s.en) + '</div>' : '') +
    (k === 'ja' && s.translit ? '<div class="en">' + esc(s.translit) + '</div>' : '') +
    '</div>' +
    '<div class="row" style="margin-top:18px">' +
    '<span class="tag">' + esc(L ? L.zh : '未识别语言') + '</span>' +
    (L && L.tts ? speakBtn(k, s.text) : '') +
    '<button class="btn sm" onclick="doTranslate(1)">&#8635; 重新翻译</button>' +
    '</div>' +
    (L ? '<p class="hint" style="margin-top:14px">点击任意单词查看释义' + (k === 'bo' ? '、改注音、录发音' : '') + '</p>' : '') +
    '</div>';

  if (t.note) body += '<div class="expl" style="margin-top:14px">' + esc(t.note) + '</div>';

  if (W.sqa.length) {
    body += '<div class="qa">' + W.sqa.map(x =>
      '<div class="q">' + esc(x.q) + '</div><div class="a">' + esc(x.a) + '</div>').join('') + '</div>';
  }

  if (L) {
    const nwq = wordQaFor(k, s.text).length;
    body += '<div class="spacer"></div><div class="spacer"></div>' +
      '<button class="btn pri wide" onclick="transCard(this)">保存到卡片库</button>' +
      (nwq ? '<p class="note" style="text-align:center">会一并带上你在词卡里追问的 ' + nwq + ' 条内容</p>' : '');
  } else {
    body += '<p class="note">这段文字不属于本应用支持的六种语言，只做了翻译，不能生成卡片。' +
      '如果你输入的是中文或英文、想看它在六种语言里怎么说，请改点上面的「译成六语」。</p>' +
      '<button class="btn wide" onclick="doReverse()">译成六语</button>';
  }
  return body;
}

function bindTrans() {
  const t = W.sent;
  if (!t || !LANGS[t.lang]) return;
  bindTapWords(t.lang, () => ({ text: t.sent.text, tokens: t.sent.tokens, gloss: t.sent.gloss }));
}

async function doTranslate(again) {
  if (needKey()) return;
  const q = (again && W.q) || ($('wq') ? $('wq').value.trim() : W.q);
  if (!q) { toast('先粘贴一段文字'); return; }
  if ($('wq')) $('wq').blur();
  W.q = q; W.mode = 'sent'; W.busy = true; W.err = ''; W.items = []; W.qa = [];
  W.rev = null; W.rqa = []; W.rsel = 0;
  if (!again) { W.sent = null; W.sqa = []; }
  paintLookup();
  try {
    const j = await aiJson(transPrompt(q), guessLang(q));
    const k = LANGS[j.lang] ? j.lang : '';
    const sent = buildSent(j, k);
    if (!sent.text) throw new Error('模型返回了空结果');
    W.sent = { lang: k, sent: sent, note: (j.note || '').trim() };
  } catch (e) { W.err = '翻译失败 · ' + e.message; }
  W.busy = false; paintLookup();
}

async function askTrans() {
  if (needKey() || W.busy || !W.sent) return;
  const ta = $('wask'); const q = ta.value.trim();
  if (!q) return;
  ta.value = ''; autosize(ta); ta.blur();
  W.busy = true; W.sqa.push({ q: q, a: '…' }); paintLookup();
  try {
    const k = W.sent.lang;
    const a = await ai(askPrompt(k || 'nl', W.sent.sent, W.sqa.slice(0, -1), q), false, k);
    W.sqa[W.sqa.length - 1].a = a;
  } catch (e) { W.sqa.pop(); W.err = '追问失败 · ' + e.message; }
  W.busy = false; paintLookup();
  window.scrollTo(0, document.body.scrollHeight);
}

/* 走的是和句子阅读完全相同的详解流程，词卡里的追问也会被一并带上 */
function transCard(btn) {
  if (!W.sent || !LANGS[W.sent.lang]) { toast('这段文字未能识别出支持的语言'); return; }
  detailFor(W.sent.lang, W.sent.sent, W.sqa, btn);
}

/* ---------------- 反向翻译：中文 / 英文 → 六种语言 ----------------
   请求按【模型】分组：被指定了强模型的语言（通常是藏语）单独走一次请求，
   其余共用默认模型的语言合并成一次。这样藏语不会掉回弱模型，
   也不会因为一次查询就发六个请求。 */
function revGroups() {
  const g = new Map();
  LK.forEach(k => {
    const m = modelFor(k);
    if (!g.has(m)) g.set(m, []);
    g.get(m).push(k);
  });
  return Array.from(g.values());
}

function revHtml() {
  const r = W.rev;
  if (!r || !r.items.length) return '';
  let body = '<div class="sec">' + esc(r.zh || W.q) + ' · ' + (r.kind === 'word' ? '词' : '整句') +
    ' · ' + r.items.length + ' 种语言</div>';
  r.items.forEach((it, i) => {
    const k = it.lang, L = LANGS[k], s = it.sent;
    body += '<div class="card" style="margin-bottom:14px;' + (i === W.rsel ? 'border-color:var(--fg2)' : '') + '" data-rpick="' + i + '">' +
      '<div class="row" style="margin-bottom:12px">' +
      '<span class="tag">' + esc(L.zh) + '</span>' +
      (it.pos ? '<span class="tag">' + escp(it.pos) + '</span>' : '') +
      (it.gender ? '<span class="tag">' + escp(it.gender) + '</span>' : '') +
      (it.lemma && it.lemma !== s.text ? '<span class="lm">原形 ' + escp(it.lemma) + '</span>' : '') +
      (i === W.rsel ? '<span class="hint" style="margin-left:auto">追问对象</span>' : '') +
      '</div>' +
      '<div class="sent ' + scriptCls(k) + '">' + tapWords(k, s.text, s.tokens, s.gloss, 'rv' + i) + '</div>' +
      (k === 'kk' && s.alt ? '<div class="sent ar" style="margin-top:12px">' + esc(s.alt) + '</div>' : '') +
      (s.translit ? '<div class="translit">' + escp(s.translit) + '</div>' : '') +
      handHtml(k, s.text) +
      (it.note ? '<div class="expl">' + escp(it.note) + '</div>' : '') +
      '<div class="row" style="margin-top:16px">' +
      (L.tts ? '<button class="btn sm" data-rspk="' + i + '">&#9654; 发音</button>' : '') +
      '<button class="btn sm" data-rcard="' + i + '">' + (r.kind === 'word' ? '生成卡片' : '保存到卡片库') + '</button>' +
      '</div>' +
      '<p class="hint" style="margin-top:12px">点击任意单词查看释义' + (k === 'bo' ? '、改注音、录发音' : '') + '</p>' +
      '</div>';
  });
  if (W.rqa.length) {
    body += '<div class="qa">' + W.rqa.map(x =>
      '<div class="q">' + esc(x.q) + '</div><div class="a">' + esc(x.a) + '</div>').join('') + '</div>';
  }
  return body;
}

function bindRev() {
  const r = W.rev;
  if (!r) return;
  document.querySelectorAll('[data-rpick]').forEach(c => {
    c.addEventListener('click', e => {
      if (e.target.closest('button') || e.target.closest('.w')) return;
      W.rsel = +c.dataset.rpick; paintLookup();
    });
  });
  document.querySelectorAll('[data-rspk]').forEach(b => {
    b.onclick = () => { const it = r.items[+b.dataset.rspk]; say(it.lang, it.sent.text, b); };
  });
  document.querySelectorAll('[data-rcard]').forEach(b => {
    b.onclick = () => revCard(+b.dataset.rcard, b);
  });
  /* 每张卡片一种语言，所以词卡的语言从来源里取，不用外层的默认值 */
  bindTapWords('', g => {
    const it = r.items[+g.slice(2)];
    if (!it) return null;
    return { lang: it.lang, text: it.sent.text, tokens: it.sent.tokens, gloss: it.sent.gloss };
  });
}

async function doReverse(again) {
  if (needKey()) return;
  const q = (again && W.q) || ($('wq') ? $('wq').value.trim() : W.q);
  if (!q) { toast('先输入一个中文或英文的词或句子'); return; }
  if ($('wq')) $('wq').blur();
  W.q = q; W.mode = 'rev'; W.busy = true; W.err = '';
  W.items = []; W.qa = []; W.sent = null; W.sqa = [];
  W.rev = null; W.rqa = []; W.rsel = 0;
  paintLookup();
  try {
    const groups = revGroups();
    const rs = await Promise.all(groups.map(ks => aiJson(revPrompt(q, ks), ks[0])));
    const kind = rs.map(j => j && j.kind).find(x => x === 'word' || x === 'sent') || 'sent';
    const zh = (rs.map(j => (j && j.zh) || '').find(x => x.trim()) || q).trim();
    const by = {};
    rs.forEach(j => (j && Array.isArray(j.items) ? j.items : []).forEach(it => {
      if (!it || !LANGS[it.lang] || !String(it.text || '').trim() || by[it.lang]) return;
      const s = buildSent(it, it.lang);
      s.zh = zh;                                   // 详解 prompt 要拿它当参考翻译
      by[it.lang] = {
        lang: it.lang, sent: s,
        pos: (it.pos || '').trim(), gender: (it.gender || '').trim(),
        lemma: (it.lemma || '').trim(), note: (it.note || '').trim()
      };
    }));
    const items = LK.filter(k => by[k]).map(k => by[k]);
    if (!items.length) throw new Error('模型没有返回任何译文');
    W.rev = { kind: kind, zh: zh, items: items };
    const miss = LK.filter(k => !by[k]);
    if (miss.length) W.err = '有 ' + miss.length + ' 种语言没返回译文（' +
      miss.map(k => LANGS[k].zh).join('、') + '），可以重新点一次「译成六语」。';
  } catch (e) { W.err = '翻译失败 · ' + e.message; }
  W.busy = false; paintLookup();
}

function revCard(i, btn) {
  const r = W.rev; if (!r) return;
  const it = r.items[i];
  if (r.kind === 'word') {
    genWordCard({ lang: it.lang, word: it.sent.text, zh: r.zh, pos: it.pos, gender: it.gender },
      W.rqa.filter(x => x._i === i), btn);
  } else {
    detailFor(it.lang, it.sent, W.rqa.filter(x => x._i === i), btn);
  }
}

async function askRev() {
  if (needKey() || W.busy || !W.rev) return;
  const ta = $('wask'); const q = ta.value.trim();
  if (!q) return;
  const it = W.rev.items[W.rsel];
  if (!it) return;
  ta.value = ''; autosize(ta); ta.blur();
  W.busy = true;
  W.rqa.push({ q: '（' + LANGS[it.lang].zh + '）' + q, a: '…', _i: W.rsel });
  paintLookup();
  try {
    const prev = W.rqa.slice(0, -1).filter(x => x._i === W.rsel);
    const a = W.rev.kind === 'word'
      ? await ai(lookupAskPrompt({ lang: it.lang, word: it.sent.text, pos: it.pos, zh: W.rev.zh }, prev, q), false, it.lang)
      : await ai(askPrompt(it.lang, it.sent, prev, q), false, it.lang);
    W.rqa[W.rqa.length - 1].a = a;
  } catch (e) { W.rqa.pop(); W.err = '追问失败 · ' + e.message; }
  W.busy = false; paintLookup();
  window.scrollTo(0, document.body.scrollHeight);
}
