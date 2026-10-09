/* ================= Yulengua · home / langs / settings ================= */

VIEWS.home = function () {
  const n = S.cards.length;
  const mods = [
    ['01', '句子阅读', 'Sentence Reading', "go('langs','read')", ''],
    ['02', '场景对话', 'Scenario Dialogue', "go('langs','dlg')", ''],
    ['03', '单词查询', 'Word Lookup', "go('lookup')", ''],
    ['04', '卡片库', 'Card Library', "go('lib')", n ? '<span class="badge">' + n + '</span>' : ''],
    ['05', 'Daily Pulse', 'Daily Vocabulary', "go('langs','pulse')", '']
  ];
  app().innerHTML = '<div class="screen on"><div class="body">' +
    '<div class="brand"><h1>Yulengua</h1><div class="rule"></div><p>六语学习</p></div>' +
    '<div class="menu">' +
    mods.map(m => '<button class="item" onclick="' + m[3] + '">' +
      '<span class="n">' + m[0] + '</span><span class="t"><b>' + m[1] + m[4] + '</b><s>' + m[2] + '</s></span>' +
      '<span class="chev">&#8250;</span></button>').join('') +
    '<button class="item" onclick="go(\'set\')">' +
    '<span class="n">&#9881;</span><span class="t"><b>设置</b><s>API Key · 模型 · 难度 · 注音 · 语音</s></span>' +
    '<span class="chev">&#8250;</span></button>' +
    '</div>' +
    (S.cfg.key ? '' : '<p class="note" style="margin-top:22px;text-align:center">尚未设置 API Key，点击「设置」开始。</p>') +
    '</div></div>';
};

const LANG_MODS = {
  read:  { title: '句子阅读', view: 'read' },
  dlg:   { title: '场景对话', view: 'dlg' },
  pulse: { title: 'Daily Pulse', view: 'pulse' }
};
VIEWS.langs = function (mod) {
  const m = LANG_MODS[mod] || LANG_MODS.read;
  const isDlg = mod === 'dlg', isPulse = mod === 'pulse';
  const rows = LK.map(k => {
    const L = LANGS[k];
    const off = isDlg && !L.dialogue;
    const sub = isPulse
      ? (pulseKnownCount(k) ? '已熟 ' + pulseKnownCount(k) + ' 词' : '每次 10 个新词')
      : (isDlg ? L.dialogue : L.level) + diffTag(k);
    return '<button class="item"' + (off ? ' disabled' : '') +
      (off ? '' : ' onclick="go(\'' + m.view + '\',\'' + k + '\')"') + '>' +
      '<span class="n">' + L.code + '</span>' +
      '<span class="t"><b>' + L.zh + (off ? '<span class="badge">未开放</span>' : '') + '</b>' +
      '<s class="' + scriptCls(k) + '" style="font-size:' + (k === 'bo' ? '15px' : '12px') + '">' + L.native +
      (off ? '' : ' · ' + sub) +
      (!off && !isPulse && S.cfg.modelBy && S.cfg.modelBy[k] ? ' · ' + esc(S.cfg.modelBy[k]) : '') + '</s></span>' +
      '<span class="chev">' + (off ? '' : '&#8250;') + '</span></button>';
  }).join('');
  shell(m.title, '<div class="sec">选择语言</div><div class="menu" style="border-top:1px solid var(--line)">' + rows + '</div>' +
    (isDlg ? '<p class="note" style="margin-top:20px">场景对话目前开放荷兰语、西班牙语、日语。藏语、哈萨克语、俄语入口已预留。</p>' : '') +
    (isPulse ? '<p class="note" style="margin-top:20px">词库是仓库里的 <b>words/&lt;语言&gt;.csv</b>，用 Excel 或 GitHub 网页都能直接改。' +
      '勾「熟」的词永久退出；没勾的在「换一批」之后回到词库。</p>' : ''));
};

