/* ================= Yulengua · AI ================= */

function needKey() {
  if (!S.cfg.key || !S.cfg.key.trim()) { toast('请先在设置中填写 API Key'); go('set'); return true; }
  return false;
}

/* ---------------- 模型选择 ----------------
   全局一个模型，另外可以按语言单独指定。这样藏语、哈萨克语这类语料稀少、
   弱模型容易出错的语言可以单独上强模型，其余语言继续走便宜的那个。 */
/* 2026 年 10 月时点 OpenAI 的文本模型（新到旧）。都能走 Chat Completions；
   GPT-6 / 5.x 系列是推理模型，会比 4.1 慢一些。列表外的模型仍可「自定义…」手输。 */
const MODEL_INFO = [
  { id: 'gpt-6.1-sol', note: '均衡 · 官方推荐' },
  { id: 'gpt-6-astra', note: '最强 · 最贵' },
  { id: 'gpt-6-sol', note: '均衡 · 上一版' },
  { id: 'gpt-6-luna', note: '最便宜 · 最快' },
  { id: 'gpt-5.6-sol', note: '上一代 · 均衡' },
  { id: 'gpt-5.6-terra', note: '上一代 · 中档' },
  { id: 'gpt-5.6-luna', note: '上一代 · 便宜' },
  { id: 'gpt-5.5', note: '' },
  { id: 'gpt-5.4-mini', note: '便宜' },
  { id: 'gpt-5.4-nano', note: '极便宜' },
  { id: 'gpt-4.1', note: '旧 · 非推理，快' },
  { id: 'gpt-4.1-mini', note: '旧 · 非推理，便宜' }
];
const MODELS = MODEL_INFO.map(m => m.id);
const modelLabel = id => { const m = MODEL_INFO.find(x => x.id === id); return m && m.note ? id + ' · ' + m.note : id; };
const globalModel = () => (S.cfg.model || 'gpt-4.1').trim();
function modelFor(k) {
  const m = k && S.cfg.modelBy && S.cfg.modelBy[k];
  return (m && String(m).trim()) || globalModel();
}

/* 本地判断一段文字是哪种语言 —— 只看字符集，不花钱、不等待。
   用途是在发请求【之前】就知道该用哪个模型。拉丁字母分不出荷/西，
   返回空字符串走全局模型即可。 */
function guessLang(t) {
  const s = String(t || '');
  if (/[ༀ-࿿]/.test(s)) return 'bo';                       // 藏文
  if (/[؀-ۿٴ]/.test(s)) return 'kk';                 // 阿拉伯字母 = 新疆哈萨克文
  if (/[぀-ヿ]/.test(s)) return 'ja';                       // 假名
  if (/[Ѐ-ӿ]/.test(s)) return /[әғқңөұүһі]/i.test(s) ? 'kk' : 'ru';
  return '';
}

const oaPost = (path, b) => fetch('https://api.openai.com/v1/' + path, {
  method: 'POST',
  headers: { 'Authorization': 'Bearer ' + S.cfg.key.trim(), 'Content-Type': 'application/json' },
  body: JSON.stringify(b)
});
async function oaErr(r) {
  try { const j = await r.json(); return (j.error && j.error.message) || ''; } catch (e) { return ''; }
}
/* 有些模型（尤其是 pro 一类）只开放 Responses 接口，走 Chat Completions 会被拒，
   报错里会点名 v1/responses。遇到这种情况自动改走 Responses，并记住这个模型，
   以后直接走对的那条路。这样以后手输一个新模型名也不怕。 */
const RESP_ONLY = new Set();
const isRespOnlyErr = m => /v1\/responses|Responses API|not supported in the v1\/chat\/completions/i.test(m || '');

async function ai(messages, wantJson, lang) {
  const model = modelFor(lang);
  if (RESP_ONLY.has(model)) return aiResp(model, messages, wantJson);
  const body = { model: model, messages: messages };
  if (wantJson) body.response_format = { type: 'json_object' };
  let r = await oaPost('chat/completions', body);
  if (!r.ok) {
    let m = await oaErr(r);
    if (isRespOnlyErr(m)) { RESP_ONLY.add(model); return aiResp(model, messages, wantJson); }
    if (wantJson && r.status === 400) {             // 少数模型不认强制 JSON，去掉再试一次
      delete body.response_format;
      r = await oaPost('chat/completions', body);
      if (!r.ok) m = await oaErr(r);
    }
    if (!r.ok) throw new Error('HTTP ' + r.status + (m ? ' · ' + m : ''));
  }
  const j = await r.json();
  return ((j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '').trim();
}

async function aiResp(model, messages, wantJson) {
  const body = { model: model, input: messages.map(m => ({ role: m.role, content: m.content })) };
  if (wantJson) body.text = { format: { type: 'json_object' } };
  let r = await oaPost('responses', body);
  let m = '';
  if (!r.ok) {
    m = await oaErr(r);
    if (wantJson && r.status === 400) { delete body.text; r = await oaPost('responses', body); if (!r.ok) m = await oaErr(r); }
    if (!r.ok) throw new Error('HTTP ' + r.status + (m ? ' · ' + m : ''));
  }
  const j = await r.json();
  if (typeof j.output_text === 'string' && j.output_text) return j.output_text.trim();
  return (j.output || []).map(o => (o.content || []).filter(c => c && c.type === 'output_text').map(c => c.text || '').join(''))
    .join('').trim();
}

async function aiJson(messages, lang) {
  const raw = await ai(messages, true, lang);
  let t = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a > 0 || b < t.length - 1) t = t.slice(a === -1 ? 0 : a, b === -1 ? t.length : b + 1);
  return JSON.parse(t);
}

