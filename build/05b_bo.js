/* ================= Yulengua · 藏语发音（手改注音 + 自己录音）=================
   只在藏语（bo）出现。注音和录音都按「归一化词形」存储，所以同一个词
   在不同句子里出现时是同一条记录，录过一次以后到处都能回放。 */

const BO = { edit: false, rec: false, busy: '', t0: 0, timer: null, mr: null, stream: null, word: '' };

function boDur(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return Math.floor(s / 60) + ':' + (s % 60 < 10 ? '0' : '') + (s % 60);
}

/* 词卡里的藏语面板。word 是句中形式，内部统一归一化。 */
function boPanel(word) {
  return '<div id="bopanel">' + boPanelHtml(word) + '</div>';
}

function boPanelHtml(word) {
  const k = boKey(word);
  const e = boGet(k);
  const hasAudio = !!(e && e.h);
  let h = '<div class="bopn"><div class="hd">我的注音与录音<span>' + esc(k) + '</span></div>';

  if (BO.edit) {
    h += '<textarea class="fld" id="bopin" rows="2" style="min-height:52px;font-size:15px" ' +
      'placeholder="按你自己的注音体系写，例如 yod（约）">' + esc((e && e.p) || '') + '</textarea>' +
      '<div class="row" style="margin-top:9px">' +
      '<button class="btn sm pri" onclick="boSavePron(' + jsq(k) + ')">保存注音</button>' +
      '<button class="btn sm" onclick="BO.edit=false;boRefresh(' + jsq(k) + ')">取消</button></div>';
  } else {
    h += '<div class="pv">' + (e && e.p
      ? '<b>' + esc(e.p) + '</b>'
      : '<i>还没有手写注音，用的是 AI 给的那一行</i>') +
      '<button class="btn sm" onclick="BO.edit=true;boRefresh(' + jsq(k) + ')">' +
      (e && e.p ? '改注音' : '写注音') + '</button></div>';
  }

  h += '<div class="row" style="margin-top:12px">';
  if (BO.rec) {
    h += '<button class="btn sm rec" onclick="boRecStop()">&#9632; 停止 <span id="boclk">0:00</span></button>';
  } else {
    h += '<button class="btn sm" onclick="boRecStart(' + jsq(k) + ')">&#9679; ' + (hasAudio ? '重录' : '录我的发音') + '</button>';
  }
  if (hasAudio) {
    h += '<button class="btn sm" onclick="boPlay(' + jsq(k) + ',this)">&#9654; 播放</button>' +
      '<button class="btn sm" onclick="boDelete(' + jsq(k) + ')">删除录音</button>';
  }
  h += '</div>';

  if (BO.busy) h += '<div class="hint" style="margin-top:9px">' + esc(BO.busy) + '</div>';
  else if (hasAudio) h += '<div class="hint" style="margin-top:9px">已录 ' + (e.d ? boDur(e.d) + ' · ' : '') +
    (ossReady() ? (e.up === false ? '待上传，联网后自动补传' : '已存云端') : '仅存本机（云端未启用）') + '</div>';
  else h += '<div class="hint" style="margin-top:9px">录一遍自己的发音，以后这个词出现在任何句子里都能点开重听。</div>';

  return h + '</div>';
}

function boRefresh(word) {
  const el = $('bopanel');
  if (el) el.innerHTML = boPanelHtml(word);
  if (BO.edit && $('bopin')) $('bopin').focus();
}

function boSavePron(word) {
  const ta = $('bopin');
  if (!ta) return;
  const v = ta.value.trim();
  const k = boKey(word);
  if (!v && !boGet(k)) { BO.edit = false; boRefresh(k); return; }
  boSet(k, { p: v });
  BO.edit = false;
  boRefresh(k);
  toast(v ? '注音已保存，以后 AI 会照这个写' : '已清空这个词的手写注音');
  refreshUnderSheet();   /* 只重画「当前真正所在的那一页」，不能无条件重画句子阅读 */
}

/* ---------- 录音 ---------- */
function boMime() {
  if (typeof MediaRecorder === 'undefined') return null;
  /* iOS 只给 audio/mp4（AAC），其余浏览器优先 opus */
  const list = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
  for (const m of list) { try { if (MediaRecorder.isTypeSupported(m)) return m; } catch (e) {} }
  return '';
}

async function boRecStart(word) {
  if (BO.rec) return;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === 'undefined') {
    toast('这个浏览器不支持录音。iOS 请用 Safari，并确保是 https 打开的');
    return;
  }
  BO.word = boKey(word); BO.busy = '正在请求麦克风权限…'; boRefresh(BO.word);
  try {
    BO.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    BO.busy = '';
    boRefresh(BO.word);
    toast(/NotAllowed|Permission/i.test(String(e.name || e.message))
      ? '麦克风权限被拒绝。到 iOS 设置 → Safari → 麦克风 里允许'
      : '打不开麦克风 · ' + e.message);
    return;
  }
  const mime = boMime();
  try {
    BO.mr = mime ? new MediaRecorder(BO.stream, { mimeType: mime }) : new MediaRecorder(BO.stream);
  } catch (e) { BO.mr = new MediaRecorder(BO.stream); }
  const chunks = [];
  BO.mr.ondataavailable = ev => { if (ev.data && ev.data.size) chunks.push(ev.data); };
  BO.mr.onstop = () => {
    const dur = Date.now() - BO.t0;
    const blob = new Blob(chunks, { type: BO.mr.mimeType || mime || 'audio/mp4' });
    boCleanupRec();
    if (!blob.size) { BO.busy = ''; boRefresh(BO.word); toast('没有录到声音'); return; }
    boStore(BO.word, blob, dur);
  };
  BO.rec = true; BO.t0 = Date.now(); BO.busy = '';
  BO.mr.start();
  boRefresh(BO.word);
  BO.timer = setInterval(() => {
    const c = $('boclk');
    if (c) c.textContent = boDur(Date.now() - BO.t0);
    if (Date.now() - BO.t0 > 30000) boRecStop();       // 30 秒硬上限，防止误触录一小时
  }, 250);
}