/* ---------------- 难度 ---------------- */
const DIFF_MIN = -6, DIFF_MAX = 6;
const getDiff = k => Math.max(DIFF_MIN, Math.min(DIFF_MAX, (S.cfg.diff && S.cfg.diff[k]) || 0));
const diffTag = k => { const n = getDiff(k); return n ? (n > 0 ? ' +' + n : ' −' + (-n)) : ''; };
const diffText = k => { const n = getDiff(k); return n === 0 ? '基准' : (n > 0 ? '+' + n + ' 档' : '−' + (-n) + ' 档'); };
function bumpDiff(k, d) {
  S.cfg.diff[k] = Math.max(DIFF_MIN, Math.min(DIFF_MAX, getDiff(k) + d));
  saveCfg();
  const v = document.querySelector('[data-dv="' + k + '"]');
  if (v) v.textContent = diffText(k);
}

const BO_TEMPLATE = `# 安多话注音标准
# 每行一条：藏文 = 拉丁注音（近似汉字）
# 按你自己的习惯改写下面这些样例，AI 会照同一套体系类推到其他词。

ཡོད། = yod（约）
རེད། = rəd（热）
ཡིན། = yin（因）
འགྲོ་ = ndro（卓）
གི་ = gə（格）
ང་ = nga（阿）
ཁྱོད་ = qhyod（秋）
མོ་ = mo（莫）
བུ་མོ་ = wumo（蒲莫）
སློབ་ཆུང་ = lopqung（洛琼）
ག་རེ་ = ghare（哈热）
ཟ་ = za（匝）
ཆུ་ = qhu（曲）

# 说明（可自由增删）：
# ə 表示央元音；q 表示送气的 ch；gh 表示浊擦音；
# 安多话保留前加字复辅音，不读拉萨话式的后加字变调。`;