/* ---------------- shared fragments ---------------- */
const BASE = '你是一位精通荷兰语、藏语（安多方言）、哈萨克语、俄语、西班牙语、日语的语言学教师，母语中文，同时精通英语。你的解释准确、克制、不废话。所有回复严格输出 JSON，不要输出多余文字。' +
  '\n【JSON 字段是纯文本】这些字段会被应用直接显示在界面上，不经过任何标记渲染。' +
  '所以字段值里【绝对不要】出现 [T#…#…]、[F##…]、[Audio#…] 之类的墨墨记忆卡标记，也不要写 markdown。' +
  '需要强调时就用文字说明，不要用标记。那套标记只在生成卡片正文时才用。';

const NL_GENDER_RULE =
  '【荷兰语词性标注规则】名词必须标出 de-woord 或 het-woord。' +
  '其中【只有 het-woord 需要加高亮标记】（写作 [T#!!fedcb6#het-woord]），' +
  '因为 het 词数量少、需要重点记忆；de-woord 直接写出即可，不要加任何高亮。';

const MARKJI_RULES = `【墨墨记忆卡语法 —— 违反会让卡片显示错乱，必须严格遵守】
1. 字体高亮写作 [T#!rrggbb#文字]，背景高亮写作 [T#!!rrggbb#文字]。色值必须是【6 位小写十六进制】，不能写 3 位。
2. 【标记的内容里绝对不能出现右方括号 ]】——墨墨会在那里提前截断整个标记。需要括号时一律用中文括号（）。同理内容里也不要出现多余的 [。
3. 一个标记必须完整写在同一行里，不能跨行折断。
4. 墨墨不支持 markdown：不要写 # 标题、不要写 **加粗**、不要写 \`\`\` 代码块、不要写表格。需要加粗请用 [T#B#文字]。
5. 【整张卡片只能有一条答案线 ---】（三个减号单独成行）。正文里不要再出现 --- 或 ——— 之类的分隔线，墨墨会把每一条 --- 都当成一个新的答案面。
6. 除了 [T#…]，不要自创其他方括号标记。`;

const ES_GENDER_RULE = '【西班牙语词性标注规则】名词必须标出 el / la 及性数，不需要高亮。';

/* 分词是应用里最容易被模型做坏的一环：合并两个词会导致点开只查得到前一个，
   整句一个 token 则根本点不开。应用侧另有确定性校准兜底，这里先把话说死。 */
const TOK_STRICT = '\n【tokens 硬性要求】每一项必须【只包含一个词】：' +
  '绝对不能把两个词写进同一项（"de kat" 必须拆成 "de" 和 "kat"），' +
  '也绝对不能把整句或半句当成一个 token。原句有几个词，tokens 就有几项，宁可切细也不要合并。\n';

const RU_RULE = '【俄语书写规则 —— 硬性要求】\n' +
  '1. 你写出的俄语【西里尔原文一律不加重音符号】（不要 \u0301），保持干净的普通拼写。\n' +
  '2. 重音信息只通过指定字段传达：需要标重音的地方（translit、forms、详解正文里的词形），' +
  '请写成【带重音符号的西里尔】，应用会自动把重音搬到拉丁注音上，并把展示出来的西里尔还原成不带重音的形式。\n' +
  '3. 不要自己写拉丁转写——拉丁注音由应用按固定规则生成，你写了会冲突。\n' +
  '4. 名词标性（м.р. / ж.р. / ср.р.）与关键格变化；动词必须标体（несов. / сов.）并给出对应的另一个体、人称变位与过去时四形。';

/* 哈萨克语一律只写西里尔字母：新疆哈萨克文（托特文）由应用按正字法算法生成，
   模型自己拼阿拉伯字母几乎必错，所以彻底禁止。 */
const KK_CYR_ONLY = '【哈萨克语书写规则 —— 硬性要求】所有哈萨克语内容一律【只写哈萨克斯坦西里尔字母】。' +
  '绝对不要输出任何阿拉伯字母 / 新疆哈萨克文（töte jazu）/ 拉丁转写——这些由应用按正字法规则自动生成并排显示，你写了反而会冲突。';

/* 用户在词卡里手改过的注音，反哺给模型。
   全量塞进 prompt 会越用越贵，所以只挑「能带来新音节」的条目，最多 15 条：
   同一个音节已经被别的样例覆盖过，就不再重复举例。 */
const BO_FEED_MAX = 15;
function boFeedSamples() {
  if (typeof boList !== 'function') return [];
  const out = [], cov = new Set();
  boList().filter(e => e.p).forEach(e => {
    if (out.length >= BO_FEED_MAX) return;
    const syl = boSyls(e.w);
    if (!syl.length || syl.some(s => !cov.has(s))) {
      syl.forEach(s => cov.add(s));
      out.push(e);
    }
  });
  return out;
}

function boPronRule() {
  const t = (S.cfg.boPron || '').trim();
  const mine = boFeedSamples();
  const feed = mine.length
    ? '\n\n【用户亲手改过的注音 —— 优先级最高，出现这些词时必须原样照抄】\n' +
      mine.map(e => e.w + ' = ' + e.p).join('\n') +
      '\n这些是用户逐个校对过的读音。遇到表中没有的词，请按这张表体现出来的拼写习惯类推。'
    : '';

  if (!t) {
    return '【安多话注音】用拉丁转写反映【安多口语实际发音】（不是拉萨话，也不是古典书面藏文的逐字母转写），' +
      '后加圆括号内的近似汉字注音。注意安多话保留复辅音前缀、不读部分后加字、元音无拉萨话式的变化。' + feed;
  }
  return '【安多话注音标准 —— 用户已指定，必须严格遵守】\n' +
    '下面是用户给出的注音样例对照表。你写注音时必须完全采用同一套拼写体系、同一套符号约定、同一种格式：\n' +
    t +
    '\n遇到样例中没出现过的音，按同一体系类推，不要混入其他转写方案（不要用 Wylie、不要用拉萨话读音）。' + feed;
}

