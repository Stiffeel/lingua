/* ================= Yulengua · 阿里云 OSS 云端存储 =================
   浏览器端直接调用 OSS REST API，用 V4 签名（OSS4-HMAC-SHA256）。
   签名算法与官方 ali-oss 的 signUtils.authorizationV4 逐字节对齐，
   并在构建期做过定点对拍。AccessKey 只存本机，绝不写入云端对象。 */

const OSS_DEFAULT = {
  ep: 'oss-eu-central-1.aliyuncs.com',   // 地域 Endpoint（不带 bucket 前缀）
  bucket: '',
  ak: '', sk: '',
  on: false,          // 是否启用云端
  cache: true         // 是否在本机缓存已下载的音频
};

/* ---------- 低层工具 ---------- */
const te = new TextEncoder();
function hex(buf) {
  const b = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < b.length; i++) s += (b[i] < 16 ? '0' : '') + b[i].toString(16);
  return s;
}
function subtle() {
  const c = (typeof crypto !== 'undefined' && crypto.subtle) ? crypto.subtle : null;
  if (!c) throw new Error('NO_CRYPTO');
  return c;
}
async function sha256hex(str) {
  return hex(await subtle().digest('SHA-256', te.encode(str)));
}
async function hmacRaw(keyBytes, msg) {
  const k = await subtle().importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await subtle().sign('HMAC', k, te.encode(msg)));
}

/* URI 编码：与 ali-oss 的 encodeString 一致（保留 / 不编码） */
function ossEnc(s) {
  return encodeURIComponent(String(s == null ? '' : s))
    .replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}
const ossEncPath = s => ossEnc(s).replace(/%2F/g, '/');

/* ---------- 配置读取 ---------- */
function ossCfg() { return Object.assign({}, OSS_DEFAULT, S.cfg.oss || {}); }
function ossHostname() {
  const o = ossCfg();
  const ep = String(o.ep || '').trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  return { ep: ep, host: o.bucket ? o.bucket + '.' + ep : ep };
}
/* oss-eu-central-1.aliyuncs.com -> eu-central-1 */
function ossRegion() {
  const ep = ossHostname().ep;
  const m = /^oss-([a-z0-9-]+?)(?:-internal)?\.aliyuncs\.com$/i.exec(ep);
  return m ? m[1].toLowerCase() : ep.replace(/^oss-/, '').replace(/\..*$/, '').toLowerCase();
}
function ossReady() {
  const o = ossCfg();
  return !!(o.on && o.bucket && o.ak && o.sk && ossHostname().ep);
}

/* ---------- V4 签名 ---------- */
function ossStamp(d) {
  const p = n => (n < 10 ? '0' : '') + n;
  return d.getUTCFullYear() + p(d.getUTCMonth() + 1) + p(d.getUTCDate()) + 'T' +
    p(d.getUTCHours()) + p(d.getUTCMinutes()) + p(d.getUTCSeconds()) + 'Z';
}

/* headers：只含参与签名的头（content-type / content-md5 / x-oss-*），全部小写 */
async function ossAuth(method, bucket, key, query, headers, region, ak, sk, stamp) {
  const names = Object.keys(headers).map(h => h.toLowerCase()).sort();
  const canonHeaders = names.map(n => n + ':' + String(headers[n]).trim() + '\n').join('');
  const qs = Object.keys(query || {}).sort((a, b) => a.localeCompare(b))
    .map(k => query[k] === null ? ossEnc(k) : ossEnc(k) + '=' + ossEnc(query[k])).join('&');

  const canonReq = [
    method.toUpperCase(),
    ossEncPath('/' + (bucket ? bucket + '/' : '') + (key || '')),
    qs,
    canonHeaders,
    '',
    headers['x-oss-content-sha256'] || 'UNSIGNED-PAYLOAD'
  ].join('\n');

  const day = stamp.slice(0, 8);
  const scope = day + '/' + region + '/oss/aliyun_v4_request';
  const sts = ['OSS4-HMAC-SHA256', stamp, scope, await sha256hex(canonReq)].join('\n');

  let k = await hmacRaw(te.encode('aliyun_v4' + sk), day);
  k = await hmacRaw(k, region);
  k = await hmacRaw(k, 'oss');
  k = await hmacRaw(k, 'aliyun_v4_request');
  const sig = hex(await hmacRaw(k, sts));

  return 'OSS4-HMAC-SHA256 Credential=' + ak + '/' + scope + ',Signature=' + sig;
}