VIEWS.set = function () {
  const c = S.cfg;
  const h =
    '<label class="lb">OpenAI API Key</label>' +
    '<input class="fld" id="fKey" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="sk-..." value="' + esc(c.key) + '">' +
    '<p class="note">保存在本机浏览器里，不会上传到任何第三方服务器。在 platform.openai.com 创建。</p>' +

    '<label class="lb">模型</label>' +
    '<input class="fld" id="fModel" list="mlist" autocapitalize="off" spellcheck="false" placeholder="gpt-4.1" value="' + esc(c.model) + '">' +
    '<datalist id="mlist">' + MODEL_INFO.map(m => '<option value="' + m.id + '" label="' + esc(m.note) + '">').join('') + '</datalist>' +
    '<p class="note">均衡之选是 gpt-6.1-sol；想省钱用 gpt-6-luna。GPT-6 / 5.x 都是推理模型，比 gpt-4.1 慢一些，但解析更准。' +
    '这是<b>默认</b>模型，可以在下面按语言单独覆盖——比如只给藏语换强模型。</p>' +

    '<div class="sec" style="margin-top:36px">按语言指定模型</div>' +
    '<p class="note" style="margin-top:0;margin-bottom:6px">藏语、哈萨克语这类训练语料稀少的语言，弱模型经常出错；而荷兰语、西班牙语用便宜的模型就够。' +
    '在这里只给需要的语言换成更强的模型，其余语言继续走上面的默认模型——总花销不会因此翻倍。</p>' +
    '<div style="border-top:1px solid var(--line);margin-top:14px">' +
    LK.map(k => {
      const cur = (S.cfg.modelBy && S.cfg.modelBy[k]) || '';
      const opts = MODELS.slice();
      if (cur && opts.indexOf(cur) === -1) opts.push(cur);
      return '<div class="stp"><div class="nm"><b>' + LANGS[k].zh + '</b><s>' +
        (cur ? '已指定 ' + esc(cur) : '跟随默认 · ' + esc(c.model || 'gpt-4.1')) + '</s></div>' +
        '<select class="msel" onchange="setModelFor(\'' + k + '\',this.value)">' +
        '<option value=""' + (cur ? '' : ' selected') + '>跟随默认</option>' +
        opts.map(m => '<option value="' + esc(m) + '"' + (cur === m ? ' selected' : '') + '>' + esc(modelLabel(m)) + '</option>').join('') +
        '<option value="__custom">自定义…</option></select></div>';
    }).join('') +
    '</div>' +
    /* 提示词编辑的入口刻意做得不显眼：平时不该动它，改坏了例句会整体走样 */
    '<div class="row" style="margin-top:12px">' +
    '<button class="btn sm" onclick="saveSet(true);go(\'corpus\')">编辑选材提示词' +
    (LK.filter(corpusEdited).length ? '（已改 ' + LK.filter(corpusEdited).length + ' 种）' : '') +
    '</button></div>' +

    '<div class="sec" style="margin-top:36px">句子难度</div>' +
    '<p class="note" style="margin-top:0;margin-bottom:6px">每按一次是很小的一步。生成新句子时，AI 会拿你最近读过的 40 句作为难度基准线，再按这里的档位微调，不会跨级跳跃。' +
    '<br><b>场景对话共用这一组档位</b>，只是基准换成该语言的对话水平（对话没有「最近读过的句子」可参照）。</p>' +
    '<div style="border-top:1px solid var(--line);margin-top:14px">' +
    LK.map(k => '<div class="stp"><div class="nm"><b>' + LANGS[k].zh + '</b><s>基准：' + LANGS[k].level +
      (LANGS[k].dialogue ? ' · 对话 ' + LANGS[k].dialogue : '') + '</s></div>' +
      '<div class="ct"><button onclick="bumpDiff(\'' + k + '\',-1)">−</button>' +
      '<span class="v" data-dv="' + k + '">' + diffText(k) + '</span>' +
      '<button onclick="bumpDiff(\'' + k + '\',1)">+</button></div></div>').join('') +
    '</div>' +

    '<div class="sec" style="margin-top:36px">西里尔手写体</div>' +
    '<p class="note" style="margin-top:0">俄语和哈萨克语的手写体和印刷体差得很远——т 写成 m、д 写成 g、и 写成 u、п 写成 n，' +
    '不专门看是认不出来的。开启后，句子阅读、整句翻译和词卡里会多出一行手写体。字体已内嵌在 App 里，断网也能显示。</p>' +
    '<button class="swi' + (c.hand ? ' on' : '') + '" style="margin-top:12px" onclick="toggleHand()">' +
    '<span class="kn"><i></i></span>' + (c.hand ? '手写体 开' : '手写体 关') + '</button>' +
    (c.hand ? '<div class="hand" style="margin-top:14px">Меня зовут Анна. · Сіз шай ішесіз бе?</div>' : '') +

    '<div class="sec" style="margin-top:36px">安多话注音标准</div>' +
    '<p class="note" style="margin-top:0">藏语没有可用的语音合成，注音就是发音的唯一依据。你可以在这里定义自己习惯的一套注音体系——只要填几个样例词，App 生成其他所有藏语注音时都会照这套标准类推。留空则使用默认体系。</p>' +
    '<div class="row" style="margin:12px 0 8px"><button class="btn sm" onclick="fillBoTpl()">插入模板</button>' +
    '<button class="btn sm" onclick="$(\'fBo\').value=\'\'">清空</button></div>' +
    '<textarea class="fld" id="fBo" style="min-height:180px;font-size:14px;font-family:ui-monospace,Menlo,monospace" ' +
    'placeholder="点上面「插入模板」开始，或直接按 藏文 = 注音（汉字） 的格式自己写">' + esc(c.boPron) + '</textarea>' +
    '<div class="row" style="margin-top:12px">' +
    '<button class="btn sm" onclick="go(\'borec\')">我的藏语发音' + (boCount() ? '（' + boCount() + '）' : '') + '</button></div>' +
    '<p class="note">在句子阅读里点开任意藏语词，就能手写它的注音、录下自己的发音。你手改过的注音会自动反哺给 AI（最多取 15 条、按覆盖新音节挑选，不会把 prompt 撑大）。</p>' +

    '<div class="sec" style="margin-top:36px">语音</div>' +
    '<p class="note" style="margin-top:0">荷兰语、西班牙语、日语、俄语直接调用 iOS 内置语音。<br>安多藏语目前没有可用的语音合成，改为显示注音。<br>哈萨克语 iOS 无内置音色：填了 Azure Key 就用真人音色 ' + AZ_VOICE + '（免费额度每月 50 万字符），不填则用 OpenAI 语音近似朗读。<br>第一次播放哈萨克语时会从 CDN 加载一次约 370 KB 的语音组件，之后不再重复加载。</p>' +

    '<label class="lb">朗读音色</label>' +
    '<p class="note" style="margin-top:0;margin-bottom:6px">默认「跟随系统」。如果听到的不是你在 iPhone「设置 → 辅助功能 → 朗读内容 → 声音」里选的那个，' +
    '就在这里直接点名——iOS 26 起系统不再把那里的选择告诉网页，点名是最可靠的办法。' +
    'Siri 音色苹果不开放给第三方，列表里不会有。</p>' +
    '<div id="vsels" style="border-top:1px solid var(--line)">' + voiceSelsHtml() + '</div>' +

    '<label class="lb">Azure Speech Key（可选 · 哈萨克语）</label>' +
    '<input class="fld" id="fAz" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="留空则使用 OpenAI 语音" value="' + esc(c.azKey) + '">' +
    '<label class="lb">Azure 区域</label>' +
    '<input class="fld" id="fAzR" list="azregs" autocapitalize="off" spellcheck="false" placeholder="westeurope" value="' + esc(c.azReg) + '">' +
    '<datalist id="azregs">' + AZ_REGIONS.map(r => '<option value="' + r + '">').join('') + '</datalist>' +
    '<p class="note">区域必须是资源所在区域的<b>短代码</b>：Azure 门户 → 你的 Speech 资源 → 概述 → 「位置」。把看到的名字去掉空格、全部小写填进来（West Europe → westeurope）。保存时会自动帮你规范化。<br>Key 和区域必须来自<b>同一个</b> Speech 资源。</p>' +
    '<div class="spacer"></div>' +
    '<button class="btn wide" onclick="testAzure(this)">测试哈萨克语语音</button>' +
    '<div id="azmsg"></div>' +

    '<div class="spacer"></div><div class="spacer"></div>' +
    '<button class="btn pri wide" onclick="saveSet()">保存设置</button>' +
    '<div class="spacer"></div>' +
    '<button class="btn wide" onclick="testKey(this)">测试 OpenAI 连接</button>' +
    '<div id="setmsg"></div>' +

    cloudSectionHtml() +

    '<div class="sec" style="margin-top:40px">本地存储</div>' +
    '<div id="stinfo" class="note" style="margin-top:0">' + LOADER + '</div>' +

    '<label class="lb">备份</label>' +
    '<div class="row">' +
    '<button class="btn sm" onclick="exportBackup()">导出备份文件</button>' +
    '<button class="btn sm" onclick="$(\'impf\').click()">从备份恢复</button>' +
    '<input type="file" id="impf" accept="application/json,.json" style="display:none" onchange="importBackup(this)">' +
    '</div>' +
    '<div id="bkinfo" class="note"></div>' +
    '<p class="note">备份文件包含全部卡片、设置、注音模板、藏语发音记录，以及你填的各个 Key，别随手转发给别人。' +
    '<b>删掉主屏幕图标会连同本机数据一起被 iOS 清除</b>，这是系统行为、网页无法阻止。' +
    (ossReady()
      ? '你已开了云端同步，卡片和录音在 OSS 里有一份，重装后填回 Key 就能拉回来——但 Key 本身只在这个备份文件里。'
      : '重装前务必先导出一次，或者打开上面的云端同步。') + '</p>' +

    '<label class="lb">其他</label>' +
    '<div class="row"><button class="btn sm" onclick="clearSeen()">清空难度基准记录</button>' +
    '<button class="btn sm" onclick="wipe()">清空全部数据</button></div>';
  shell('设置', h);
  paintStorage();
  paintCloudBar();
};