/* 难度微调 */
function diffRule(k) {
  const n = (S.cfg.diff && S.cfg.diff[k]) || 0;
  const base = '【难度校准】上面「禁止重复」列出的句子就是用户最近实际在读的内容，请把它们当作当前难度的基准线。';
  if (!n) return base + '\n本次请生成一句与这些句子【难度相当】的新句子。';
  const dir = n > 0 ? '略难' : '略简单';
  const step = Math.abs(n);
  return base + '\n用户已把难度在这个基准上调整了 ' + (n > 0 ? '+' : '−') + step + ' 档。' +
    '\n本次请生成一句比基准线【' + dir + ' ' + step + ' 档】的句子。' +
    '\n一档是很小的一步，大致相当于：句子长 2–3 个词、或多一个从句、或多一个次常用词、或多一个新语法点。' +
    '严禁跨级跳跃（不要因为 +2 就直接写成高级文章，也不要因为 −2 就退化成单词罗列）。';
}

/* 场景对话的难度：和句子阅读共用同一组档位，但基准不是 L.level 而是 L.dialogue，
   而且没有「最近读过的 40 句」这条基准线，所以要单独写一段以对话水平为锚的说明。 */
function dlgDiffRule(k) {
  const L = LANGS[k];
  const n = (S.cfg.diff && S.cfg.diff[k]) || 0;
  const base = '【难度校准】这段对话的基准水平是「' + L.dialogue + '」。';
  if (!n) return base + '请严格按这个水平说话。';
  const dir = n > 0 ? '略难' : '略简单';
  const step = Math.abs(n);
  return base + '用户把难度在这个基准上调整了 ' + (n > 0 ? '+' : '−') + step + ' 档，' +
    '请把你说的每一句都控制在比基准【' + dir + ' ' + step + ' 档】的水平。' +
    '\n一档是很小的一步，大致相当于：句子长 2–3 个词、或多一个从句、或多一个次常用词、或多一个新语法点。' +
    '严禁跨级跳跃（不要因为 +2 就说成书面长句，也不要因为 −2 就退化成单词罗列）。' +
    '批改用的 corrected 也按同一水平写。';
}

/* ---------------- 句子生成 ---------------- */
function sentencePrompt(k, avoid) {
  const L = LANGS[k];
  let extra = '';
  if (k === 'kk') extra = '\n' + KK_CYR_ONLY + '\n"tokens" 为西里尔词切分。"alt" 和 "translit" 一律留空字符串。';
  if (k === 'bo') extra = '\n"text" 用藏文字母书写；"translit" 给出这句话的安多口语注音。' + boPronRule() +
    '\n"tokens" 为按词切分，每个 token 末尾保留音节点 ་（句末保留 །）。';
  if (k === 'ru') extra = '\n' + RU_RULE +
    '\n"text" 必须是不带任何重音符号的普通俄语原句。' +
    '\n"translit" 请填【同一句话、但标注了重音符号的西里尔写法】（在重读元音后加 U+0301，单音节词不标）——应用会据此生成拉丁注音。' +
    '\n"tokens" 按词切分（标点可并入相邻词，不带重音符号），用空格连接后须还原 "text"。';
  if (k === 'ja') extra = '\n"translit" 给出全句假名读音 + 罗马字。"tokens" 按词（含助词单独成词）切分，拼接后须等于 "text"。';
  if (k === 'nl' || k === 'es') extra = '\n"tokens" 按词切分（标点可并入相邻词或单独成 token），用空格连接后须还原原句。';
  return [
    { role: 'system', content: BASE },
    {
      role: 'user', content:
        '为' + L.zh + '学习者生成 1 个全新的例句（基准水平：' + L.level + '）。\n\n【选材规则】\n' + corpusFor(k) +
        '\n\n【风格样例（只参考风格与体裁，不要照抄）】\n' + L.sample +
        '\n\n【禁止重复】以下句子已出现过，必须换全新的话题和句式：\n' +
        (avoid.length ? avoid.slice(-40).map(s => '· ' + s).join('\n') : '（无，这是第一句）') +
        '\n\n' + diffRule(k) +
        '\n\n输出 JSON：\n' +
        '{"text":"目标语言原句","alt":"","translit":"","zh":"中文翻译","en":"","tokens":["逐词切分"],"gloss":["与 tokens 一一对应的极简中文词义"]}' +
        '\n"gloss" 数组长度必须与 "tokens" 完全一致，每项只写 2–8 个字的核心词义（动词写词典义即可，助词/介词写其语法作用，如「（宾格助词）」）。' +
        TOK_STRICT +
        extra +
        (L.en ? '\n"en" 填英文翻译。' : '\n"en" 留空字符串。') +
        (k === 'kk' ? '' : '\n"alt" 留空字符串。') +
        ((L.translit || k === 'kk') ? '' : '\n"translit" 留空字符串。')
    }
  ];
}

