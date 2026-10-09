/* ================= Yulengua · 场景对话 ================= */

const D = { lang: null, started: false, topic: '', scene: '', role: '', msgs: [], busy: false, err: '' };

VIEWS.dlg = function (k) {
  if (D.lang !== k) { D.lang = k; D.started = false; D.topic = ''; D.scene = ''; D.msgs = []; D.err = ''; }
  paintDlg();
};

function autoSpeakBtn() {
  const on = !!S.cfg.autoSpeak;
  return '<button class="swi' + (on ? ' on' : '') + '" onclick="toggleAutoSpeak()">' +
    '<span class="kn"><i></i></span>' + (on ? '自动朗读 开' : '自动朗读 关') + '</button>';
}
function toggleAutoSpeak() {
  S.cfg.autoSpeak = !S.cfg.autoSpeak; saveCfg();
  paintDlg();
  if (S.cfg.autoSpeak) {
    const last = D.msgs.filter(m => m.who === 'sys').pop();
    if (last) say(D.lang, last.line);
  } else if (window.speechSynthesis) { try { speechSynthesis.cancel(); } catch (e) {} }
}

function paintDlg() {
  const k = D.lang, L = LANGS[k];

  if (!D.started) {
    const h = '<div class="sec">情景设定</div>' +
      '<p class="note" style="margin-top:0;margin-bottom:16px">随便写一个提示，比如「在阿姆斯特丹的面包店买早餐」「跟房东报修暖气」「和同事聊周末」。系统会据此搭建场景，用' + L.zh + '（' + L.dialogue + '）和你一句一句对话，并在每轮批改你的回复。</p>' +
      '<textarea class="fld" id="topic" style="min-height:110px" placeholder="例如：在药店买感冒药"></textarea>' +
      '<div class="tbar" style="margin:16px 0 0">' + autoSpeakBtn() +
      '<span class="hint">开启后系统每句话会自动朗读</span></div>' +
      (D.err ? '<div class="err">' + esc(D.err) + '</div>' : '') +
      '<div class="spacer"></div>' +
      '<button class="btn pri wide" id="startBtn" onclick="startDlg()">开始对话</button>';
    shell(L.zh + ' · 场景对话', h);
    return;
  }

  let body = '<div class="tbar">' + autoSpeakBtn() +
    '<button class="btn sm" onclick="makeDlgCard()">生成卡片</button>' +
    '<button class="btn sm" onclick="resetDlg()">换一个场景</button></div>' +
    '<div class="scene"><b>场景</b>' + esc(D.scene) + (D.role ? '（对方：' + esc(D.role) + '）' : '') +
    '<div class="hint" style="margin-top:9px">点对方的话或批改句里的任意单词可查看释义' +
    (S.cfg.autoSpeak ? '。自动朗读已开启，对方的话会先只发音，点「显示文本」才出字' : '') + '</div></div>';

  D.msgs.forEach((m, i) => {
    if (m.fix) {
      body += '<div class="fix"><b class="h">' + (m.fix.verdict === 'ok' ? '批改 · 正确' : '批改 · 修正后') + '</b>' +
        (m.fix.corrected
          ? '<div class="cor"><span class="' + scriptCls(k) + '">' +
            tapWords(k, m.fix.corrected, m.fix.ctokens, m.fix.cgloss, 'f' + i) + '</span>' +
            (L.tts ? '<button class="btn sm" data-fx="' + i + '">&#9654;</button>' : '') + '</div>'
          : '') +
        '<div class="nt">' + esc(m.fix.note || '') + '</div></div>';
    }
    const veiled = m.who === 'sys' && m.reveal === false;
    body += '<div class="msg ' + (m.who === 'me' ? 'me' : 'sys') + '">';
    const isLast = i === D.msgs.length - 1;
    if (veiled) {
      body += '<div class="bub veil">&#9834; 已朗读，先听一遍</div>' +
        '<div class="ctl">' +
        (L.tts ? '<button data-s="' + i + '">&#9654; 重听</button>' : '') +
        '<button data-rv="' + i + '">显示文本</button>' +
        (isLast ? '<button data-rg="1">&#8635; 重新生成</button>' : '') +
        '</div>';
    } else {
      body += '<div class="bub ' + scriptCls(k) + '">' +
        (m.who === 'sys' ? tapWords(k, m.line, m.tokens, m.gloss, 's' + i) : esc(m.line)) + '</div>';
      if (m.who === 'sys') {
        body += '<div class="tr' + (m.show ? ' on' : '') + '">' + esc(m.zh || '') +
          (L.en && m.en ? '<div class="e">' + esc(m.en) + '</div>' : '') + '</div>' +
          '<div class="ctl">' +
          '<button data-t="' + i + '">' + (m.show ? '隐藏翻译' : '显示翻译') + '</button>' +
          (L.tts ? '<button data-s="' + i + '">&#9654; 发音</button>' : '') +
          (isLast ? '<button data-rg="1">&#8635; 重新生成</button>' : '') +
          '</div>';
      }
    }
    body += '</div>';
  });

  if (D.busy) body += '<div style="margin:8px 0 18px">' + LOADER + '</div>';
  if (D.err) body += '<div class="err">' + esc(D.err) +
    '<div class="row" style="margin-top:10px"><button class="btn sm" onclick="retryDlg()">&#8635; 重新生成</button></div></div>';

  const bar = '<div class="askbar">' +
    '<textarea id="dlgin" rows="1" placeholder="用' + L.zh + '回复…" oninput="autosize(this)"></textarea>' +
    '<button class="go" onclick="sendDlg()">&#8593;</button></div>';

  shell(L.zh + ' · 场景对话', body, { bar: bar });

  document.querySelectorAll('[data-t]').forEach(b => {
    b.onclick = () => { const i = +b.dataset.t; D.msgs[i].show = !D.msgs[i].show; paintDlg(); };
  });
  document.querySelectorAll('[data-s]').forEach(b => {
    b.onclick = () => say(k, D.msgs[+b.dataset.s].line, b);
  });
  document.querySelectorAll('[data-rv]').forEach(b => {
    b.onclick = () => { D.msgs[+b.dataset.rv].reveal = true; paintDlg(); };
  });
  document.querySelectorAll('[data-rg]').forEach(b => { b.onclick = () => retryDlg(); });
  document.querySelectorAll('[data-fx]').forEach(b => {
    b.onclick = () => say(k, D.msgs[+b.dataset.fx].fix.corrected, b);
  });
  bindTapWords(k, g => {
    const m = D.msgs[+g.slice(1)];
    if (!m) return null;
    return g[0] === 'f'
      ? { text: m.fix.corrected, tokens: m.fix.ctokens, gloss: m.fix.cgloss }
      : { text: m.line, tokens: m.tokens, gloss: m.gloss };
  });
  window.scrollTo(0, document.body.scrollHeight);
}

