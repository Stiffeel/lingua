/* Yulengua 端到端测试（工作区重置后重建）
   覆盖本轮新功能 + 关键回归。OpenAI、OSS、speechSynthesis 全部 mock。 */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');

const ROOT = path.join(__dirname, 'site');
const SHOTS = path.join(__dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

function serve(root) {
  return new Promise(res => {
    const srv = http.createServer((rq, rs) => {
      const f = path.join(root, rq.url === '/' ? 'index.html' : decodeURIComponent(rq.url.split('?')[0]));
      fs.readFile(f, (e, d) => e ? (rs.statusCode = 404, rs.end('nope'))
        : (rs.setHeader('Content-Type', f.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8'), rs.end(d)));
    });
    srv.listen(0, '127.0.0.1', () => res({ srv, port: srv.address().port }));
  });
}

/* ---------- mock 数据 ---------- */
/* 故意给一个「两个词并成一个」的坏切分，验证本地分词校准还在 */
const SENT = {
  text: 'De trein naar Utrecht vertrekt van spoor negen.', alt: '', translit: '',
  zh: '开往乌得勒支的火车从九号站台发车。', en: 'The train to Utrecht departs from platform nine.',
  tokens: ['De trein', 'naar', 'Utrecht', 'vertrekt', 'van spoor', 'negen.'],
  gloss: ['火车', '前往', '乌得勒支', '出发', '站台', '九']
};
const WORD = {
  word: 'trein', lemma: 'trein', pos: '名词', gender: 'de', alt: '', translit: '',
  zh: '火车', en: 'train', example: { text: 'De trein is laat.', zh: '火车晚点了。' },
  forms: [{ k: '复数', v: 'treinen' }], note: 'de-woord，复数 treinen。'
};
/* 一张把墨墨语法用得很全的卡：用来验证卡片库里的渲染 */
const DETAIL = `开往乌得勒支的火车从九号站台发车。

De trein naar Utrecht vertrekt van spoor negen.
---
[P#H2#核心词]
trein（名词）：火车。[T#B#de-woord]，复数 treinen。
vertrekken：[T#!!fff895#出发、离开]。ver- 是[T#U,!d16056#不可分前缀]。
填空练习：De trein [F##vertrekt] om negen uur.
[Audio#A,ID/123#]
上标示例：m[T#up#2]`;

const MODEL_LOG = [];
let RESP_CALLS = 0, CHAT_CALLS = 0, LAST_DETAIL = '';

function answerFor(body) {
  const c = (body.messages || body.input || []).map(m => m.content).join(' ');
  if (/只回复两个字/.test(c)) return { text: '正常' };
  if (/撰写「句子详解」/.test(c)) { LAST_DETAIL = c; return { text: DETAIL }; }
  if (/请详细解析其中的词/.test(c)) return { json: WORD };
  if (/生成 1 个全新的例句/.test(c)) return { json: SENT };
  return { text: '这是模拟的回答。' };
}

(async () => {
  const { srv, port } = await serve(ROOT);
  const URL0 = 'http://127.0.0.1:' + port + '/index.html';
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2 });
  const pg = await ctx.newPage();
  const errs = [];
  pg.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  pg.on('console', m => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/status of 4\d\d|ERR_FAILED|ERR_NAME_NOT_RESOLVED|fonts\.g/.test(t)) return;
    errs.push('CONSOLE: ' + t);
  });

  /* OpenAI：chat/completions + responses。'gpt-x-pro' 模拟「只开放 Responses」的模型 */
  await pg.route('**/v1/chat/completions', async route => {
    const body = JSON.parse(route.request().postData());
    CHAT_CALLS++; MODEL_LOG.push({ api: 'chat', model: body.model });
    if (body.model === 'gpt-x-pro') {
      return route.fulfill({ status: 400, contentType: 'application/json',
        body: JSON.stringify({ error: { message: 'This model is only supported in v1/responses and not in v1/chat/completions.' } }) });
    }
    const r = answerFor(body);
    await route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ choices: [{ message: { content: r.json ? JSON.stringify(r.json) : r.text } }] }) });
  });
  await pg.route('**/v1/responses', async route => {
    const body = JSON.parse(route.request().postData());
    RESP_CALLS++; MODEL_LOG.push({ api: 'responses', model: body.model, fmt: body.text && body.text.format && body.text.format.type });
    const r = answerFor(body);
    await route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: r.json ? JSON.stringify(r.json) : r.text }] }] }) });
  });
  /* OSS：内存里的 bucket，不验签名 */
  const BUCKET = {};
  await pg.route('**/*.aliyuncs.com/**', async route => {
    const rq = route.request(), key = decodeURIComponent(new URL(rq.url()).pathname.slice(1));
    if (rq.method() === 'PUT') { BUCKET[key] = rq.postDataBuffer(); return route.fulfill({ status: 200, body: '' }); }
    if (rq.method() === 'GET') {
      if (!BUCKET[key]) return route.fulfill({ status: 404, body: '<Error><Code>NoSuchKey</Code></Error>' });
      return route.fulfill({ status: 200, body: BUCKET[key] });
    }
    if (rq.method() === 'DELETE') { delete BUCKET[key]; return route.fulfill({ status: 204, body: '' }); }
    route.fulfill({ status: 200, body: '' });
  });
  await pg.route('**/fonts.googleapis.com/**', r => r.abort());
  await pg.route('**/fonts.gstatic.com/**', r => r.abort());

  /* speechSynthesis：换成可观测的假实现。音色列表一开始是空的（iOS 的真实行为），
     之后由测试触发 voiceschanged。列表里第一个荷兰语音色故意是男声 Xander——
     以前的代码会挑中它，盖掉用户在系统里选的女声。 */
  await pg.addInitScript(() => {
    localStorage.setItem('lg.cfg', JSON.stringify({ key: 'sk-test', model: 'gpt-4.1' }));
    window.__utter = [];
    const voices = [];
    const ss = {
      getVoices: () => voices.slice(),
      speak: u => window.__utter.push({ text: u.text, lang: u.lang, voice: u.voice ? u.voice.name : null }),
      cancel: () => {}, onvoiceschanged: null
    };
    Object.defineProperty(window, 'speechSynthesis', { value: ss, configurable: true });
    window.SpeechSynthesisUtterance = function (t) { this.text = t; this.lang = ''; this.rate = 1; this.voice = null; };
    window.__addVoices = () => {
      voices.push(
        { name: 'Xander', lang: 'nl-NL', voiceURI: 'com.apple.voice.compact.nl-NL.Xander', localService: true },
        { name: 'Claire', lang: 'nl-NL', voiceURI: 'com.apple.voice.enhanced.nl-NL.Claire', localService: true },
        { name: 'Ellen', lang: 'nl-BE', voiceURI: 'com.apple.voice.compact.nl-BE.Ellen', localService: true },
        { name: 'Milena', lang: 'ru-RU', voiceURI: 'com.apple.voice.compact.ru-RU.Milena', localService: true },
        { name: 'Samantha', lang: 'en-US', voiceURI: 'com.apple.voice.compact.en-US.Samantha', localService: true }
      );
      if (ss.onvoiceschanged) ss.onvoiceschanged();
    };
  });

  await pg.goto(URL0);
  await pg.waitForTimeout(700);
  const shot = async n => { await pg.screenshot({ path: path.join(SHOTS, n + '.png'), fullPage: true }); console.log('· ' + n); };
  const expect = async (cond, msg, arg) => { if (!(await pg.evaluate(cond, arg))) errs.push('ASSERT: ' + msg); };
  const tap = async t => { await pg.click(`text=${t}`); await pg.waitForTimeout(250); };

  await expect(() => document.querySelectorAll('.menu .item').length === 6, '首页应有 5 个模块 + 设置');
  await shot('01-home');

  // ================= 句子阅读：分词校准回归 =================
  await tap('句子阅读'); await tap('荷兰语'); await pg.waitForTimeout(600);
  await expect(() => cur().sent.tokens.join(' ') === cur().sent.text && cur().sent.tokens.length === 8,
    '合并的 token 没有被拆开');
  await pg.click('.sent .w >> nth=1'); await pg.waitForTimeout(250);
  await expect(() => WSHEET.word === 'trein', '点第二个词应该是 trein，不是 De trein');
  await pg.click('.xb'); await pg.waitForTimeout(300);

  // ================= 发音：不再硬塞列表里第一个音色 =================
  await pg.evaluate(() => { window.__utter = []; say('nl', 'Hallo'); });
  await expect(() => window.__utter.length === 1 && window.__utter[0].voice === null && window.__utter[0].lang === 'nl-NL',
    '没有指定音色时应只设语言、交给系统，不能硬塞音色');
  await pg.evaluate(() => window.__addVoices()); await pg.waitForTimeout(100);
  await pg.evaluate(() => { window.__utter = []; say('nl', 'Hallo'); });
  await expect(() => window.__utter[0].voice === null,
    '音色列表加载之后也不该自动挑第一个（那是系统默认男声）');

  // ================= 保存一张卡，再造几张，测卡片库 =================
  await pg.click('button:has-text("保存到卡片库")'); await pg.waitForTimeout(700);
  await pg.click('.split button:has-text("保存到卡片库")'); await pg.waitForTimeout(500);
  await expect(() => S.cards.length === 1 && !('detail' in S.cards[0]) && !('added' in S.cards[0]) && !!S.cards[0].bv,
    '新卡的索引里不该带详解正文，也不该再有「已添加」字段');
  await expect(async () => { const b = await cbLoad(S.cards[0]); return /开往乌得勒支/.test(b.d) && b.n === ''; },
    '保存后正文没有存进正文存储');
  await pg.evaluate(() => {
    const now = Date.now();
    const add = (id, lang, front, d, age) => {
      S.cards.push({ id: id, lang: lang, front: front, ts: now - age, pos: now - age, ct: now - age, bv: now - age });
      cbPut(id, { d: d, n: '', bv: now - age }, false);
    };
    add('c' + (now - 5000) + 'aaaa', 'es', 'Segunda tarjeta', '第二张\n\nSegunda\n---\n解析', 5000);
    add('c' + (now - 9000) + 'bbbb', 'nl', 'Derde kaart', '第三张\n\nDerde\n---\n解析', 9000);
    saveCards(true);
  });
  await pg.evaluate(() => go('lib')); await pg.waitForTimeout(300);
  await expect(() => S.cards.length === 3, '卡片库应有 3 张');

  // 0) 语言标签页：默认落在第一个有卡的语言，切换后只显示那种语言
  await expect(() => document.querySelectorAll('.ltabs button').length === 6 && document.querySelectorAll('.lc').length === 2 &&
    document.querySelector('.ltabs button.on').textContent.indexOf('荷兰语') === 0, '默认标签页应是荷兰语，且只列 2 张荷兰语卡');
  await pg.click('.ltabs button:has-text("西班牙语")'); await pg.waitForTimeout(200);
  await expect(() => document.querySelectorAll('.lc').length === 1 && /Segunda/.test(document.querySelector('.lc .fr').textContent),
    '切到西班牙语应只剩 1 张');
  await pg.click('.ltabs button:has-text("荷兰语")'); await pg.waitForTimeout(200);

  // 1) 点按钮不展开；点卡片其他位置才展开，展开显示渲染后的内容
  await pg.evaluate(() => { window.__utter = []; });
  await pg.click('[data-spk] >> nth=0'); await pg.waitForTimeout(200);
  await expect(() => window.__utter.length === 1 && window.__utter[0].text === S.cards[0].front && !document.querySelector('.lbody'),
    '点发音按钮应当直接朗读，且不展开卡片');
  await pg.click('.lc .fr >> nth=0'); await pg.waitForTimeout(350);
  await expect(() => {
    const el = document.querySelector('.lrend');
    if (!el) return false;
    const t = el.textContent;
    return t.indexOf('[T#') === -1 && t.indexOf('[F##') === -1 && t.indexOf('[P#') === -1 &&
      t.indexOf('Audio') === -1 && t.indexOf('---') === -1;
  }, '展开后还能看到墨墨标记原文');
  await expect(() => {
    const el = document.querySelector('.lrend');
    return !!el.querySelector('hr') && !!el.querySelector('.mjf') && !!el.querySelector('sup') &&
      Array.from(el.querySelectorAll('span')).some(s => /font-weight:\s*700/.test(s.getAttribute('style') || '') && /de-woord/.test(s.textContent)) &&
      Array.from(el.querySelectorAll('span')).some(s => /background/.test(s.getAttribute('style') || '') && /出发/.test(s.textContent)) &&
      Array.from(el.querySelectorAll('span')).some(s => /underline/.test(s.getAttribute('style') || '') && /color/.test(s.getAttribute('style') || ''));
  }, '加粗 / 背景高亮 / 下划线+字色 / 挖空 / 上标 / 答案线 没有全部渲染出来');
  await expect(() => /刚刚添加|已添加/.test(document.querySelector('.lbody .mt').textContent) && !!document.querySelector('[data-copy]'),
    '展开后应显示已添加了多久，并有「复制墨墨格式」');
  await expect(() => agoText(Date.now() - 3 * 86400000) === '已添加 3 天' && agoText(Date.now() - 40 * 86400000) === '已添加 1 个月' &&
    agoText(Date.now() - 2 * 3600000) === '已添加 2 小时', '「已添加多久」的换算不对');
  await shot('02-lib-rendered');
  // 再点一次收起；展开状态下点详解区域本身不应收起
  await pg.click('.lrend >> nth=0'); await pg.waitForTimeout(150);
  await expect(() => !!document.querySelector('.lbody'), '点详解区域不该把卡片收起来');
  await pg.click('.lc .fr >> nth=0'); await pg.waitForTimeout(200);
  await expect(() => !document.querySelector('.lbody') && LIB.cache.size === 0, '再点一次应收起，并释放内存里的正文');

  // 2) 墨墨格式：详解在前，追问详解接在答案面末尾，整张卡只有一条答案线
  await expect(() => {
    const t = mjCard('翻译\n\n原句\n---\n解析', '问：为什么\n答：因为\n---\n还有');
    return (t.match(/^---$/gm) || []).length === 1 && /解析\n\n\[T#B#追问详解\]\n问：为什么/.test(t);
  }, '导出墨墨格式时追问详解没有拼对，或者出现了第二条答案线');
  await expect(() => mjCard('a\n---\nb', '') === 'a\n---\nb', '没有追问详解时不该多出一栏');

  // 3) 编辑页：追问详解可以改，改完正文版本号（bv）要变
  await pg.evaluate(() => { const c = S.cards[0]; window.__bv0 = c.bv; window.__d0 = c.ts; });
  await pg.evaluate(() => go('cedit', { id: S.cards[0].id, lang: 'nl', text: '译\n\n原\n---\n析', notes: '问：Q\n答：A' }));
  await pg.waitForTimeout(250);
  await expect(() => document.getElementById('ntext') && document.getElementById('ntext').value === '问：Q\n答：A', '编辑页没有「追问详解」输入框');
  await pg.fill('#ntext', '问：Q\n答：A2'); await pg.waitForTimeout(100);
  await pg.click('button:has-text("保存修改")'); await pg.waitForTimeout(300);
  await expect(async () => { const b = await cbLoad(S.cards[0]); return b.n === '问：Q\n答：A2' && b.d === '译\n\n原\n---\n析'; }, '编辑后的正文没存对');
  await expect(() => S.cards[0].bv > window.__bv0 && S.cards[0].ts > window.__d0, '编辑后 bv / ts 没有更新');
  await pg.click('.lc .fr >> nth=0'); await pg.waitForTimeout(350);
  await expect(() => /追问详解/.test(document.querySelector('.lbody').textContent) && /A2/.test(document.querySelector('.lbody').textContent),
    '展开后看不到追问详解');
  await pg.click('.lc .fr >> nth=0'); await pg.waitForTimeout(150);

  // 4) 移到最后 + 撤销（只动顺序，不动创建时间，不展开卡片）
  const order0 = await pg.evaluate(() => S.cards.map(c => c.front));
  const ct0 = await pg.evaluate(() => cardCreated(S.cards[0]));
  await pg.click('[data-last] >> nth=0'); await pg.waitForTimeout(300);
  const order1 = await pg.evaluate(() => S.cards.map(c => c.front));
  if (JSON.stringify(order1) !== JSON.stringify([order0[1], order0[2], order0[0]]))
    errs.push('ASSERT: 移到最后之后顺序不对 · ' + JSON.stringify(order1));
  await expect(() => !document.querySelector('.lbody'), '移到最后不该展开卡片');
  await expect(c => cardCreated(S.cards[2]) === c, '移到最后不该改变卡片的创建时间', ct0);
  await shot('03-lib-moved');
  await pg.click('.toast button'); await pg.waitForTimeout(300);
  await expect(o => JSON.stringify(S.cards.map(c => c.front)) === o, '撤销移到最后没有恢复原顺序', JSON.stringify(order0));

  // 5) 移到最后要扛得住云端合并（以前合并按 ts 排序，会把它打回原位）。
  //    远端多出来的那张新卡用的是老格式（正文内联在 detail 里）——顺便验证旧版云端数据能被接住
  await pg.click('[data-last] >> nth=0'); await pg.waitForTimeout(300);
  const stale = await pg.evaluate(() => JSON.stringify({ app: 'yulengua', v: 2, ts: 1,
    cards: S.cards.map(c => Object.assign({}, c, { ts: c.ts - 100000, pos: (c.ct || c.ts) }))
      .concat([{ id: 'cnew', lang: 'nl', front: 'Nieuwe kaart', detail: 'x', added: true, ts: Date.now(), pos: Date.now(), ct: Date.now() }]) }));
  await pg.evaluate(s => cloudMerge(JSON.parse(s)), stale); await pg.waitForTimeout(150);
  await expect(o => JSON.stringify(S.cards.map(c => c.front)) === o,
    '云端合并（远端是旧版本）把「移到最后」打回了原位', JSON.stringify(['Nieuwe kaart'].concat(order1)));
  await expect(async () => {
    const c = S.cards.find(x => x.id === 'cnew');
    return !('detail' in c) && !('added' in c) && (await cbLoad(c)).d === 'x' && CB.meta.cnew.up === false;
  }, '老格式远端卡片的正文没有被搬进正文存储（并排队等待上传）');
  await pg.evaluate(() => { S.cards = S.cards.filter(c => c.id !== 'cnew'); cbDrop('cnew'); saveCards(true); paintLib(); });

  // 6) 老卡（没有 pos）迁移时一张都不挪位置
  await expect(() => {
    const keep = S.cards; const now = Date.now();
    S.cards = [
      { id: 'c' + (now - 1000) + 'x', lang: 'nl', front: 'A', ts: now - 9000 },
      { id: 'c' + (now - 2000) + 'y', lang: 'nl', front: 'B', ts: now - 1 },
      { id: 'c' + (now - 3000) + 'z', lang: 'nl', front: 'C', ts: now - 5000 }
    ];
    normCards();
    const ok = S.cards.map(c => c.front).join('') === 'ABC' && S.cards.every(c => c.pos != null) &&
      S.cards.slice().sort(byPos).map(c => c.front).join('') === 'ABC';
    S.cards = keep;
    return ok;
  }, '老卡迁移 pos 时打乱了原有顺序');

  // 7) 删除墓碑回归：删掉的卡不能被旧的远端副本复活
  await pg.evaluate(() => { delCards([S.cards[0].id]); });
  const gone = await pg.evaluate(() => S.trash.items[0].c.front);
  await pg.evaluate(f => cloudMerge({ app: 'yulengua', v: 2, ts: 1,
    cards: [{ id: 'old', lang: 'es', front: f, detail: 'x', ts: 1 }] }), gone);
  await expect(f => !S.cards.some(c => c.front === f), '删掉的卡片被旧的远端副本复活了', gone);
  await pg.evaluate(() => { cbDrop('old'); });
  await pg.click('.toast button'); await pg.waitForTimeout(250);            // 撤销删除
  await expect(f => S.cards.some(c => c.front === f), '撤销删除没有恢复卡片', gone);

  // 8) 端到端：真的同步一次。索引里不带正文，正文按卡单独上云，pos 要对
  await pg.evaluate(() => {
    S.cfg.oss = { ep: 'oss-eu-central-1.aliyuncs.com', bucket: 'test', ak: 'AK', sk: 'SK', on: true, cache: true };
    saveCfg(true); paintLib();
  });
  await pg.click('[data-last] >> nth=0'); await pg.waitForTimeout(200);
  const lastLocal = await pg.evaluate(() => S.cards[S.cards.length - 1].front);
  await pg.evaluate(() => cloudSync(true)); await pg.waitForTimeout(900);
  const dj = BUCKET['data.json'] ? JSON.parse(BUCKET['data.json'].toString('utf8')) : null;
  if (!dj) errs.push('ASSERT: 没有同步到云端');
  else {
    const sorted = dj.cards.slice().sort((a, b) => b.pos - a.pos).map(c => c.front);
    if (sorted[sorted.length - 1] !== lastLocal) errs.push('ASSERT: 云端的 pos 没有反映「移到最后」 · ' + JSON.stringify(sorted));
    if (dj.cfg && 'voiceBy' in dj.cfg) errs.push('ASSERT: 音色设置是设备相关的，不该上云');
    if (dj.cards.some(c => 'detail' in c || 'notes' in c || 'added' in c)) errs.push('ASSERT: data.json 的卡片索引里不该带正文');
    const missing = dj.cards.filter(c => !BUCKET['cards/' + c.id + '.json']);
    if (missing.length) errs.push('ASSERT: 这些卡片的正文没有传到云端 · ' + missing.map(c => c.front).join(','));
    else {
      const one = JSON.parse(BUCKET['cards/' + dj.cards[0].id + '.json'].toString('utf8'));
      if (!one.d || one.bv !== dj.cards[0].bv) errs.push('ASSERT: 云端正文的内容或 bv 不对 · ' + JSON.stringify(one).slice(0, 100));
    }
  }
  await expect(() => S.cards.every(c => CB.meta[c.id] && CB.meta[c.id].up === true), '传完之后本机缓存应标记为「云端已有」');

  // 9) 本机缓存：只留最近用的 30 张已上传的，其余用时再从云端取；没上传的永远不回收
  await pg.evaluate(() => { cbPut('pinned', { d: 'P', n: '', bv: 1 }, false); CB.meta.pinned.at = 1; for (let i = 0; i < 35; i++) cbPut('fake' + i, { d: 'd' + i, n: '', bv: 1 }, true); });
  await pg.waitForTimeout(200);
  await expect(() => Object.keys(CB.meta).filter(id => CB.meta[id].up).length <= CB_KEEP && !!CB.meta.pinned && CB.meta.pinned.up === false,
    '本机缓存应只留 30 张已上传的，且不回收还没上传的');
  await pg.evaluate(() => { Object.keys(CB.meta).filter(id => /^fake|^pinned/.test(id)).forEach(cbDrop); });
  // 本机缓存被清掉后，展开要能从云端取回来
  await pg.evaluate(() => { cbDrop(S.cards[0].id); LIB.cache.clear(); });
  await expect(async () => { const b = await cbLoad(S.cards[0]); return !!b.d && CB.meta[S.cards[0].id].up === true; }, '本机没有缓存时没能从云端取回正文');
  // 另一台设备改了正文（bv 变了）：本机缓存是旧的，必须重新取
  const newer = await pg.evaluate(() => { const c = S.cards[0]; return { id: c.id, bv: c.bv + 1 }; });
  BUCKET['cards/' + newer.id + '.json'] = Buffer.from(JSON.stringify({ id: newer.id, d: 'NEW-FROM-OTHER-DEVICE', n: '', bv: newer.bv }));
  await expect(async n => { S.cards[0].bv = n.bv; return (await cbLoad(S.cards[0])).d === 'NEW-FROM-OTHER-DEVICE'; }, '正文版本变了，却还在用本机的旧缓存', newer);
  // 云端没有这张卡的正文：给出可读的提示，不报错崩掉
  await expect(async () => { try { await cbLoad({ id: 'nobody', bv: 1 }); return false; } catch (e) { return /云端还没有/.test(e.message); } },
    '云端缺正文时应提示「云端还没有这张卡的详解」');

  // 10) 备份里要带正文；老备份（正文内联）也能导入
  await pg.evaluate(() => { window.__blobs = []; const o = URL.createObjectURL.bind(URL); URL.createObjectURL = b => { window.__blobs.push(b); return o(b); }; });
  await pg.evaluate(() => exportBackup()); await pg.waitForTimeout(600);
  const bk = await pg.evaluate(async () => JSON.parse(await window.__blobs[window.__blobs.length - 1].text()));
  if (!bk.bodies || Object.keys(bk.bodies).length !== bk.cards.length || bk.cards.some(c => 'detail' in c))
    errs.push('ASSERT: 备份里缺少卡片正文，或索引里还内联着 detail');
  const legacyBk = { app: 'yulengua', v: 2, cards: [{ id: 'cleg1', lang: 'ja', front: '旧備份', detail: 'LEGACY-D', added: true, ts: 5 }] };
  fs.writeFileSync(path.join(SHOTS, 'legacy-backup.json'), JSON.stringify(legacyBk));
  await pg.evaluate(() => go('set')); await pg.waitForTimeout(300);
  pg.once('dialog', d => d.accept());
  await pg.setInputFiles('#impf', path.join(SHOTS, 'legacy-backup.json')); await pg.waitForTimeout(500);
  await expect(async () => {
    const c = S.cards.find(x => x.id === 'cleg1');
    return !!c && !('detail' in c) && !('added' in c) && (await cbLoad(c)).d === 'LEGACY-D';
  }, '导入老备份后，正文没有进正文存储');
  await pg.evaluate(() => { S.cards = S.cards.filter(c => c.id !== 'cleg1'); cbDrop('cleg1'); saveCards(true); });

  await pg.evaluate(() => { S.cfg.oss = null; saveCfg(true); });

  // 11) 追问 → 追问详解：生成详解时，追问要原样进「追问详解」，且不再喂给详解 prompt
  await pg.evaluate(async () => {
    const btn = document.createElement('button');
    await detailFor('nl', { text: 'Hallo wereld', zh: '你好世界', alt: '', translit: '' }, [{ q: '为什么用 de？', a: '因为 de-woord。' }], btn);
  });
  await pg.waitForTimeout(300);
  await expect(() => { const a = S.stack[S.stack.length - 1].arg; return S.stack[S.stack.length - 1].view === 'dedit' && a.notes === '问：为什么用 de？\n答：因为 de-woord。'; },
    '追问没有原样进入「追问详解」');
  if (/为什么用 de/.test(LAST_DETAIL)) errs.push('ASSERT: 追问不该再塞进详解的 prompt（会和追问详解重复）');
  await expect(() => document.getElementById('ntext').value.indexOf('因为 de-woord') > -1, '预览页的「追问详解」框里没有追问内容');
  await pg.fill('#ntext', '问：为什么用 de？\n答：改过的答案'); await pg.waitForTimeout(100);
  await pg.click('.split button:has-text("保存到卡片库")'); await pg.waitForTimeout(400);
  await expect(async () => {
    const c = S.cards.find(x => x.front === 'Hallo wereld');
    return !!c && S.cards[0] === c && (await cbLoad(c)).n === '问：为什么用 de？\n答：改过的答案';
  }, '保存时编辑过的追问详解没有存进卡片');
  // 同一句再存一次：覆盖正文，回到最前
  const oldBv = await pg.evaluate(() => S.cards.find(x => x.front === 'Hallo wereld').bv);
  await pg.waitForTimeout(5);
  await pg.evaluate(() => { go('dedit', { lang: 'nl', front: 'Hallo wereld', text: 'x\n\ny\n---\nz', notes: '' }); });
  await pg.waitForTimeout(250);
  await pg.click('.split button:has-text("保存到卡片库")'); await pg.waitForTimeout(400);
  await expect(async o => { const c = S.cards[0]; return c.front === 'Hallo wereld' && c.bv > o && (await cbLoad(c)).d === 'x\n\ny\n---\nz'; },
    '重新保存同一句应覆盖正文并更新 bv', oldBv);
  await expect(() => S.cards.filter(c => c.front === 'Hallo wereld').length === 1, '重新保存同一句不该产生重复卡片');
  await pg.evaluate(() => { go('lib'); }); await pg.waitForTimeout(200);

  // ================= 模型列表 =================
  await pg.evaluate(() => go('set')); await pg.waitForTimeout(400);
  await expect(() => {
    const sel = document.querySelector('.msel');
    const vals = Array.from(sel.options).map(o => o.value);
    const txt = Array.from(sel.options).map(o => o.textContent).join('|');
    return vals.indexOf('gpt-6.1-sol') > -1 && vals.indexOf('gpt-6-luna') > -1 && vals.indexOf('gpt-6-astra') > -1 &&
      vals.indexOf('gpt-4.1') > -1 && vals.indexOf('gpt-4o') === -1 && vals.indexOf('__custom') > -1 &&
      /gpt-6\.1-sol · 均衡/.test(txt);
  }, '按语言选模型的下拉没有更新成新模型列表');
  await expect(() => Array.from(document.querySelectorAll('#mlist option')).some(o => o.value === 'gpt-6.1-sol'),
    '全局模型的候选列表没有更新');
  await pg.selectOption('.msel >> nth=1', 'gpt-6.1-sol'); await pg.waitForTimeout(300);   // 第二行 = 藏语
  await expect(() => modelFor('bo') === 'gpt-6.1-sol' && modelFor('nl') === 'gpt-4.1', '按语言指定模型没有生效');
  await shot('04-models');

  // Responses 兜底：只开放 Responses 的模型要自动改走 /v1/responses，并且记住
  await pg.evaluate(() => { S.cfg.modelBy.es = 'gpt-x-pro'; saveCfg(true); });
  CHAT_CALLS = 0; RESP_CALLS = 0; MODEL_LOG.length = 0;
  const r1 = await pg.evaluate(async () => { try { return await aiJson(sentencePrompt('es', []), 'es'); } catch (e) { return 'ERR ' + e.message; } });
  if (typeof r1 !== 'object' || !r1.text) errs.push('ASSERT: Responses 兜底没有拿到结果 · ' + JSON.stringify(r1).slice(0, 120));
  if (CHAT_CALLS !== 1 || RESP_CALLS !== 1) errs.push('ASSERT: 第一次应先试 chat 再走 responses · chat=' + CHAT_CALLS + ' resp=' + RESP_CALLS);
  const respCall = MODEL_LOG.find(x => x.api === 'responses');
  if (!respCall || respCall.fmt !== 'json_object') errs.push('ASSERT: 走 Responses 时没有带上 JSON 格式要求');
  CHAT_CALLS = 0; RESP_CALLS = 0;
  await pg.evaluate(async () => { await ai([{ role: 'user', content: '只回复两个字：正常' }], false, 'es'); });
  if (CHAT_CALLS !== 0 || RESP_CALLS !== 1) errs.push('ASSERT: 认出只支持 Responses 之后，第二次应直接走 responses');
  // 普通模型照旧走 chat
  CHAT_CALLS = 0; RESP_CALLS = 0;
  await pg.evaluate(async () => { await ai([{ role: 'user', content: '只回复两个字：正常' }], false, 'nl'); });
  if (CHAT_CALLS !== 1 || RESP_CALLS !== 0) errs.push('ASSERT: 普通模型不该被改道');
  await pg.evaluate(() => { delete S.cfg.modelBy.es; saveCfg(true); });

  // ================= 设置里的朗读音色 =================
  await pg.evaluate(() => go('set')); await pg.waitForTimeout(300);
  await expect(() => {
    const sel = document.getElementById('vsel_nl');
    const names = Array.from(sel.options).map(o => o.textContent);
    return names[0] === '跟随系统' && names.some(n => /^Claire · nl-NL · 增强/.test(n)) &&
      names.some(n => /^Ellen · nl-BE/.test(n)) && !names.some(n => /Samantha|Milena/.test(n));
  }, '荷兰语的音色下拉不对（应只列 nl-* 音色，并标出增强版）');
  await pg.selectOption('#vsel_nl', 'com.apple.voice.enhanced.nl-NL.Claire'); await pg.waitForTimeout(300);
  await expect(() => S.cfg.voiceBy.nl === 'com.apple.voice.enhanced.nl-NL.Claire', '选中的音色没有存下来');
  await expect(() => window.__utter.length && window.__utter[window.__utter.length - 1].voice === 'Claire',
    '选完音色应当立刻试听一遍');
  await pg.evaluate(() => { window.__utter = []; say('nl', 'Goedemorgen'); });
  await expect(() => window.__utter[0].voice === 'Claire' && window.__utter[0].lang === 'nl-NL',
    '指定音色之后朗读没有用上它');
  // 选比利时荷兰语的女声：lang 要跟着音色走
  await pg.selectOption('#vsel_nl', 'com.apple.voice.compact.nl-BE.Ellen'); await pg.waitForTimeout(200);
  await pg.evaluate(() => { window.__utter = []; say('nl', 'Goedemorgen'); });
  await expect(() => window.__utter[0].voice === 'Ellen' && window.__utter[0].lang === 'nl-BE', 'nl-BE 音色的 lang 没跟上');
  // 指定的音色在这台设备上不存在 -> 退回系统，不报错
  await pg.evaluate(() => { S.cfg.voiceBy.nl = 'com.apple.voice.premium.nl-NL.Nobody'; window.__utter = []; say('nl', 'x'); });
  await expect(() => window.__utter[0].voice === null && window.__utter[0].lang === 'nl-NL', '找不到的音色应当退回系统');
  await pg.evaluate(() => { S.cfg.voiceBy.nl = 'com.apple.voice.enhanced.nl-NL.Claire'; saveCfg(true); paintVoiceSels(); });
  await shot('05-voices');

  // ================= 背单词：熟知的带符号时间戳（回归） =================
  await expect(() => {
    S.pulse = {}; pulseState();
    pSetKnown('nl', 'boete', true); pSetKnown('nl', 'weekend', true);
    const remote = JSON.parse(JSON.stringify(S.pulse.known.nl));
    pSetKnown('nl', 'boete', false);
    cloudMerge({ app: 'yulengua', v: 2, ts: 1, pulse: { known: { nl: remote }, cur: {}, gl: {} } });
    return !pIsKnown('nl', 'boete') && pIsKnown('nl', 'weekend');
  }, '取消勾选的熟知词被云端旧副本勾了回来');

  // ================= 词卡关掉后不能跳页（回归） =================
  await pg.evaluate(() => { R.lang = 'bo'; go('lookup'); }); await pg.waitForTimeout(200);
  await pg.evaluate(() => showWord('bo', 'བུ་མོ་', '女孩', 'བུ་མོ་')); await pg.waitForTimeout(300);
  await pg.click('#bopanel button:has-text("注音")'); await pg.waitForTimeout(150);
  await pg.fill('#bopin', 'wumo');
  await pg.click('#bopanel button:has-text("保存注音")'); await pg.waitForTimeout(250);
  await pg.click('.xb'); await pg.waitForTimeout(250);
  await expect(() => S.stack[S.stack.length - 1].view === 'lookup' && !!document.getElementById('wq'),
    '在单词查询里存藏语注音后被换成了别的页面');

  // ================= 暗色模式截图 =================
  await pg.emulateMedia({ colorScheme: 'dark' });
  await pg.evaluate(() => { go('lib'); }); await pg.waitForTimeout(250);
  await pg.click('.lc .fr >> nth=0'); await pg.waitForTimeout(350);
  await shot('06-lib-dark');

  console.log(errs.length ? '\nERRORS:\n' + errs.join('\n') : '\n✓ 无 JS 错误，全部断言通过');
  await b.close(); srv.close();
  process.exit(errs.length ? 1 : 0);
})();
