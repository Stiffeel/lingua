/* ================= Yulengua · 跟读录音（即时练习，只放内存）=================
   给每一句话配一个录音：读完马上回放，和标准发音对比。
   和藏语发音库（05b_bo.js）不同，这里的录音【不落盘、不上云、不跟卡片走】：
   句子退不回去了（重新生成、被挤出历史、换了语言）、或者离开卡片库，就立刻丢掉。
   key = 分组 + '|' + 句子标识；各模块在重画时用 recSweep(分组, 还看得到的句子) 清理。 */

const REC = { map: new Map(), act: null, cancel: false, mr: null, stream: null, t0: 0, timer: null };

const ICON_MIC = '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0014 0M12 18v3"/></svg>';
const ICON_PLAYME = '<svg viewBox="0 0 24 24" width="19" height="19" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M7 4l13 8-13 8z"/></svg>';

/* 按钮区。icon = true 是卡片库那种方块图标按钮，否则是普通小按钮 */
function recCtl(g, id, icon) {
  const key = g + '|' + id;
  return '<span class="recbox" data-rk="' + esc(key) + '"' + (icon ? ' data-ic="1"' : '') + '>' + recInner(key, icon) + '</span>';
}
function recRow(g, id) {
  return '<div class="row" style="margin-top:12px">' + recCtl(g, id) +
    '<span class="hint">跟读录音只缓存，不存进卡片</span></div>';
}
function recInner(key, icon) {
  const on = REC.act === key, has = REC.map.has(key);
  if (icon) {
    return (on
      ? '<button class="ib rec" data-rec="stop" title="停止录音" aria-label="停止录音">' + ICON_MIC + '</button>'
      : '<button class="ib" data-rec="start" title="' + (has ? '重录' : '录音') + '" aria-label="录音">' + ICON_MIC + '</button>') +
      (has && !on ? '<button class="ib" data-rec="play" title="播放我的录音" aria-label="播放我的录音">' + ICON_PLAYME + '</button>' : '');
  }
  if (on) return '<button class="btn sm rec" data-rec="stop">&#9632; 停止 <span class="recclk">0:00</span></button>';
  return '<button class="btn sm" data-rec="start">&#9679; ' + (has ? '重录' : '录音') + '</button>' +
    (has ? '<button class="btn sm" data-rec="play">&#9654; 我的录音</button>' : '');
}
function recRefresh(key) {
  document.querySelectorAll('[data-rk]').forEach(el => {
    if (el.dataset.rk === key) el.innerHTML = recInner(key, !!el.dataset.ic);
  });
}

/* 用捕获阶段统一接管：卡片库的整行点击展开、其它页面的各种委托都不会被这些按钮误触发 */
document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('[data-rec]');
  const box = b && b.closest('[data-rk]');
  if (!box) return;
  e.stopPropagation(); e.preventDefault();
  const key = box.dataset.rk;
  if (b.dataset.rec === 'start') recStart(key);
  else if (b.dataset.rec === 'stop') recStop();
  else if (b.dataset.rec === 'play') recPlay(key);
}, true);

async function recStart(key) {
  if (REC.act) { toast('先停止正在进行的录音'); return; }
  if (typeof BO !== 'undefined' && BO.rec) { toast('藏语词卡里正在录音，先停止它'); return; }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === 'undefined') {
    toast('这个浏览器不支持录音。iOS 请用 Safari，并确保是 https 打开的');
    return;
  }
  REC.act = key; REC.cancel = false;                // 先占位，避免权限弹窗期间被连点出第二路录音
  try {
    REC.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    REC.act = null; recRefresh(key);
    toast(/NotAllowed|Permission/i.test(String(e.name || e.message))
      ? '麦克风权限被拒绝。到 iOS 设置 → Safari → 麦克风 里允许'
      : '打不开麦克风 · ' + e.message);
    return;
  }
  const mime = boMime();
  let mr;
  try { mr = mime ? new MediaRecorder(REC.stream, { mimeType: mime }) : new MediaRecorder(REC.stream); }
  catch (e) { mr = new MediaRecorder(REC.stream); }
  REC.mr = mr;
  const chunks = [];
  mr.ondataavailable = ev => { if (ev.data && ev.data.size) chunks.push(ev.data); };
  mr.onstop = () => {
    const dur = Date.now() - REC.t0, cancelled = REC.cancel;
    try { REC.stream.getTracks().forEach(t => t.stop()); } catch (e) {}
    clearInterval(REC.timer);
    REC.act = null; REC.mr = null; REC.stream = null; REC.timer = null;
    const blob = new Blob(chunks, { type: mr.mimeType || mime || 'audio/mp4' });
    if (!cancelled && blob.size) {
      const old = REC.map.get(key);
      if (old) { try { URL.revokeObjectURL(old.url); } catch (e) {} }
      REC.map.set(key, { url: URL.createObjectURL(blob), dur: dur });
    } else if (!cancelled) toast('没有录到声音');
    recRefresh(key);
  };
  REC.t0 = Date.now();
  mr.start();
  recRefresh(key);
  REC.timer = setInterval(() => {
    document.querySelectorAll('.recclk').forEach(c => { c.textContent = boDur(Date.now() - REC.t0); });
    if (Date.now() - REC.t0 > 60000) recStop();      // 60 秒硬上限，防止误触一直录
  }, 250);
}

function recStop() {
  if (!REC.act || !REC.mr) return;
  try { REC.mr.stop(); } catch (e) { REC.cancel = true; }
}

function recPlay(key) {
  const r = REC.map.get(key);
  if (!r) return;
  primeAudio();                                       // iOS 必须在手势里同步执行
  playUrl(r.url);
}

function recDrop(key) {
  if (REC.act === key) { REC.cancel = true; recStop(); }
  const r = REC.map.get(key);
  if (r) { try { URL.revokeObjectURL(r.url); } catch (e) {} REC.map.delete(key); }
}
/* live：这个分组里此刻还看得到的句子标识；其余的录音全部丢掉 */
function recSweep(g, live) {
  const keep = new Set(live.filter(x => x != null).map(x => g + '|' + x));
  Array.from(REC.map.keys()).concat(REC.act ? [REC.act] : []).forEach(key => {
    if (key.indexOf(g + '|') === 0 && !keep.has(key)) recDrop(key);
  });
}
const recDropGroup = g => recSweep(g, []);