/* ---------------- 云端同步（阿里云 OSS） ---------------- */
function cloudSectionHtml() {
  const o = ossCfg();
  return '<div class="sec" style="margin-top:40px">云端同步（阿里云 OSS）</div>' +
    '<p class="note" style="margin-top:0">开启后，卡片库、难度记录、注音模板、以及你录的藏语发音都会同步到你自己的 OSS Bucket。' +
    '<b>所有 Key（OpenAI / Azure / OSS AccessKey）都不上云，只存这台设备。</b></p>' +

    '<button class="swi' + (o.on ? ' on' : '') + '" style="margin-top:12px" onclick="toggleCloud()">' +
    '<span class="kn"><i></i></span>' + (o.on ? '云端同步 开' : '云端同步 关') + '</button>' +

    '<label class="lb">地域 Endpoint</label>' +
    '<input class="fld" id="fEp" list="eplist" autocapitalize="off" spellcheck="false" placeholder="oss-eu-central-1.aliyuncs.com" value="' + esc(o.ep) + '">' +
    '<datalist id="eplist">' + OSS_EPS.map(e => '<option value="' + e + '">').join('') + '</datalist>' +
    '<label class="lb">Bucket 名称</label>' +
    '<input class="fld" id="fBk" autocapitalize="off" spellcheck="false" placeholder="yulengua" value="' + esc(o.bucket) + '">' +
    '<label class="lb">AccessKey ID</label>' +
    '<input class="fld" id="fAk" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" value="' + esc(o.ak) + '">' +
    '<label class="lb">AccessKey Secret</label>' +
    '<input class="fld" id="fSk" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" value="' + esc(o.sk) + '">' +
    '<p class="note">请用只能操作这一个 Bucket 的 RAM 子用户，不要用主账号的 AccessKey。</p>' +

    '<button class="swi' + (o.cache ? ' on' : '') + '" style="margin-top:14px" onclick="toggleAuCache()">' +
    '<span class="kn"><i></i></span>' + (o.cache ? '本机缓存音频 开' : '本机缓存音频 关') + '</button>' +
    '<p class="note">开着的话，每段录音只从云端下载一次，之后走本机。关掉能省手机空间，但每次播放都会产生一次公网流量。</p>' +

    '<div class="row" style="margin-top:16px">' +
    '<button class="btn sm" onclick="ossTest(this)">测试云端连接</button>' +
    '<button class="btn sm" onclick="cloudNow(this)">立即同步</button>' +
    '</div>' +
    '<div id="ossmsg"></div>' +
    '<div id="cloudst" class="note" style="margin-top:10px"></div>';
}