/* ---------------- 单词详解 ---------------- */
function wordPrompt(k, word, sentence) {
  const L = LANGS[k];
  let g = '', extraJson = '';
  /* 这里是给界面用的结构化字段，不能带高亮标记，所以不用 NL_GENDER_RULE */
  if (k === 'nl') g = '【荷兰语词性标注】名词必须分清 de-woord 与 het-woord（het 词数量少、要重点记忆）。' +
    '"gender" 字段只填【de】或【het】两个字母之一，不要写成 "het-woord"，更不要加任何标记。' +
    '\n若为名词，forms 给出复数与（若有）指小形式；若为动词，forms 必须给出：现在时全人称、过去时单复数、过去分词（并注明完成时助动词 hebben/zijn）、以及是否可分动词。若为形容词，说明变格规则。';
  if (k === 'es') g = ES_GENDER_RULE +
    '\n若为名词，"gender" 填 "el" 或 "la"，forms 给出单复数；若为动词，forms 必须给出：不定式、现在时全人称（yo/tú/él/nosotros/vosotros/ellos）、简单过去时、未完成过去时、以及（如常用）虚拟式现在时和过去分词。';
  if (k === 'kk') g = KK_CYR_ONLY + '\n"alt" 和 "translit" 一律留空字符串（应用会自己算）。' +
    '\n若为动词，forms 给出词根与常见时态人称变化；若为名词，forms 给出常见格变化或领属形式。';
  if (k === 'ru') g = RU_RULE +
    '\n"word" / "lemma" / "example.text" 一律写不带重音符号的形式。' +
    '\n"gender" 填 "м.р." / "ж.р." / "ср.р."（非名词留空）。' +
    '\n"translit" 填该词【带重音符号的西里尔】写法。forms 里的每个词形也都带重音符号。' +
    '\n若为名词，forms 至少给出：单数主格/属格/宾格/与格/前置格，以及复数主格；' +
    '若为动词，forms 必须给出：体与对应的另一个体、现在时（或简单将来时）全人称变位、过去时四形；' +
    '若为形容词，forms 给出阳/阴/中/复数主格。';
  if (k === 'bo') g = '"translit" 给出该词的安多口语注音。' + boPronRule() +
    '\nforms 说明该词的语法功能（如助动词、格助词、动词的时态形式等）。';
  if (k === 'ja') g = '"translit" 给出假名读音 + 罗马字。若为动词，forms 给出词类（一段/五段/サ变）、ます形、て形、た形、否定形；若为形容词，给出い/な类别与变形。';
  return [
    { role: 'system', content: BASE },
    {
      role: 'user', content:
        '在' + L.zh + '句子中：「' + sentence + '」\n请详细解析其中的词：「' + word + '」\n\n' + g +
        '\n\n输出 JSON：\n{"word":"句中出现的形式","lemma":"词典原形","pos":"词性（中文）","gender":"' +
        (L.gram ? '冠词/性，无则空' : '') + '","alt":"","translit":"","zh":"中文释义（可多个义项，用；分隔）","en":"' +
        (L.en ? '英文释义' : '留空') + '","example":{"text":"一个新的例句（目标语言，难度接近' + L.level + '）","zh":"该例句的中文翻译"},' +
        '"forms":[{"k":"标签","v":"内容"}],"note":"详细解释：构词法、用法搭配、易混淆点、在本句中的语法作用。用中文书写，可分行，控制在 300 字以内。"' +
        extraJson + '}' +
        '\nforms 是数组，每项 {"k":"如 现在时","v":"如 ik kom | jij komt | hij komt | wij komen"}；若该词无需变位则给空数组 []。' +
        ''
    }
  ];
}

/* ---------------- 句子详解 ---------------- */
const DETAIL_SPEC = `【输出格式规范（必须严格遵守）】
整体结构：

{中文翻译}

{目标语言原句}
---
{逐词与语法解析}

规则：
1. 第一行是整句中文翻译；空一行后是目标语言原句；再空一行后写 --- 单独成行作为答案线；答案线之后是解析正文。
2. 绝对不要输出任何 [Audio#...] 标记。
3. 可以使用高亮标记强调关键规律，全篇 2–5 处，不要滥用：
   字体高亮写作 [T#!d16056#要高亮的文字]
   背景高亮写作 [T#!!fff895#要高亮的文字]
   （常用背景色：fff895 黄、fedcb6 橙、fbc0bc 粉）
4. 解析正文按「词 → 语法点」组织。每个重要词单独起一段，格式为：
   词（词性/冠词）：中文释义
   然后换行展开构词法、变位、搭配、易混点。
5. 分语言的硬性要求：
   荷兰语：名词必须标 de-woord / het-woord 与复数。【只有 het-woord 要加高亮】（如 [T#!!fedcb6#het-woord]），de-woord 直接写出、不加任何高亮。动词必须给出现在时人称变位、过去时、过去分词，并说明可分/不可分前缀与完成时助动词。
   西班牙语：名词必须标 el/la 与性数（不加高亮）；动词必须给出不定式与相关时态的人称变位表。
   俄语：正文里出现的俄语词形请写成【带重音符号的西里尔】（如 студе\u0301нт），应用会自动去掉重音并在后面补上拉丁注音。名词标性与关键格变化；动词标体（несов./сов.）、人称变位与过去时。
   日语：动词标词类与ます形/て形/た形；助词单独解释。
   哈萨克语：给出词根与附加成分拆解。只写西里尔字母，不要写阿拉伯字母或拉丁转写。
   藏语（安多）：给出安多口语注音，并说明助词/助动词的作用。
6. 若能自然带出同类构词规律，可以补一小组同类词举例（3–8 条），这是本格式的特色。
7. 全部解释用中文。不要写「以下是解析」之类的开场白，直接从中文翻译开始。
8. 不要使用任何 markdown（# 标题、** 粗体、\`\`\` 代码块、表格）。用纯文本、缩进和空行组织层次。需要加粗用 [T#B#文字]。`;