function resetDlg() { D.started = false; D.msgs = []; D.err = ''; paintDlg(); }

function mkSys(j, fb) {
  /* 切分同样按原句本地校准，否则对话里也会出现「两个词点不开」的问题 */
  const line = (j.line || '').trim();
  const fx = fixToks(D.lang, line, j.tokens, j.gloss);
  const m = {
    who: 'sys', line: line, zh: j.zh || '', en: j.en || '', show: false,
    reveal: !S.cfg.autoSpeak,
    tokens: fx.tokens, gloss: fx.gloss
  };
  if (fb) {
    const cor = (fb.corrected || '').trim();
    const cf = fixToks(D.lang, cor, fb.ctokens, fb.cgloss);
    m.fix = {
      verdict: fb.verdict === 'ok' ? 'ok' : 'fix',
      corrected: cor,
      note: fb.note || '',
      ctokens: cf.tokens, cgloss: cf.gloss
    };
  }
  return m;
}

async function startDlg() {
  if (needKey()) return;
  const t = $('topic').value.trim();
  if (!t) { toast('先写一句提示'); return; }
  const b = $('startBtn'); b.innerHTML = LOADER + ' 正在搭建场景'; b.disabled = true;
  D.topic = t; D.err = '';
  try {
    const j = await aiJson(dlgOpenPrompt(D.lang, t), D.lang);
    if (!(j.line || '').trim()) throw new Error('模型返回了空回复');
    D.scene = j.scene || t; D.role = j.role || '';
    D.msgs = [mkSys(j)];
    D.started = true;
    paintDlg();
    if (S.cfg.autoSpeak) say(D.lang, D.msgs[0].line);
    return;
  } catch (e) { D.err = '启动失败 · ' + e.message; }
  paintDlg();
}