const OSS_EPS = ['oss-eu-central-1.aliyuncs.com', 'oss-eu-west-1.aliyuncs.com',
  'oss-cn-hangzhou.aliyuncs.com', 'oss-cn-shanghai.aliyuncs.com', 'oss-cn-beijing.aliyuncs.com',
  'oss-cn-shenzhen.aliyuncs.com', 'oss-cn-hongkong.aliyuncs.com', 'oss-ap-southeast-1.aliyuncs.com',
  'oss-us-west-1.aliyuncs.com', 'oss-us-east-1.aliyuncs.com'];

function readOss() {
  if (!$('fEp')) return S.cfg.oss || null;
  return {
    ep: $('fEp').value.trim().replace(/^https?:\/\//, '').replace(/\/+$/, ''),
    bucket: $('fBk').value.trim(),
    ak: $('fAk').value.trim(),
    sk: $('fSk').value.trim(),
    on: ossCfg().on,
    cache: ossCfg().cache
  };
}
function toggleCloud() {
  const o = readOss();
  o.on = !ossCfg().on;
  S.cfg.oss = o; saveCfg();
  if (o.on && !(o.bucket && o.ak && o.sk)) toast('还要填好 Bucket 和 AccessKey 才会真的同步');
  render();
  if (o.on && ossReady()) cloudSync(true);
}
function toggleAuCache() {
  const o = readOss();
  o.cache = !ossCfg().cache;
  S.cfg.oss = o; saveCfg();
  render();
}
async function cloudNow(btn) {
  saveSet(true);
  if (!ossReady()) { $('ossmsg').innerHTML = '<div class="err">云端还没启用，或 Bucket / AccessKey 没填全。</div>'; return; }
  const old = btn.innerHTML; btn.innerHTML = LOADER + ' 同步中'; btn.disabled = true;
  const ok = await cloudSync(true);
  btn.innerHTML = old; btn.disabled = false;
  toast(ok ? '已同步' : '同步失败，看下面的说明');
}

/* ---------------- 朗读音色 ---------------- */
const VOICE_LANGS = ['nl', 'ru', 'es', 'ja'];
const VOICE_SAMPLE = {
  nl: 'Goedemorgen! Hoe gaat het met je vandaag?',
  ru: 'Доброе утро! Как у вас дела?',
  es: '¡Buenos días! ¿Cómo estás hoy?',
  ja: 'おはようございます。今日は元気ですか。'
};
function voiceSelsHtml() {
  const any = voiceList().length > 0;
  return VOICE_LANGS.map(k => {
    const cur = (S.cfg.voiceBy && S.cfg.voiceBy[k]) || '';
    const vs = voicesFor(k);
    const found = !cur || vs.some(v => v.voiceURI === cur || v.name === cur);
    return '<div class="stp"><div class="nm"><b>' + LANGS[k].zh + '</b><s>' +
      (cur ? (found ? '已指定' : '已指定的音色这台设备上没有，暂用系统默认') : '跟随系统') +
      (any ? ' · 可选 ' + vs.length + ' 个' : '') + '</s></div>' +
      '<select class="msel" id="vsel_' + k + '" onchange="setVoiceFor(\'' + k + '\',this.value)">' +
      '<option value=""' + (cur ? '' : ' selected') + '>跟随系统</option>' +
      vs.map(v => '<option value="' + esc(v.voiceURI || v.name) + '"' +
        ((v.voiceURI === cur || v.name === cur) ? ' selected' : '') + '>' + esc(voiceLabel(v)) + '</option>').join('') +
      '</select>' +
      '<button class="btn sm" style="flex:none" onclick="testVoice(\'' + k + '\')">试听</button></div>';
  }).join('') +
    (any ? '' : '<p class="note">音色列表还没加载出来（iOS 常见）。点一下任意「试听」，或稍等几秒，列表会自己出现。</p>');
}
function paintVoiceSels() { const el = $('vsels'); if (el) el.innerHTML = voiceSelsHtml(); }
function setVoiceFor(k, v) {
  if (!S.cfg.voiceBy || typeof S.cfg.voiceBy !== 'object') S.cfg.voiceBy = {};
  if (v) S.cfg.voiceBy[k] = v; else delete S.cfg.voiceBy[k];
  saveCfg(true);                                  // 音色是设备相关的，不触发云端同步
  paintVoiceSels();
  testVoice(k);
}
function testVoice(k) {
  nativeSpeak(VOICE_SAMPLE[k], LANGS[k].tts);
  setTimeout(paintVoiceSels, 600);                // iOS 有时要先说一次话，音色列表才会出来
}

function toggleHand() {
  saveSet(true);
  S.cfg.hand = !S.cfg.hand;
  saveCfg();
  render();
}

function setModelFor(k, v) {
  if (v === '__custom') {
    const t = prompt('给' + LANGS[k].zh + '指定模型名（留空则跟随默认）：', (S.cfg.modelBy && S.cfg.modelBy[k]) || '');
    if (t === null) { render(); return; }
    v = t.trim();
  }
  if (!S.cfg.modelBy || typeof S.cfg.modelBy !== 'object') S.cfg.modelBy = {};
  if (v) S.cfg.modelBy[k] = v; else delete S.cfg.modelBy[k];
  saveCfg();
  render();
  toast(v ? LANGS[k].zh + ' 改用 ' + v : LANGS[k].zh + ' 恢复跟随默认模型');
}

async function paintStorage() {
  const el = $('stinfo'); if (!el) return;
  const i = await storageInfo();
  const eng = i.store === 'idb' ? 'IndexedDB' : 'localStorage（约 5 MB 上限）';
  const pm = { granted: '已开启，系统不会自动回收', denied: '未获批准，长期不打开可能被系统回收', unsupported: '本浏览器不支持', unknown: '检测中' }[i.persist];
  const bk = $('bkinfo');
  if (bk) {
    /* 注意不能写成 lastBackup | 0：位运算会把时间戳截成 32 位整数，
       1786989480000 会变成 283084864，显示成「1970/1/4，20679 天前」。 */
    const t = Math.max(0, Number(S.cfg.lastBackup) || 0);
    const days = t ? Math.floor((Date.now() - t) / 86400000) : -1;
    bk.innerHTML = !S.cards.length
      ? '卡片库是空的，暂时不需要备份。'
      : (t
        ? '上次备份：' + new Date(t).toLocaleDateString('zh-CN') + '（' + (days <= 0 ? '今天' : days + ' 天前') + '，当时 ' + S.cards.length + ' 张）' +
          (days >= 14 ? '<br><b>建议现在再导出一次。</b>' : '')
        : '<b>还从未备份过。现在导出一次，重装后就不会丢。</b>');
  }
  el.innerHTML =
    (ossReady() ? '数据存在本机，并同步到你自己的 OSS Bucket（Key 除外，永不上云）。<br>'
                : '数据全部存在这台设备本地，不上传任何服务器。<br>') +
    '存储引擎：' + eng + '<br>' +
    '持久化：' + pm + (i.persist === 'denied' ? ' <button class="btn sm" style="margin-left:4px" onclick="reqPersist(this)">再申请一次</button>' : '') + '<br>' +
    '已用空间：' + fmtBytes(i.used) + (i.quota ? ' / 可用配额约 ' + fmtBytes(i.quota) : '') + '<br>' +
    '卡片 ' + S.cards.length + ' 张，难度基准记录 ' + LK.reduce((a, k) => a + ((S.seen[k] || []).length), 0) + ' 句' +
    (boCount() ? '，藏语发音 ' + boCount() + ' 条' : '') + '。';
}
async function reqPersist(btn) { btn.innerHTML = '···'; persistState = 'unknown'; await requestPersist(); paintStorage(); }

function fillBoTpl() { const t = $('fBo'); if (!t.value.trim()) t.value = BO_TEMPLATE; else toast('已有内容，先清空再插入'); }

const AZ_REGIONS = ['westeurope', 'northeurope', 'swedencentral', 'francecentral', 'germanywestcentral',
  'uksouth', 'switzerlandnorth', 'eastus', 'eastus2', 'westus', 'westus2', 'westus3', 'centralus',
  'canadacentral', 'southeastasia', 'eastasia', 'japaneast', 'japanwest', 'koreacentral', 'australiaeast'];

function saveSet(quiet) {
  S.cfg.key = $('fKey').value.trim();
  S.cfg.model = $('fModel').value.trim() || 'gpt-4.1';
  S.cfg.azKey = $('fAz').value.trim();
  S.cfg.azReg = normReg($('fAzR').value) || 'westeurope';
  $('fAzR').value = S.cfg.azReg;
  S.cfg.boPron = $('fBo').value.trim();
  if ($('fEp')) S.cfg.oss = readOss();
  saveCfg(); if (!quiet) toast('已保存');
}

async function testAzure(btn) {
  saveSet(true);
  primeAudio();                                   // 必须在点击手势里同步执行
  const m = $('azmsg');
  if (!S.cfg.azKey) {
    m.innerHTML = '<div class="err">还没填 Azure Key。留空也能用——哈萨克语会改用 OpenAI 语音朗读，只是发音没那么准。</div>';
    return;
  }
  const old = btn.innerHTML;
  btn.innerHTML = LOADER + ' 正在测试'; btn.disabled = true;
  m.innerHTML = '';
  try {
    const blob = await azureSynth('Сәлеметсіз бе! Сіз шай ішесіз бе, әлде кофе ішесіз бе?');
    playUrl(URL.createObjectURL(blob));
    m.innerHTML = '<div class="err">连接成功 · 音色 ' + AZ_VOICE + ' · 区域 ' + esc(S.cfg.azReg) +
      '<br>正在播放测试语音，听到女声说哈萨克语就说明配好了。</div>';
  } catch (e) {
    m.innerHTML = '<div class="err">失败 · ' + esc(azureHint(e.message)) +
      '<div class="note" style="margin-top:8px">原始错误：' + esc(String(e.message).slice(0, 200)) + '</div></div>';
  } finally { btn.innerHTML = old; btn.disabled = false; }
}
async function testKey(btn) {
  saveSet();
  const m = $('setmsg'); m.innerHTML = '<div class="note" style="margin-top:14px">' + LOADER + ' 正在测试…</div>';
  try {
    const r = await ai([{ role: 'user', content: '只回复两个字：正常' }], false);
    m.innerHTML = '<div class="err">连接成功 · 模型返回：' + esc(r.slice(0, 40)) + '</div>';
  } catch (e) {
    m.innerHTML = '<div class="err">连接失败 · ' + esc(e.message) + '</div>';
  }
}
function clearSeen() {
  if (!confirm('清空所有语言「最近读过的句子」记录？难度基准会重新从基准水平开始，卡片库不受影响。')) return;
  S.seen = {}; saveSeen();
  render(); toast('已清空基准记录');
}
function wipe() {
  if (!confirm('确定清空所有卡片和设置？此操作不可撤销。建议先导出一份备份文件。')) return;
  Object.keys(CB.meta).forEach(cbDrop);
  LIB.open = {}; LIB.cache.clear();
  S.cards = []; S.seen = {}; S.bo = {}; S.del = {}; S.pulse = {}; S.trash = null;
  S.cfg = Object.assign({}, CFG_DEFAULT);
  normCfg();
  saveCards(true); saveSeen(true); saveBo(true); saveCfg(true); savePulse(true);
  try { LK.forEach(k => localStorage.removeItem('lg.seen.' + k)); localStorage.removeItem('lg.cards'); localStorage.removeItem('lg.bo'); } catch (e) {}
  home(); toast('已清空');
}

/* ---------------- 选材提示词编辑 ----------------
   六种语言各自的「选材规则」那一段，直接决定生成的例句是什么题材、多长、
   用到哪些语法点。改这里是把自己的偏好写进 prompt，不改就用内置的那份。 */
VIEWS.corpus = function () {
  let body = '<p class="note" style="margin-top:0">生成例句时，这段文字会原样放进 prompt 的「选材规则」里，' +
    '决定题材、句长和语法范围。想练疑问句、想读新闻体、想把句子改短，都是在这里改。<br>' +
    '<b>留空 = 用内置的那份。</b>难度档位和「最近读过的 40 句」不受这里影响，仍然照常起作用。</p>';

  body += LK.map(k => {
    const edited = corpusEdited(k);
    return '<div class="sec" style="margin-top:26px">' + esc(LANGS[k].zh) +
      (edited ? ' · 已改' : ' · 内置') + '</div>' +
      '<textarea class="fld" id="cps_' + k + '" rows="4" ' +
      'style="min-height:120px;font-size:14px;line-height:1.7" ' +
      'placeholder="留空则使用内置的那一份">' + esc(edited ? corpusFor(k) : '') + '</textarea>' +
      '<div class="row" style="margin-top:8px">' +
      '<button class="btn sm" onclick="corpusFill(\'' + k + '\')">填入内置原文</button>' +
      '<button class="btn sm" onclick="corpusReset(\'' + k + '\')">恢复默认</button>' +
      '</div>' +
      (edited ? '' : '<p class="note" style="margin-top:8px">内置：' + esc(LANGS[k].corpus) + '</p>');
  }).join('');

  body += '<div class="spacer"></div><div class="spacer"></div>' +
    '<button class="btn pri wide" onclick="corpusSave()">保存</button>' +
    '<div class="spacer"></div>' +
    '<button class="btn wide" onclick="corpusResetAll()">全部恢复默认</button>' +
    '<p class="note">改动会跟着设置一起备份，也会同步到云端（如果开了云端同步）。</p>';

  shell('选材提示词', body);
};

/* 把内置原文填进输入框，方便在它基础上改，而不是从零写 */
function corpusFill(k) {
  const t = $('cps_' + k);
  if (!t) return;
  if (t.value.trim()) { toast('已有内容，先清空再填入'); return; }
  t.value = LANGS[k].corpus;
}

function corpusReset(k) {
  const t = $('cps_' + k);
  if (t) t.value = '';
  corpusSave(true);
  toast(LANGS[k].zh + ' 已恢复内置提示词');
}

function corpusResetAll() {
  if (!confirm('把六种语言的选材提示词全部恢复成内置的那份？')) return;
  S.cfg.corpusBy = {};
  saveCfg();
  render();
  toast('已全部恢复默认');
}

function corpusSave(quiet) {
  if (!S.cfg.corpusBy || typeof S.cfg.corpusBy !== 'object') S.cfg.corpusBy = {};
  LK.forEach(k => {
    const t = $('cps_' + k);
    if (!t) return;
    const v = t.value.trim();
    /* 和内置原文一字不差就当成没改，免得以后内置那份更新了却被旧副本挡住 */
    if (!v || v === LANGS[k].corpus) delete S.cfg.corpusBy[k];
    else S.cfg.corpusBy[k] = v;
  });
  saveCfg();
  render();
  if (!quiet) toast(LK.filter(corpusEdited).length
    ? '已保存 · ' + LK.filter(corpusEdited).map(k => LANGS[k].zh).join('、') + ' 用你改过的提示词'
    : '已保存 · 六种语言都在用内置提示词');
}