const DETAIL_SAMPLE = `【范例】
周末过后，暖气流将来自西班牙和法国。

Na het weekend komt warmte uit Spanje en Frankrijk.
---
Na (介词)：在……之后。

weekend (名词)：周末。单数形式为 weekend（[T#!!fedcb6#het-woord]，复数形式为 weekends）。

动词变位：komen（来、来到）
 * 现在时 (OTT)：
   * ik kom
   * jij / u komt
   * hij / zij / het komt
   * wij / jullie / zij komen
 * 过去时 (OVT)：
   * ik / jij / hij kwam
   * wij / jullie / zij kwamen
 * 过去分词 (Voltooid Deelwoord)：
   * is gekomen（完成时助动词使用 zijn）

warmte (名词)：温暖、热量、暖气流。
单数形式为 warmte（de-woord，无常见复数形式）。
[T#!!fff895#后缀 -te ]是一个非常典型的"派生后缀"，用来将形容词转化为抽象名词（通常表示某种性质、状态或物理量）。
[T#!!fff895#这类由 -te 构成的抽象名词，全部都是 de-woorden。]
常见的同类构词例子：
 warm（温暖的） - de warmte（温暖、热量）
 hoog（高的） - de hoogte（高度、海拔）
 breed（宽的） - de breedte（宽度、纬度）
 diep（深的） - de diepte（深度）
 groot（大的） - de grootte（大小、规模）
 sterk（强的） - de sterkte（强度、力量）
 zwak（弱的） - de zwakte（虚弱、弱点）`;

function detailPrompt(k, sent, qa) {
  const L = LANGS[k];
  const ctx = qa && qa.length
    ? '\n\n【用户在阅读这句话时的追问与解答，其中涉及的语法点必须被整合进解析中】\n' +
      qa.map(x => '问：' + x.q + '\n答：' + x.a).join('\n\n')
    : '';
  return [
    { role: 'system', content: '你是一位精通' + L.zh + '的语言学教师，母语中文。你按用户指定的固定格式撰写句子详解。只输出详解正文，不要输出 JSON、不要任何前后缀说明。' },
    {
      role: 'user', content:
        '为下面这句' + L.zh + '撰写「句子详解」。\n\n原句：' + sent.text +
        (sent.alt ? '\n（阿拉伯字母哈萨克文）：' + sent.alt : '') +
        (sent.translit ? '\n（注音）：' + sent.translit : '') +
        '\n参考翻译：' + sent.zh + ctx +
        (k === 'bo' ? '\n\n' + boPronRule() : '') +
        (k === 'kk' ? '\n\n' + KK_CYR_ONLY : '') +
        (k === 'ru' ? '\n\n' + RU_RULE : '') +
        '\n\n' + MARKJI_RULES + '\n\n' + DETAIL_SPEC + '\n\n' + DETAIL_SAMPLE
    }
  ];
}

/* ---------------- 追问 ---------------- */
function askPrompt(k, sent, qa, q) {
  const L = LANGS[k];
  const msgs = [{
    role: 'system', content: '你是一位精通' + L.zh + '的语言学教师，母语中文。学生正在阅读一个' + L.zh +
      '句子并向你提问。用中文简洁准确地回答，重点讲清语法与用法，必要时举例。不要客套，不要用 markdown 标题和粗体，直接讲解。控制在 400 字以内。' +
      (k === 'nl' ? '\n' + NL_GENDER_RULE : '') + (k === 'ru' ? '\n' + RU_RULE : '') +
      '\n\n当前句子：' + sent.text + (sent.translit ? '\n注音：' + sent.translit : '') + '\n翻译：' + sent.zh
  }];
  (qa || []).forEach(x => { msgs.push({ role: 'user', content: x.q }); msgs.push({ role: 'assistant', content: x.a }); });
  msgs.push({ role: 'user', content: q });
  return msgs;
}

/* ---------------- 背单词：批量补齐释义 ----------------
   只在词库里那一列留空时才会用到，一次请求解决一批，结果缓存起来不重复花钱。 */
function pulseGlossPrompt(k, words) {
  const L = LANGS[k];
  return [
    { role: 'system', content: BASE },
    {
      role: 'user', content:
        '下面是一组' + L.zh + '单词，请给每个词一个【极简中文释义】（2–12 个字，多个义项用；分隔，不要例句、不要词性说明）。\n' +
        words.map(w => '· ' + w).join('\n') +
        '\n\n输出 JSON：{"gloss":{"原词":"中文释义"}}\n' +
        '键必须和上面列出的词【一字不差】，一个都不能漏，也不要多加别的词。' +
        (k === 'kk' ? '\n' + KK_CYR_ONLY : '') +
        (k === 'ru' ? '\n俄语的键写不带重音符号的原形。' : '')
    }
  ];
}

/* ---------------- 背单词：用选中的词造句 ----------------
   难点在「既要塞进 N 个指定的词，又不能因此把难度顶上去」。
   所以把两件事拆开说死：句子【可以长】，但语法和词汇的难度必须停在设定档位；
   宁可用并列和简单从句把词串起来，也不要为了凑词上高级句式。 */