/* ---------- 请求 ---------- */
function ossErrFrom(status, xml) {
  const code = (/<Code>([^<]+)<\/Code>/.exec(xml || '') || [])[1] || ('HTTP_' + status);
  const msg = (/<Message>([^<]+)<\/Message>/.exec(xml || '') || [])[1] || '';
  const e = new Error(code + (msg ? ' · ' + msg : ''));
  e.code = code; e.status = status;
  return e;
}

/* method: GET/PUT/DELETE/HEAD；body 可为 Blob/字符串/null */
async function ossReq(method, key, body, contentType, opt) {
  const o = ossCfg();
  if (!o.bucket) throw new Error('未填写 Bucket 名称');
  if (!o.ak || !o.sk) throw new Error('未填写 AccessKey');
  const { host } = ossHostname();
  const stamp = ossStamp(new Date());
  const sign = { 'x-oss-content-sha256': 'UNSIGNED-PAYLOAD', 'x-oss-date': stamp };
  if (contentType) sign['content-type'] = contentType;

  /* opt.ak / opt.sk / opt.noAuth 只给诊断用，正常调用一律走配置里的凭证 */
  const headers = Object.assign({}, sign);
  if (!(opt && opt.noAuth)) {
    const ak = ((opt && opt.ak) || o.ak).trim();
    const sk = ((opt && opt.sk) || o.sk).trim();
    headers.authorization = await ossAuth(method, o.bucket, key, null, sign, ossRegion(), ak, sk, stamp);
  }

  let r;
  try {
    r = await fetch('https://' + host + '/' + ossEncPath(key), {
      method: method, headers: headers, body: body || undefined, mode: 'cors', cache: 'no-store'
    });
  } catch (e) {
    const err = new Error('网络或跨域被拦截');
    err.code = 'CORS_OR_NETWORK';
    throw err;
  }
  if (!r.ok) {
    let xml = '';
    try { xml = await r.text(); } catch (e) {}
    throw ossErrFrom(r.status, xml);
  }
  return r;
}

const ossPutText = (key, text) => ossReq('PUT', key, new Blob([text], { type: 'application/json' }), 'application/json');
const ossPutBlob = (key, blob, ct) => ossReq('PUT', key, blob, ct || blob.type || 'application/octet-stream');
async function ossGetText(key) { return (await ossReq('GET', key)).text(); }
async function ossGetBlob(key) { return (await ossReq('GET', key)).blob(); }
const ossDel = key => ossReq('DELETE', key);

/* fetch 失败时浏览器不会告诉脚本「是跨域还是网络」，所以自己探一下：
   no-cors 请求不受 CORS 规则约束，只要 DNS 和网络通就能 resolve（哪怕返回 403）。
   它成功而正常请求失败 => 一定是 CORS 规则的问题。 */
async function ossProbe() {
  const { host } = ossHostname();
  try {
    await fetch('https://' + host + '/?probe=1', { method: 'GET', mode: 'no-cors', cache: 'no-store' });
    return 'cors';
  } catch (e) { return 'net'; }
}

/* AccessDenied 有两种完全不同的成因，返回的文案却一样：
   (a) OSS 压根没认你的签名，把你当匿名访客，撞在私有 Bucket 的 ACL 上；
   (b) OSS 认出了你是谁，但这个 RAM 子用户没被授权。
   靠故意发几个「错得有特征」的请求就能分开：如果 OSS 能分别回出
   InvalidAccessKeyId 和 SignatureDoesNotMatch，说明它确实在读 Authorization
   头、你的 AccessKey 也是真实存在的，那问题就只可能是授权没配上。 */
async function ossAuthDiag(key) {
  const o = ossCfg();
  const probe = async opt => {
    try {
      await ossReq('PUT', key, new Blob(['probe'], { type: 'text/plain' }), 'text/plain', opt);
      ossDel(key).catch(() => {});
      return 'OK';
    } catch (e) { return (e && e.code) || 'ERR'; }
  };
  return {
    badId: await probe({ ak: 'LTAInotarealaccesskey', sk: o.sk }),
    badSecret: await probe({ ak: o.ak, sk: (o.sk || '') + 'x' }),
    anon: await probe({ noAuth: true })
  };
}