/* 跑一轮：批改上一句 + 接一句。空回复视为失败，可以重来 */
async function runTurn(userLine) {
  try {
    const hist = D.msgs.slice(0, -1).map(m => ({ who: m.who, line: m.line }));
    const j = await aiJson(dlgTurnPrompt(D.lang, D.scene, hist, userLine), D.lang);
    if (!(j.line || '').trim()) throw new Error('模型返回了空回复');
    D.msgs.push(mkSys(j, j.feedback || {}));
    D.busy = false; paintDlg();
    if (S.cfg.autoSpeak) say(D.lang, D.msgs[D.msgs.length - 1].line);
    return;
  } catch (e) { D.err = '这一轮没成功 · ' + e.message; }
  D.busy = false; paintDlg();
}

async function sendDlg() {
  if (needKey() || D.busy) return;
  const ta = $('dlgin'); const t = ta.value.trim();
  if (!t) return;
  ta.value = ''; autosize(ta); ta.blur();
  D.msgs.push({ who: 'me', line: t });
  D.busy = true; D.err = ''; paintDlg();
  await runTurn(t);
}

/* 重新生成：既用于「这条回复我不满意/是空的」，也用于失败后重试 */
async function retryDlg() {
  if (needKey() || D.busy || !D.msgs.length) return;
  let last = D.msgs.length - 1;

  if (D.msgs[last].who === 'sys' && last === 0) {      // 重新生成开场白
    D.busy = true; D.err = ''; paintDlg();
    try {
      const j = await aiJson(dlgOpenPrompt(D.lang, D.topic || D.scene), D.lang);
      if (!(j.line || '').trim()) throw new Error('模型返回了空回复');
      D.scene = j.scene || D.scene; D.role = j.role || D.role;
      D.msgs = [mkSys(j)];
      D.busy = false; paintDlg();
      if (S.cfg.autoSpeak) say(D.lang, D.msgs[0].line);
      return;
    } catch (e) { D.err = '重新生成失败 · ' + e.message; }
    D.busy = false; paintDlg();
    return;
  }

  if (D.msgs[last].who === 'sys') { D.msgs.pop(); last--; }
  if (!D.msgs[last] || D.msgs[last].who !== 'me') { paintDlg(); return; }
  D.busy = true; D.err = ''; paintDlg();
  await runTurn(D.msgs[last].line);
}

/* ---------- 生成对话卡片 ---------- */
function correctedFor(i) {
  const nxt = D.msgs[i + 1];
  return (nxt && nxt.fix && nxt.fix.corrected) ? nxt.fix.corrected : D.msgs[i].line;
}
/* 卡片正面由本地拼装，保证 [F##...] 填空标记一定正确 */
function dlgFront() {
  const who = D.role ? D.role : '对方';
  const lines = [D.scene, ''];
  D.msgs.forEach((m, i) => {
    if (m.who === 'sys') lines.push(who + '：' + m.line);
    else lines.push('我：[F##' + correctedFor(i) + ']');
  });
  return lines.join('\n');
}
/* 整张卡片都在本地拼装，不调用 AI：只要对话本身 + 填空 */
function makeDlgCard() {
  if (D.msgs.filter(m => m.who === 'me').length === 0) { toast('先回复几句再生成卡片'); return; }
  DE.mode = 'raw';
  go('dedit', {
    lang: D.lang,
    front: '对话 · ' + D.scene.slice(0, 30),
    text: markjiLint(dlgFront()).text
  });
}