function pulseSentPrompt(k, words) {
  const L = LANGS[k];
  const n = (S.cfg.diff && S.cfg.diff[k]) || 0;
  const lvl = '【难度 —— 硬性要求】这句话的语法和词汇难度必须停在「' + L.level + '」' +
    (n ? '，并且按用户设定再' + (n > 0 ? '略难 ' : '略简单 ') + Math.abs(n) + ' 档（一档 ≈ 多一个从句或一个次常用词，严禁跨级跳跃）' : '') + '。' +
    '\n为了装下指定的词，【句子长度可以放宽】——可以写成长句、并列句、带一两个简单从句。' +
    '但长≠难：不要因此使用超出上述水平的时态、语气、句式或生僻词。' +
    '把词用并列、连接词、简单从句自然地串起来即可。';
  let extra = '';
  if (k === 'kk') extra = '\n' + KK_CYR_ONLY + '\n"alt" 和 "translit" 一律留空字符串。';
  if (k === 'bo') extra = '\n"text" 用藏文书写；"translit" 给出安多口语注音。' + boPronRule() +
    '\n"tokens" 每项末尾保留音节点 ་（句末保留 །）。';
  if (k === 'ru') extra = '\n' + RU_RULE +
    '\n"text" 与 "tokens" 不带重音符号；"translit" 填【带重音符号的西里尔】整句。';
  if (k === 'ja') extra = '\n"translit" 给出全句假名读音 + 罗马字。';
  return [
    { role: 'system', content: BASE },
    {
      role: 'user', content:
        '请用下面这些' + L.zh + '单词造【一句话】（只要一句，不是一段）：\n' +
        words.map(w => '· ' + w).join('\n') +
        '\n\n【必须全部用上】上面每一个词都要出现在这句话里，一个都不能漏。\n' +
        '【允许变形】可以按语法需要变位、变格、变复数、加词缀——但必须是【这个词本身】的形式，' +
        '不能换成同义词、近义词或同根的另一个词。\n' +
        '【逐词交代】"used" 数组里，每个原词对应它在句中实际出现的形式，' +
        '这个形式必须和句子里的写法【一字不差】（含大小写与标点之外的一切）。原词按上面给的顺序，一个不漏。\n\n' +
        lvl + '\n\n' +
        '输出 JSON：\n' +
        '{"text":"目标语言的那一句话","alt":"","translit":"","zh":"中文翻译","en":"' + (L.en ? '英文翻译' : '留空') + '",' +
        '"tokens":["逐词切分"],"gloss":["与 tokens 一一对应的极简中文词义"],' +
        '"used":[{"w":"给定的原词","form":"它在句中的实际形式"}],' +
        '"note":"逐个说明每个词在句中用了什么形式、为什么这么变；再点出这句话里值得注意的语法点。中文，250 字以内"}' +
        TOK_STRICT +
        '"gloss" 数组长度必须与 "tokens" 完全一致。' +
        extra
    }
  ];
}

/* ---------------- 单词查询 ---------------- */
function lookupPrompt(q) {
  return [
    { role: 'system', content: BASE },
    {
      role: 'user', content:
        '用户在一个多语言词典里模糊查询：「' + q + '」\n' +
        '候选语言只有这六种：荷兰语(nl)、安多藏语(bo)、哈萨克语(kk)、俄语(ru)、西班牙语(es)、日语(ja)。\n' +
        '用户可能输入：目标语言的词（可能拼写有误、变位形式、或只是词的一部分）、中文、英文、罗马字/拉丁注音、假名、西里尔或阿拉伯字母哈萨克文、藏文。\n' +
        '请返回 1–5 个最可能的匹配（跨语言混合，按可能性排序）。若输入是中文/英文，则给出各语言中对应的词。\n\n' +
        KK_CYR_ONLY + '（用户即使用阿拉伯字母哈萨克文来查询，你也要在 word 里回西里尔形式。）\n\n' +
        '输出 JSON：{"items":[{"lang":"nl|bo|kk|ru|es|ja","word":"该语言的词（原形；哈萨克语用西里尔；俄语不带重音符号）","alt":"一律留空","translit":"藏/日给注音；俄语给【带重音符号的西里尔】写法（应用会转成拉丁注音）；否则空","pos":"词性（中文）","gender":"荷兰语 de/het，西班牙语 el/la，俄语 м.р./ж.р./ср.р.，否则空","zh":"中文释义","en":"英文释义（荷/西/俄必填，其余可空）","forms":["最多3条：动词给原形与关键变位、名词给复数或格变化"],"example":{"text":"一个简短例句","zh":"中文翻译"}}]}\n' +
        '保持轻量：释义简短，例句一句，forms 最多 3 条。'
    }
  ];
}

/* ---------------- 整句翻译（单词查询模块里的第二种用法） ---------------- */
function transPrompt(text) {
  return [
    { role: 'system', content: BASE },
    {
      role: 'user', content:
        '用户粘贴了一段文字，请判断它属于哪种语言，然后翻译并做逐词切分。\n' +
        '候选语言只有这六种：荷兰语(nl)、安多藏语(bo)、哈萨克语(kk)、俄语(ru)、西班牙语(es)、日语(ja)。' +
        '如果都不是（比如用户贴的是中文或英文），"lang" 填空字符串，其余字段尽力填。\n\n' +
        '原文：\n' + text +
        '\n\n输出 JSON：\n' +
        '{"lang":"nl|bo|kk|ru|es|ja|","text":"整理后的原句（修掉明显的排版换行，保留原意与拼写）","alt":"","translit":"","zh":"中文翻译","en":"英文翻译（荷/西/俄填，其余留空）","tokens":["逐词切分"],"gloss":["与 tokens 一一对应的极简中文词义"],"note":"这句话里值得一提的语法点，中文，200 字以内"}\n' +
        '"gloss" 数组长度必须与 "tokens" 完全一致，每项 2–8 个字（助词/介词写语法作用）。\n' +
        '"tokens" 用空格连接后须还原 "text"（日语和藏语直接拼接即可）。' + TOK_STRICT + '\n' +
        '【按判定出的语言另外遵守】\n' +
        '· 哈萨克语：' + KK_CYR_ONLY + ' "alt" 与 "translit" 留空，应用会自己算。\n' +
        '· 俄语：' + RU_RULE + ' "text" 与 "tokens" 不带重音符号；"translit" 填【带重音符号的西里尔】整句。\n' +
        '· 藏语：' + boPronRule() + ' "translit" 填整句安多口语注音；"tokens" 每个词末尾保留音节点 ་（句末保留 །）。\n' +
        '· 日语：\"translit\" 给出全句假名读音 + 罗马字。\n' +
        '· 荷兰语 / 西班牙语：\"translit\" 留空。'
    }
  ];
}