function ossAuthDiagHtml(d) {
  const reads = d.badId === 'InvalidAccessKeyId' || d.badSecret === 'SignatureDoesNotMatch';
  const raw = '<div class="note" style="margin-top:10px">探针结果：伪造 ID → ' + esc(d.badId) +
    '；错误密钥 → ' + esc(d.badSecret) + '；完全不带签名 → ' + esc(d.anon) + '</div>';

  if (d.anon === 'OK') {
    return '<div class="err" style="margin:10px 0 0"><b>诊断结果：这个 Bucket 是公共读写的！</b>' +
      '<div class="note" style="margin-top:8px">不带任何签名都能写进去，说明读写权限没设成「私有」。' +
      '请立刻到 Bucket → 权限管理 → 读写权限，改成<b>私有</b>。</div>' + raw + '</div>';
  }

  if (reads) {
    return '<div class="err" style="margin:10px 0 0"><b>诊断结果：AccessKey 是真实有效的，OSS 也确实读到了你的签名。' +
      '问题出在 RAM 授权 —— 这个子用户没有被授予操作这个 Bucket 的权限。</b>' +
      '<div class="note" style="margin-top:8px">到 <b>ram.console.aliyun.com</b> → 身份管理 → 用户 → 点开你建的那个子用户 → <b>权限管理</b> 标签页，按顺序核对：' +
      '<br><br>1. 这一页<b>是不是空的</b>？最常见的情况就是策略建好了、但那一步「添加权限」没做完（或者被那个黄色告警吓退了）。' +
      '<br>2. 如果有策略，点开看它的 Resource 写的 bucket 名，和这里填的 <b>' + esc(ossCfg().bucket) + '</b> 是否<b>逐字一致</b>（大小写、有没有多余的前缀目录）。' +
      '<br>3. 授权范围要选<b>账号级别</b>，不是某个资源组。选了资源组的话策略是挂上了，但对 OSS 不生效。' +
      '<br>4. 确认这对 AccessKey 属于<b>这个子用户</b>本人 —— 如果你先后建过好几个用户或者重新生成过 Key，很容易拿错。' +
      '<br><br>还有一种情况：Bucket 里配了「Bucket Policy」或防盗链，把请求挡在 RAM 之外。到 Bucket → 权限管理 里看一眼有没有多余的规则。</div>' + raw + '</div>';
  }

  return '<div class="err" style="margin:10px 0 0"><b>诊断结果：OSS 似乎没有在处理你的 Authorization 头，' +
    '把这次请求当成了匿名访问，撞在私有 Bucket 的 ACL 上。</b>' +
    '<div class="note" style="margin-top:8px">这种情况少见。请检查：跨域设置里的<b>允许 Headers 必须是 *</b>（不能只列几个）；' +
    '以及 Endpoint 有没有被写成带 bucket 前缀的形式（这里只该填 <b>oss-地域.aliyuncs.com</b>，不要带 ' + esc(ossCfg().bucket) + '. 前缀）。</div>' + raw + '</div>';
}

function ossHint(e) {
  const c = (e && e.code) || '';
  if (c === 'CORS_OR_NETWORK')
    return '浏览器把请求拦下了：可能是跨域规则（CORS），也可能是网络不通。点下面的「诊断」看是哪一种。';
  if (c === 'NO_CRYPTO') return '当前页面不是 https，浏览器禁用了加密接口，无法签名。请用 https 打开。';
  if (c === 'AccessDenied') return '被 OSS 拒绝了。这条错误本身分不清是「签名没被认」还是「授权没配上」，下面自动判断。';
  if (c === 'SignatureDoesNotMatch') return '签名不匹配：AccessKey Secret 多半复制时带了空格或缺字符。也可能是手机时间不准（签名有效期 15 分钟）。';
  if (c === 'InvalidAccessKeyId') return 'AccessKey ID 不存在或子用户已被停用。';
  if (c === 'NoSuchBucket') return '这个 Bucket 不存在，或 Endpoint 的地域和 Bucket 所在地域对不上。';
  if (c === 'RequestTimeTooSkewed') return '手机时间和服务器差得太远，去系统设置里打开「自动设置时间」。';
  if (c === 'NoSuchKey') return '云端还没有这个文件。';
  return (e && e.message) || '未知错误';
}