function boRecStop() {
  if (!BO.rec || !BO.mr) return;
  try { BO.mr.stop(); } catch (e) { boCleanupRec(); boRefresh(BO.word); }
}

function boCleanupRec() {
  BO.rec = false;
  clearInterval(BO.timer); BO.timer = null;
  if (BO.stream) { try { BO.stream.getTracks().forEach(t => t.stop()); } catch (e) {} }
  BO.stream = null; BO.mr = null;
}

async function boStore(word, blob, dur) {
  const k = boKey(word);
  BO.busy = '正在保存（' + fmtBytes(blob.size) + '）…'; boRefresh(k);
  try {
    const h = await hashKey(k);
    const x = extOf(blob.type);
    const old = boGet(k);
    await auCacheSet(h, blob);                    // 先落本机，保证马上能回放
    let up = false;
    if (ossReady()) {
      try { await ossPutBlob('audio/' + h + '.' + x, blob, blob.type); up = true; }
      catch (e) { toast('云端上传失败，已先存本机 · ' + ossHint(e)); }
    }
    /* 换了容器格式时，把云端的旧对象删掉，免得留垃圾 */
    if (old && old.h === h && old.x && old.x !== x && ossReady()) ossDel('audio/' + h + '.' + old.x).catch(() => {});
    auUrls.delete(h);
    boSet(k, { h: h, x: x, d: dur, up: up });
    BO.busy = '';
    boRefresh(k);
    toast(up ? '已录好并同步到云端' : '已录好，存在本机');
    refreshUnderSheet();   /* 只重画「当前真正所在的那一页」，不能无条件重画句子阅读 */
  } catch (e) {
    BO.busy = ''; boRefresh(k);
    toast('保存失败 · ' + e.message);
  }
}

async function boPlay(word, btn) {
  const e = boGet(word);
  if (!e || !e.h) return;
  primeAudio();                                   // iOS 必须在手势里同步执行
  const old = btn ? btn.innerHTML : '';
  if (btn) { btn.innerHTML = '···'; btn.disabled = true; }
  try {
    const url = await audioUrl(e);
    playUrl(url);
  } catch (err) {
    toast('播放失败 · ' + ossHint(err));
  } finally { if (btn) { btn.innerHTML = old; btn.disabled = false; } }
}

function boDelete(word) {
  const k = boKey(word);
  if (!confirm('删除「' + k + '」的录音？手写注音会保留。')) return;
  const e = boGet(k);
  if (e && e.h) { auCacheDel(e.h); auUrls.delete(e.h); if (ossReady()) ossDel(audioKey(e)).catch(() => {}); }
  boSet(k, { h: '', x: '', d: 0, up: false });
  boRefresh(k);
  toast('已删除录音');
  refreshUnderSheet();   /* 只重画「当前真正所在的那一页」，不能无条件重画句子阅读 */
}

/* ---------- 「我的藏语发音」管理页 ---------- */
VIEWS.borec = function () {
  const list = boList();
  let body = '<p class="note" style="margin-top:0">这里是你在句子阅读里手改过注音、或自己录过音的藏语词。' +
    (ossReady() ? '录音存在云端（audio/ 目录），本机只留一份缓存。' : '云端还没启用，录音只存在这台设备上。') + '</p>';

  if (!list.length) {
    body += '<div class="empty"><span class="big">&#9834;</span>还没有记录。<br>去「句子阅读 · 标准安多藏语」点开任意一个词试试。</div>';
    shell('我的藏语发音', body);
    return;
  }

  body += '<div class="sec">共 ' + list.length + ' 个词</div><div class="lib">' +
    list.map(e => '<div class="lc"><div class="top"><div class="fr">' +
      '<span class="tb" style="font-size:22px">' + esc(e.w) + '</span>' +
      (e.p ? '<div class="translit" style="margin-top:4px">' + esc(e.p) + '</div>' : '') +
      '<div class="mt">' + (e.h ? '有录音' + (e.d ? ' · ' + boDur(e.d) : '') : '仅注音') +
      ' · ' + new Date(e.ts || 0).toLocaleDateString('zh-CN') + '</div></div></div>' +
      '<div class="acts" style="padding-left:0">' +
      (e.h ? '<button class="btn sm" onclick="boPlay(' + jsq(e.w) + ',this)">&#9654; 播放</button>' : '') +
      '<button class="btn sm" onclick="boEditFrom(' + jsq(e.w) + ')">改注音</button>' +
      '<button class="btn sm" onclick="boForget(' + jsq(e.w) + ')">删除</button>' +
      '</div></div>').join('') + '</div>';

  shell('我的藏语发音', body);
};

/* 从管理页直接打开这个词的编辑面板 */
function boEditFrom(word) {
  BO.edit = true;
  sheet('<div class="wh"><span class="ww tb">' + esc(word) + '</span></div>' + boPanel(word));
  setTimeout(() => { if ($('bopin')) $('bopin').focus(); }, 60);
}
function boForget(word) {
  const k = boKey(word);
  if (!confirm('把「' + k + '」整条删掉？注音和录音都会消失。')) return;
  boDrop(k);
  render();
  toast('已删除');
}