/* ---------------- 反向翻译：中文 / 英文 → 六种语言 ----------------
   ks 是这一批要翻译成的语言。之所以要分批：不同语言可能被指定了不同的模型，
   同一个模型的语言合并成一次请求，既保证藏语走强模型，又不会让请求数翻六倍。 */
function revPrompt(q, ks) {
  const list = ks.map(k => k + '(' + LANGS[k].zh + ')').join('、');
  const per = {
    kk: KK_CYR_ONLY + ' "alt" 与 "translit" 一律留空，应用会自己算。',
    ru: RU_RULE + ' "text" 与 "tokens" 不带重音符号；"translit" 填【带重音符号的西里尔】。',
    bo: boPronRule() + ' "translit" 填安多口语注音；"tokens" 每项末尾保留音节点 ་（句末保留 །）。',
    ja: '"translit" 给出假名读音 + 罗马字。',
    nl: '名词请在 "gender" 里填 de 或 het（只填这两个字母之一，不要加任何标记）。"translit" 留空。',
    es: '名词请在 "gender" 里填 el 或 la。"translit" 留空。'
  };
  return [
    { role: 'system', content: BASE },
    {
      role: 'user', content:
        '用户输入了一段【中文或英文】，请把它翻译成下面这些语言：' + list + '。每种语言各给一条，一条都不能少，顺序照给定顺序。\n\n' +
        '原文：\n' + q + '\n\n' +
        '先判断原文是一个【词 / 短语】还是一个【句子】，填进 "kind"（"word" 或 "sent"）。\n' +
        '· kind=word 时：给这个词在该语言里最贴切的对应词（用词典原形），并填 pos / gender / lemma。\n' +
        '· kind=sent 时：给一句自然地道的整句翻译，pos / gender / lemma 留空。\n\n' +
        '输出 JSON：\n' +
        '{"kind":"word|sent","zh":"原文的中文意思（原文是英文就译成中文，本来是中文就原样抄回）",' +
        '"items":[{"lang":"' + ks.join('|') + '","text":"译文","alt":"","translit":"","pos":"词性（中文，kind=sent 时留空）",' +
        '"gender":"冠词/性，无则留空","lemma":"词典原形，kind=sent 时留空",' +
        '"note":"这条译法值得一提的地方：语域、和其他常见译法的区别、需要注意的搭配。中文，60 字以内",' +
        '"tokens":["译文的逐词切分"],"gloss":["与 tokens 一一对应的极简中文词义"]}]}\n' +
        '"gloss" 数组长度必须与 "tokens" 完全一致，每项 2–8 个字。' + TOK_STRICT + '\n' +
        '【分语言硬性要求】\n' + ks.map(k => '· ' + LANGS[k].zh + '：' + per[k]).join('\n')
    }
  ];
}

function lookupAskPrompt(item, qa, q) {
  const msgs = [{
    role: 'system', content: '你是一位精通' + LANGS[item.lang].zh + '的语言学教师，母语中文。学生正在查词典。' +
      '用中文简洁准确地回答，控制在 400 字以内，不要 markdown 标题和粗体。' +
      (item.lang === 'nl' ? '\n' + NL_GENDER_RULE : '') + (item.lang === 'ru' ? '\n' + RU_RULE : '') +
      '\n\n当前词条：' + item.word + '（' + item.pos + '）＝ ' + item.zh
  }];
  (qa || []).forEach(x => { msgs.push({ role: 'user', content: x.q }); msgs.push({ role: 'assistant', content: x.a }); });
  msgs.push({ role: 'user', content: q });
  return msgs;
}

function wordCardPrompt(item, qa) {
  const L = LANGS[item.lang];
  const ctx = qa && qa.length ? '\n\n【用户追问，涉及的语法点须整合进来】\n' + qa.map(x => '问：' + x.q + '\n答：' + x.a).join('\n\n') : '';
  return [
    { role: 'system', content: '你是一位精通' + L.zh + '的语言学教师，母语中文。按用户指定格式撰写单词卡片。只输出正文。' },
    {
      role: 'user', content:
        '为' + L.zh + '单词「' + item.word + '」撰写一张词汇卡片。已知释义：' + item.zh + ctx +
        (item.lang === 'nl' ? '\n\n' + NL_GENDER_RULE : '') +
        (item.lang === 'es' ? '\n\n' + ES_GENDER_RULE : '') +
        (item.lang === 'bo' ? '\n\n' + boPronRule() : '') +
        (item.lang === 'kk' ? '\n\n' + KK_CYR_ONLY : '') +
        (item.lang === 'ru' ? '\n\n' + RU_RULE : '') +
        '\n\n【输出格式】\n第一行：中文释义（简短）\n空行\n第二行：' + L.zh + '单词本身\n空行\n--- 单独成行\n' +
        '之后是解析：词性、（荷/西）冠词与性、变位或变格、构词法、常见搭配、1–2 个例句（带中文翻译）、以及同类词规律举例。\n' +
        '可用 [T#!d16056#文字] 字体高亮 与 [T#!!fff895#文字] 背景高亮，全篇 1–4 处。\n' +
        '绝对不要输出 [Audio#...] 标记。全部用中文解释。\n\n' + MARKJI_RULES
    }
  ];
}