/* ---------- 音频对象 ---------- */
const MIME_EXT = { 'audio/mp4': 'm4a', 'audio/aac': 'm4a', 'audio/mpeg': 'mp3', 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/wav': 'wav' };
function extOf(mime) {
  const base = String(mime || '').split(';')[0].trim().toLowerCase();
  return MIME_EXT[base] || 'bin';
}
async function hashKey(s) { return (await sha256hex(String(s))).slice(0, 20); }
const audioKey = rec => 'audio/' + rec.h + '.' + (rec.x || 'm4a');

/* 本机音频缓存（IndexedDB，key 前缀 au:） */
const auCacheGet = h => (S.store === 'idb' ? idbGet('au:' + h).catch(() => null) : Promise.resolve(null));
const auCacheSet = (h, blob) => (S.store === 'idb' ? idbSet('au:' + h, blob).catch(() => {}) : Promise.resolve());
const auCacheDel = h => (S.store === 'idb' ? idb('readwrite', st => { st.delete('au:' + h); }).catch(() => {}) : Promise.resolve());

const auUrls = new Map();
async function audioUrl(rec) {
  if (!rec || !rec.h) return null;
  if (auUrls.has(rec.h)) return auUrls.get(rec.h);
  let blob = await auCacheGet(rec.h);
  if (!blob) {
    if (!ossReady()) throw new Error('云端未启用，本机也没有这段录音');
    blob = await ossGetBlob(audioKey(rec));
    if (ossCfg().cache) auCacheSet(rec.h, blob);
  }
  const url = URL.createObjectURL(blob);
  auUrls.set(rec.h, url);
  return url;
}

/* ---------- 藏语发音库 ---------- */
/* 键归一化：去掉尾部的音节点 ་ 与句点 །/༎，去空白 */
function boKey(w) {
  return String(w == null ? '' : w).replace(/[\s་༌།༎]+$/g, '').replace(/^[\s་]+/, '').trim();
}
const boGet = w => { const k = boKey(w); const e = S.bo && S.bo[k]; return (e && !e.del) ? e : null; };
function boSet(w, patch) {
  const k = boKey(w);
  if (!k) return null;
  const e = Object.assign({ w: k, p: '', h: '', x: '', ts: 0 }, S.bo[k] || {}, patch);
  e.w = k; e.ts = Date.now(); delete e.del;
  S.bo[k] = e; saveBo();
  return e;
}
function boDrop(w) {
  const k = boKey(w);
  const e = S.bo[k];
  if (!e) return;
  if (e.h) { auCacheDel(e.h); if (ossReady()) ossDel(audioKey(e)).catch(() => {}); }
  S.bo[k] = { w: k, del: true, ts: Date.now() };
  saveBo();
}
const boCount = () => Object.keys(S.bo || {}).filter(k => S.bo[k] && !S.bo[k].del).length;
const boList = () => Object.keys(S.bo || {}).map(k => S.bo[k])
  .filter(e => e && !e.del).sort((a, b) => (b.ts || 0) - (a.ts || 0));

/* 音节切分，用于「覆盖新音节才入选」的挑选 */
const boSyls = w => String(w || '').split(/[་༌།༎\s]+/).filter(Boolean);

/* ---------- data.json 同步 ---------- */
const CLOUD_KEY = 'data.json';
const CLOUD = { state: 'off', msg: '', last: 0, busy: false };

function cloudSnapshot() {
  return {
    app: 'yulengua', v: 2, ts: Date.now(),
    cards: S.cards, seen: S.seen, bo: S.bo, del: S.del, pulse: S.pulse,
    cfg: {
      ts: S.cfg.cfgTs || 0,
      boPron: S.cfg.boPron, diff: S.cfg.diff, corpusBy: S.cfg.corpusBy,
      autoSpeak: S.cfg.autoSpeak
    }
  };
}

/* 合并：一律以时间戳新的一方为准，不会因为换设备而丢东西 */
function cloudMerge(rm) {
  let changed = false;
  /* 先并墓碑：远端删掉的，本地也要删掉 */
  if (rm.del && typeof rm.del === 'object') {
    Object.keys(rm.del).forEach(k => {
      if ((rm.del[k] || 0) > (S.del[k] || 0)) { S.del[k] = rm.del[k]; changed = true; }
    });
  }
  if (Array.isArray(rm.cards)) {
    const m = new Map();
    S.cards.forEach(c => m.set(c.lang + '|' + c.front, c));
    /* 本地这一侧：被墓碑判了死刑、且卡片本身不比墓碑新的，直接移除
       （另一台设备删的，这台还留着的情况） */
    Array.from(m.keys()).forEach(id => {
      const d = S.del[id] || 0;
      if (d && (m.get(id).ts || 0) <= d) { m.delete(id); changed = true; }
    });
    rm.cards.forEach(c => {
      if (!c || !c.front) return;
      const id = c.lang + '|' + c.front;
      /* 墓碑比这张卡新 = 它是被删掉之后才传上来的旧副本，不准复活 */
      if ((S.del[id] || 0) >= (c.ts || 0) && S.del[id]) return;
      const mine = m.get(id);
      if (!mine) { cardSlim(c); if (!c.bv) c.bv = c.ts; m.set(id, c); changed = true; }
      else if ((c.ts || 0) > (mine.ts || 0)) {
        /* 远端是旧版本 Yulengua 传的：正文内联在 detail 里，搬进正文存储，之后会重新传成 cards/<id>.json */
        cardSlim(c);
        if (!c.bv) c.bv = c.ts;
        cbStale(mine, c);
        m.set(id, c); changed = true;
      }
    });
    /* 按 pos 排，不按 ts：否则「移到最后」一同步就被打回原位 */
    const merged = Array.from(m.values()).sort(byPos);
    if (merged.length !== S.cards.length || changed) { S.cards = merged; normCards(); changed = true; }
  }
  if (rm.bo && typeof rm.bo === 'object') {
    Object.keys(rm.bo).forEach(k => {
      const r = rm.bo[k], mine = S.bo[k];
      if (!r) return;
      if (!mine || (r.ts || 0) > (mine.ts || 0)) { S.bo[k] = r; changed = true; }
    });
  }
  /* Daily Pulse：「标记熟知」是单调的，两边求并集就对了；
     当前这一批只在本地还没有的时候才从远端接过来，否则会把你正在看的列表换掉。 */
  if (rm.pulse && typeof rm.pulse === 'object') {
    const p = pulseState();
    /* 正数 = 熟知，负数 = 明确取消。按【绝对值更大者胜】合并，
       否则取消操作永远同步不出去：本地取消掉的词会被远端那份加回来。 */
    const rk = rm.pulse.known || {};
    Object.keys(rk).forEach(k => {
      const mine = p.known[k] || (p.known[k] = {});
      Object.keys(rk[k] || {}).forEach(w => {
        const r = rk[k][w] || 0;
        if (Math.abs(r) > Math.abs(mine[w] || 0)) { mine[w] = r; changed = true; }
      });
    });
    const rg = rm.pulse.gl || {};
    Object.keys(rg).forEach(k => {
      const mine = p.gl[k] || (p.gl[k] = {});
      Object.keys(rg[k] || {}).forEach(w => { if (!mine[w]) { mine[w] = rg[k][w]; changed = true; } });
    });
    const rc = rm.pulse.cur || {};
    Object.keys(rc).forEach(k => {
      if (Array.isArray(rc[k]) && rc[k].length && !(Array.isArray(p.cur[k]) && p.cur[k].length)) {
        p.cur[k] = rc[k]; changed = true;
      }
    });
  }
  if (rm.seen && typeof rm.seen === 'object') {
    LK.forEach(k => {
      const a = Array.isArray(rm.seen[k]) ? rm.seen[k] : [];
      if (!a.length) return;
      const mine = Array.isArray(S.seen[k]) ? S.seen[k] : [];
      const set = new Set(mine);
      const add = a.filter(x => !set.has(x));
      if (add.length) { S.seen[k] = mine.concat(add).slice(-40); changed = true; }
    });
  }
  if (rm.cfg && (rm.cfg.ts || 0) > (S.cfg.cfgTs || 0)) {
    if (typeof rm.cfg.boPron === 'string') S.cfg.boPron = rm.cfg.boPron;
    if (rm.cfg.diff && typeof rm.cfg.diff === 'object') S.cfg.diff = rm.cfg.diff;
    if (rm.cfg.corpusBy && typeof rm.cfg.corpusBy === 'object') S.cfg.corpusBy = rm.cfg.corpusBy;
    if (typeof rm.cfg.autoSpeak === 'boolean') S.cfg.autoSpeak = rm.cfg.autoSpeak;
    S.cfg.cfgTs = rm.cfg.ts;
    saveCfg(true);
    changed = true;
  }
  if (changed) { saveCards(); saveSeen(); saveBo(true); savePulse(true); }
  return changed;
}

/* 卡片正文先传，再传索引：否则另一台设备看到了索引却取不到正文。
   传输期间用户可能又改了这张卡，所以传完要对一下 bv，没变才标记「云端已有」。
   传不上去就让这次同步整体失败、下次重试，不能带着缺正文的索引往上推。 */
async function cloudPushBodies() {
  const live = new Set(S.cards.map(c => c.id));
  const pend = Object.keys(CB.meta).filter(id => CB.meta[id].up === false && live.has(id));
  for (const id of pend) {
    const sent = CB.meta[id].bv;
    const b = await cbRawGet(id);
    if (!b) { delete CB.meta[id]; continue; }      // 本机也没有了，别再重试
    await ossPutText(cbKey(id), JSON.stringify({ id: id, d: b.d, n: b.n, bv: b.bv }));
    if (CB.meta[id] && CB.meta[id].bv === sent) CB.meta[id].up = true;
  }
  if (pend.length) { cbEvict(); saveCbMeta(); }
}

/* 断网时录的音会先躺在本机，等下一次同步补传 */
async function cloudPushPending() {
  const pend = Object.keys(S.bo || {}).map(k => S.bo[k])
    .filter(e => e && !e.del && e.h && e.up === false);
  for (const e of pend) {
    const blob = await auCacheGet(e.h);
    if (!blob) { e.up = true; continue; }          // 本机也没有了，别再重试
    try { await ossPutBlob(audioKey(e), blob); e.up = true; } catch (err) { break; }
  }
  if (pend.length) saveBo(true);
}

async function cloudSync(force) {
  if (!ossReady()) { CLOUD.state = 'off'; return false; }
  if (CLOUD.busy) return false;
  CLOUD.busy = true; CLOUD.state = 'syncing'; CLOUD.msg = ''; paintCloudBar();
  try {
    let remote = null;
    try { remote = JSON.parse(await ossGetText(CLOUD_KEY)); }
    catch (e) { if (e.code !== 'NoSuchKey') throw e; }
    if (remote && remote.app === 'yulengua') cloudMerge(remote);
    await cloudPushPending();
    await cloudPushBodies();
    await ossPutText(CLOUD_KEY, JSON.stringify(cloudSnapshot()));
    CLOUD.state = 'ok'; CLOUD.last = Date.now(); CLOUD.msg = '';
    S.cfg.lastCloud = CLOUD.last; saveCfg(true);
    paintCloudBar();
    return true;
  } catch (e) {
    CLOUD.state = 'err'; CLOUD.msg = ossHint(e);
    paintCloudBar();
    return false;
  } finally { CLOUD.busy = false; }
}

let cloudTimer = null;
/* 数据一变就排一次上传，4 秒内的连续改动合并成一次请求 */
function cloudTouch() {
  if (!ossReady()) return;
  clearTimeout(cloudTimer);
  cloudTimer = setTimeout(() => { cloudSync(true); }, 4000);
}

function paintCloudBar() {
  const el = typeof $ === 'function' ? $('cloudst') : null;
  if (!el) return;
  const t = { off: '未启用', syncing: '同步中…', ok: '已同步', err: '同步失败' }[CLOUD.state] || '未启用';
  const when = CLOUD.last ? '（' + new Date(CLOUD.last).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) + '）' : '';
  el.innerHTML = '<b>' + t + '</b>' + esc(when) +
    (CLOUD.msg ? '<div class="err" style="margin:8px 0 0">' + esc(CLOUD.msg) + '</div>' : '');
}

/* 真实地跑一遍 PUT → GET → DELETE，把 OSS 的原始错误码摊开给用户看 */
async function ossTest(btn) {
  /* 用户多半是填完就直接点测试，先把输入框里的值落到配置里 */
  if (typeof saveSet === 'function' && $('fEp')) saveSet(true);
  const m = $('ossmsg');
  const old = btn.innerHTML; btn.innerHTML = LOADER + ' 正在测试'; btn.disabled = true;
  m.innerHTML = '';
  const key = '_yulengua_test.txt';
  const body = 'yulengua ' + new Date().toISOString();
  const steps = [];
  try {
    if (!ossCfg().bucket) throw new Error('还没填 Bucket 名称');
    await ossPutText(key, body); steps.push('写入 ✓');
    const got = await ossGetText(key); steps.push('读回 ' + (got === body ? '✓' : '✗ 内容不一致'));
    await ossDel(key); steps.push('删除 ✓');
    m.innerHTML = '<div class="err"><b>云端连接成功</b><br>' + esc(steps.join(' → ')) +
      '<br>Bucket ' + esc(ossCfg().bucket) + ' · 地域 ' + esc(ossRegion()) + '</div>';
  } catch (e) {
    let extra = '';
    if (e && (e.code === 'AccessDenied' || e.status === 403)) {
      m.innerHTML = '<div class="note">' + LOADER + ' 正在判断是签名问题还是授权问题…</div>';
      extra = ossAuthDiagHtml(await ossAuthDiag(key));
    }
    if (e && e.code === 'CORS_OR_NETWORK') {
      const kind = await ossProbe();
      extra = kind === 'cors'
        ? '<div class="err" style="margin:10px 0 0"><b>诊断结果：网络是通的，被拦住的是跨域规则（CORS）。</b>' +
          '<br>请到 Bucket → 数据安全 → 跨域设置，逐字核对下面三项：' +
          '<div class="note" style="margin-top:8px">' +
          '1. <b>来源 Source</b> 必须精确等于这一行（点右边可复制）：' +
          '<div class="row" style="margin:6px 0"><code style="font-size:13px;word-break:break-all">' + esc(location.origin) + '</code>' +
          '<button class="btn sm" onclick="copyText(' + jsq(location.origin) + ')">复制</button></div>' +
          '2. <b>允许 Headers</b> 必须填 <b>*</b>（一个星号）。<b>留空是不行的</b>——留空等于一个自定义请求头都不许带，而签名就在 Authorization 头里，浏览器在预检那一步就会被拒。' +
          '<br>3. <b>允许 Methods</b> 要勾满 GET / PUT / POST / DELETE / HEAD。少勾 PUT 就写不进去。' +
          '<br><br>另外确认这条规则是加在 <b>' + esc(ossCfg().bucket) + '</b> 这个 Bucket 上的，规则保存后生效通常在一分钟内。</div></div>'
        : '<div class="err" style="margin:10px 0 0"><b>诊断结果：连 ' + esc(ossHostname().host) + ' 都连不上，这不是 CORS 的问题。</b>' +
          '<div class="note" style="margin-top:8px">多半是 Endpoint 写错了（地域拼错会解析到一个不存在的域名），或者当前网络屏蔽了阿里云。换个网络再试一次。</div></div>';
    }
    m.innerHTML = '<div class="err"><b>失败于：' + esc(steps.length ? steps.join(' → ') + ' → 下一步' : '第一步写入') + '</b>' +
      '<br>' + esc(ossHint(e)) +
      '<div class="note" style="margin-top:8px">原始错误码：' + esc((e && e.code) || '无') +
      '<br>' + esc(String((e && e.message) || '').slice(0, 200)) +
      '<br>本页来源 Origin：' + esc(location.origin) +
      '<br>请求目标：' + esc(ossHostname().host) + '</div></div>' + extra;
  } finally { btn.innerHTML = old; btn.disabled = false; }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ossAuth, ossEncPath, ossStamp, boKey, boSyls };
}