/* ---------------- 场景对话 ---------------- */
function dlgOpenPrompt(k, topic) {
  const L = LANGS[k];
  return [
    { role: 'system', content: BASE },
    {
      role: 'user', content:
        '设计一个' + L.zh + '（' + L.dialogue + '水平）的情景对话练习。用户给的提示是：「' + topic + '」\n' +
        '请据此设定一个具体、自然的场景，并说出对话的第一句（由你扮演的角色先开口）。\n' +
        dlgDiffRule(k) + '\n句子简短自然，像真实口语。\n\n' +
        '输出 JSON：{"scene":"用中文简述场景：地点、你扮演谁、用户扮演谁、对话目标","role":"你扮演的角色（中文）","line":"' + L.zh + '第一句话","zh":"中文翻译","en":"' + (L.en ? '英文翻译' : '留空') + '","tokens":["line 的逐词切分"],"gloss":["与 tokens 一一对应的极简中文词义"]}' +
        '\n' + TOKEN_RULE(k)
    }
  ];
}

function TOKEN_RULE(k) {
  const base = '"gloss" 数组长度必须与 "tokens" 完全一致，每项只写 2–8 个字的核心词义（助词/介词写其语法作用，如「（宾格助词）」）。';
  if (k === 'ja') return '"tokens" 按词切分（助词单独成词），拼接后须等于原句。' + TOK_STRICT + base;
  return '"tokens" 按词切分（标点可并入相邻词），用空格连接后须还原原句。' + TOK_STRICT + base;
}

function dlgTurnPrompt(k, scene, history, userLine) {
  const L = LANGS[k];
  const msgs = [{
    role: 'system', content: BASE + '\n\n你正在和一位' + L.zh + '学习者做情景对话练习。场景：' + scene +
      '\n' + dlgDiffRule(k) + '\n你每轮要做两件事：(1) 批改用户上一句的' + L.zh + '，(2) 用' + L.zh + '自然地接着对话。' +
      '\n\n【关于 feedback.corrected 的硬性要求】' +
      '\ncorrected 必须是一个【可以直接朗读、直接背诵的最终正确版本】：完整的一句话，语法全对、用词地道、标点齐全、大小写正确。' +
      '\n· 不要在 corrected 里写解释、括号注释、"应改为"、箭头、删除线或任何标记，只写那一句正确的' + L.zh + '。' +
      '\n· 如果用户原句已经完全正确，corrected 就填一个在该场景下【最自然地道的说法】（可以和原句相同，也可以是更地道的等价说法）。' +
      '\n· 所有的解释、错在哪、为什么，全部放进 note 字段，用中文写。' +
      '\n\n输出 JSON：{"feedback":{"verdict":"ok 或 fix","corrected":"最终正确版本的完整句子","note":"中文讲解，说明错在哪、为什么；若原句已正确则说明为何这样说更自然。60–150 字","ctokens":["corrected 的逐词切分"],"cgloss":["与 ctokens 一一对应的极简中文词义"]},"line":"' + L.zh + '你的下一句话","zh":"中文翻译","en":"' + (L.en ? '英文翻译' : '留空') + '","tokens":["line 的逐词切分"],"gloss":["与 tokens 一一对应的极简中文词义"]}' +
      '\n' + TOKEN_RULE(k) + '\nctokens / cgloss 对 corrected 用同样的规则。'
  }];
  history.forEach(m => {
    if (m.who === 'sys') msgs.push({ role: 'assistant', content: m.line });
    else msgs.push({ role: 'user', content: m.line });
  });
  msgs.push({ role: 'user', content: userLine });
  return msgs;
}

/* ---------------- 词卡内追问 ---------------- */
function wordAskPrompt(j, context, qa, q) {
  const k = j._lang, L = LANGS[k];
  const msgs = [{
    role: 'system', content: '你是一位精通' + L.zh + '的语言学教师，母语中文。学生刚看完一个词的详解，正在就这个词继续提问。' +
      '用中文简洁准确地回答，控制在 350 字以内，不要 markdown 标题和粗体，直接讲解。' +
      (k === 'nl' ? '\n' + NL_GENDER_RULE : '') + (k === 'ru' ? '\n' + RU_RULE : '') +
      (k === 'kk' ? '\n' + KK_CYR_ONLY : '') + (k === 'bo' ? '\n' + boPronRule() : '') +
      '\n\n当前词：' + (j.word || '') + (j.lemma && j.lemma !== j.word ? '（原形 ' + j.lemma + '）' : '') +
      '\n词性：' + (j.pos || '') + (j.gender ? ' / ' + j.gender : '') +
      '\n释义：' + (j.zh || '') +
      '\n它出现的上下文：' + context
  }];
  (qa || []).forEach(x => { msgs.push({ role: 'user', content: x.q }); msgs.push({ role: 'assistant', content: x.a }); });
  msgs.push({ role: 'user', content: q });
  return msgs;
}
