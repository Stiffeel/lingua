# CLAUDE.md — Yulengua 维护指南

> 给接手维护的 Claude Code 看的。先读完这份再动代码。用户是唯一使用者，中文交流。

## 1. 项目是什么

- iPhone 主屏幕上的六语学习 PWA：荷兰语 `nl`、标准安多藏语 `bo`、哈萨克语 `kk`、俄语 `ru`、西班牙语 `es`、日语 `ja`
- **单文件**、无服务器、无框架、无依赖：所有 HTML/CSS/JS 拼成一个 `index.html`，托管在 GitHub Pages（`https://stiffeel.github.io/yulengua/`）
- 浏览器直连 OpenAI（用户自己的 Key）、可选 Azure Speech（哈萨克语真人音色）、可选阿里云 OSS（多设备同步）
- 卡片导出给「墨墨记忆卡」(Markji)，所以卡片正文是墨墨标记语法
- 模块：句子阅读 / 场景对话 / 单词查询（含整句翻译、中英→六语反向翻译）/ Daily Pulse / 卡片库

## 2. 仓库结构

```
index.html        构建产物，Pages 直接发布这份。不要手改
build/            源码，按模块拆开（见 §4）
build.py          把 build/* 拼成 site/index.html 和根目录 index.html
test.js           Playwright 端到端测试（OpenAI / OSS / 语音全部 mock）
icon_data.txt     图标 base64（APPLE / FAV / BIG 三段），build.py 读取
words/<lang>.csv  Daily Pulse 词库，用户自己维护；README.md 说明格式
docs/             用户文档（OSS 配置、哈萨克语语音配置）
README.md         极简说明 + debug 记录
```

`site/`、`shots/`、`node_modules/` 是本地产物，已在 `.gitignore`。

## 3. 命令与工作流

```bash
npm i                         # 首次：装 playwright
npx playwright install chromium
python3 build.py              # 构建 → site/index.html + ./index.html
node test.js                  # 测试（读 site/），失败时退出码非 0，截图在 shots/
npm test                      # = build + test
```

**每次改动的固定流程**：
1. 只改 `build/` 里的源文件
2. `python3 build.py`
3. `node test.js` 全绿
4. 把 `build/` 和根目录 `index.html` **一起提交**（只提交源码不提交 index.html，线上就不会变）
5. Pages 部署约 1 分钟；iPhone 上要彻底关掉 App 再开才会拿到新版（无 Service Worker，靠 Safari 缓存刷新）

修 bug 时：先在 `test.js` 里写一个能复现的断言，确认它失败，再修。改完后把实现临时回滚一次，确认测试会红——这个项目的测试都是这样做过「变异检验」的，保持这个习惯。

改完后在 `README.md` 的「debug 记录」里追加一行（每条一行：现象 + 根因 + 改法）。

## 4. 源码地图（`build/`，按拼接顺序）

| 文件 | 内容 |
|---|---|
| `01_head.html` | `<head>`、全部 CSS、`__APPLE__/__FAV__/__MANIFEST__/__FONTS__` 占位符 |
| `02_core.js` | `CFG_DEFAULT`、全局状态 `S`、存储（IndexedDB 主 / localStorage 兜底）、`LANGS`/`LK`、哈萨克语西里尔→托特文/拉丁、俄语重音→拉丁、`markjiLint`、`unmark`/`escp`、分词校准 `fixToks`/`segUnits`、toast/sheet、路由 `go`/`back`/`render`/`VIEWS`、朗读（系统 TTS + Azure）、`renderCodes`（墨墨标记→HTML） |
| `02b_cloud.js` | 阿里云 OSS V4 签名（Web Crypto）、`ossProbe`/`ossAuthDiag` 诊断、`cloudSnapshot`/`cloudMerge`/`cloudSync`/`cloudTouch`（4 秒防抖） |
| `03_api.js` | `MODEL_INFO`（模型列表与说明）、`modelFor`/`guessLang`、`ai()`（Chat Completions，自动降级到 Responses）、**全部 prompt 构造函数** |
| `04_home.js` | 首页、语言选择 `LANG_MODS`、设置页（Key、模型、按语言模型、选材提示词编辑、难度、朗读音色、云端同步、备份） |
| `05_reading.js` | 句子阅读、点词词卡 `showWord`、追问、`detailFor` 生成卡片、`saveDetail`、`refreshUnderSheet` |
| `05b_bo.js` | 藏语注音 + 录音面板（按词形归一化复用） |
| `06_dialogue.js` | 场景对话 |
| `07_lookup.js` | 单词查询 / 整句翻译 / 反向翻译（`revGroups` 按模型分组请求） |
| `07b_pulse.js` | Daily Pulse：CSV 解析、词库缓存、抽词、熟知标记、造句 + 本地校验 `pulseVerify` |
| `08_lib.js` | 卡片库（App 内复习）：语言标签页、点击展开、发音/移到最后、编辑、删除/撤销、复制墨墨格式 |
| `09_tail.html` | 启动逻辑（`loadAll` → 渲染首页 → 云同步） |
| `fonts.css` | 内嵌的西里尔手写体子集（Marck Script + Caveat，SIL OFL）。**静态文件，不要手改**；生成脚本已丢失，要加字形得重新做子集 |

所有文件拼在同一个 `<script>` 里，共享全局作用域，后面的文件可以用前面定义的东西。函数声明会提升，但 `const` 不会——新增顶层 `const` 时注意文件顺序。

## 5. 状态与数据

```
S.cfg     设置（见 CFG_DEFAULT，每个字段都有注释）
S.cards   卡片【索引】[{id, lang, front, ts, pos, ct, bv}]——不含正文，正文见下面「卡片正文」
S.seen    每语言最近读过的 40 句（难度基准）
S.bo      藏语发音库：归一化词 → {w, p 注音, h 音频哈希, x 扩展名, ts}
S.del     删除墓碑 'lang|front' → 删除时间，保留 180 天
S.pulse   {known:{lang:{词:±ts}}, cur:{lang:[词]}, gl:{lang:{词:释义}}}
S.stack   视图栈 [{view, arg}]
```

卡片的三个时间字段**含义不同，不能混用**：
- `ts` = 最后修改时间，只用于云端合并「谁新听谁的」
- `pos` = 排序键，卡片库按它降序（`byPos`）。新建/覆盖 = now；「移到最后」= 当前最小值 − 1
- `ct` = 创建时间，只用于显示（老卡片从 id `c<13位时间戳>` 里解析，见 `cardCreated`）

保存函数：`saveCards(q)` / `saveCfg(q)` / `saveBo(q)` / `saveSeen(q)` / `savePulse(q)`。
`q = true` 的意思是「这次写入本身就是同步结果，或者是只属于本机的设置」——**不触发云端回传**，`saveCfg(true)` 也不更新 `cfgTs`。普通用户操作一律用不带参数的版本。

### 卡片正文（索引与正文分离）

`S.cards` 里**绝不能出现 `detail` / `notes` / `added`**（`cardSlim()` 会剥掉，并把老格式的 `detail` 搬进正文存储）。正文 `{d 详解（墨墨标记）, n 追问详解, bv}` 单独存：
- 云端 `cards/<id>.json`；本机 IndexedDB `cb:<id>`，元数据 `CB.meta[id] = {bv, at, up}`
- `bv` = 正文最后编辑时间，**只在编辑正文时改**（`saveEdit` / `saveDetail`），「移到最后」只动 `ts`/`pos`。缓存的 `bv` 与索引的 `bv` 不一致 = 缓存过期（`cbLoad` 据此重取）
- `up:false` = 云端还没有这一版，本机这份是唯一的，**永不回收**；`up:true` 的只留最近 `CB_KEEP` 张（`cbEvict`）。没开云端时全是 `up:false`
- `cloudSync` 顺序：合并 → `cloudPushBodies()`（失败则整次同步失败）→ 才 PUT `data.json`，否则别的设备会看到索引却取不到正文
- 删卡**不删**云端正文（为了能撤销），会留下孤儿文件，目前不清理
- 导出墨墨格式统一走 `mjCard(detail, notes)`：追问详解接在答案面末尾，再过 `markjiLint`
- 追问不再喂给 `detailPrompt`，原样进「追问详解」栏

### 云端合并规则（`cloudMerge`）

同步是 GET → 合并 → PUT 整个 `data.json`，所以**任何「删除」或「取消」都必须有显式表示**，否则会被远端复活。这是本项目最常见的一类 bug。

- 卡片：同 id 取 `ts` 大的；`S.del` 墓碑比卡片新则删掉；最后按 `pos` 排序并 `normCards()`
- 藏语发音：按 `ts`
- `pulse.known`：带符号时间戳，正 = 熟知，负 = 明确取消，**绝对值大的胜**；负值 90 天后清理
- `pulse.gl`：并集；`pulse.cur`：本地为空时才取远端
- `seen`：并集，保留最近 40
- cfg：按 `cfgTs`，**只同步** `boPron, diff, corpusBy, autoSpeak`
- 不同步：`key`、`azKey`、`oss`（所有密钥）、`voiceBy`（音色是设备相关的）、`modelBy`、`model`

新增需要同步的数据时：加进 `cloudSnapshot`，在 `cloudMerge` 里写合并规则，想清楚「删除/取消」怎么表示，再写一个两设备交替修改的测试。

## 6. 硬性规则

### 安全（不可违反）
- API Key / AccessKey **永远不上传**到任何云端；`data.json` 里绝不能出现任何密钥（`cloudSnapshot` 是白名单，保持白名单）
- OSS 文档和提示只能指导用户用**最小权限的 RAM 子用户**，不能用主账号 AccessKey
- Bucket 读写权限必须是**私有**
- 备份文件含明文密钥，UI 和文档里要提醒不要随便分享
- 不引入任何第三方脚本、CDN、统计、遥测

### AI 输出一律本地校验，不信任模型
- 分词：`fixToks()` 按原句本地校准（空格是硬边界；藏语按音节点、日语按字种兜底，`TOK_MAX_UNITS = 4`）
- 造句：`pulseVerify()` 检查模型声称用到的词形是否真的出现在句子里
- 哈萨克语：**只让模型输出西里尔文**，托特文/拉丁转写由 `kkArab`/`kkLat` 本地算
- 俄语：显示的正文里不要重音符；转写由 `ruLat` 本地算
- 卡片：`markjiLint()` 检查墨墨语法
- 优先「确定性本地计算」，而不是「让模型更小心」

### 显示
- 任何 AI 返回的字段进 UI 都要走 `escp()`（= 转义 + `unmark()` 剥掉墨墨标记），不要直接 `innerHTML`
- 卡片正文（`detail`）显示时走 `renderCodes()`
- 打开着词卡（sheet）时要刷新底下的页面，**用 `refreshUnderSheet()`，不要用 `render()`**——`render()` 会关掉 sheet，也不要直接调某个固定模块的 `paintXxx()`（曾导致从单词查询跳到句子阅读）

### Prompt
- 全部集中在 `03_api.js`，共用规则片段：`BASE`、`TOK_STRICT`、`RU_RULE`、`KK_CYR_ONLY`、`boPronRule()`、`diffRule`、`dlgDiffRule`
- JSON 接口的 prompt 必须明确禁止在字段里使用墨墨标记；墨墨标记只出现在整张卡片正文里
- 选材规则用 `corpusFor(k)`（用户可在设置里覆盖），不要直接读 `LANGS[k].corpus`
- 内置的 `LANGS[k].corpus` 文本是用户逐字给的，改动前先问用户

### 墨墨（Markji）卡片语法
- 文字样式 `[T#样式#文字]`，段落 `[P#样式#文字]`，填空 `[F##文字]`
- 样式：`B` `I` `U` `D`（删除线）`up` `down` `!hex`（字色）`!!hex`（背景色）`H1`–`H3` `center` `right`，多个样式用逗号
- `---` 单独一行是正反面分隔，**每张卡只能有一个**
- 标记内部不能出现 `]`；不能用 Markdown
- `[Pic|Audio|Card#…]` 在 App 里不渲染，`renderCodes` 会剥掉

### 代码风格
- 用户可见文案和注释都用中文
- 注释写「为什么」，尤其是踩过的坑；改动处保留原有注释风格
- 原生 JS，不引入框架或构建工具链；保持单文件可直接打开
- 兼容 iOS Safari（主屏幕 standalone 模式）是第一目标

## 7. 已知的坑

- **iOS 26 朗读音色**：系统不再把「设置 → 辅助功能 → 朗读内容」里选的音色告诉网页，`lang` 只能拿到默认（通常是男声）。所以 App 默认只设 `lang`，另有「设置 → 语音 → 朗读音色」让用户按语言点名（`S.cfg.voiceBy`，存 voiceURI，只存本机）。Siri 音色第三方拿不到。`voiceschanged` 是异步的，首次 `getVoices()` 常为空
- **藏语**无系统 TTS（`tts: null`），靠用户自己录音；**哈萨克语** `tts: 'api'` 走 Azure
- **模型**：`MODEL_INFO` 里的新模型多是推理模型，慢；有的只开放 Responses 接口——`ai()` 遇到报错提到 `v1/responses` 会自动改走 Responses 并记进 `RESP_ONLY`。更新模型列表前先上网查 OpenAI 当前的模型名，不要凭记忆
- `response_format: json_object` 不被支持时会 400，`ai()` 会去掉它重试一次
- **必须 https**：Web Crypto（OSS 签名）和麦克风都需要
- **OSS 常见报错**：`CORS_OR_NETWORK` = 跨域规则 Headers 没填 `*`；`AccessDenied` = RAM 子用户没挂权限。设置页的诊断会给出提示，改 OSS 逻辑时保留它
- **词库**：CSV 由用户上传，可能上万词。解析必须保持线性（现 2 万词约 50–70 ms），编码自动识别 UTF-8 / GBK / Windows-1252，分隔符和表头都要容错。**不要替用户生成大词库**
- Daily Pulse 里「勾选但还没换一批」的词**不显示删除线**（用户明确要求）
- **教训**：之前有一次工作区重置导致源码丢失，只能从产物 `index.html` 里拆回来。源码必须在仓库里

## 8. 常见改动怎么做

**加一种语言**
1. `02_core.js`：`LANGS` 加条目（`zh native code tts level dialogue corpus sample`，以及需要的 `gram/en/translit/dual`），加进 `LK`
2. `03_api.js`：`guessLang` 按字符集识别；有特殊书写规则就仿照 `RU_RULE`/`KK_CYR_ONLY` 加片段
3. `segUnits` 里确认分词兜底对这种文字成立
4. 需要系统 TTS 的加进 `04_home.js` 的 `VOICE_LANGS` 和 `VOICE_SAMPLE`
5. 需要手写体的加进 `HAND_LANGS`（并确认 `fonts.css` 覆盖了字形）
6. `words/<lang>.csv` 由用户提供
7. 测试里至少跑通阅读、查词、存卡片

**加一个模块**：新建 `build/0x_name.js` → 注册 `VIEWS.name` → 在 `build.py` 的 `parts` 里加上 → 首页入口；要按语言进入就加进 `LANG_MODS` → 在 `refreshUnderSheet` 里加分支（如果模块里能打开词卡）

**改 prompt**：只改 `03_api.js`；如果改了输出 JSON 的字段，同步改调用方和 `test.js` 里的 mock

**更新模型列表**：只改 `MODEL_INFO`（id + 中文一句话说明），其余地方都从它派生

## 9. 回归清单（每次发版前心里过一遍，`test.js` 已覆盖大部分）

- 分词：坏切分被本地校准拆开，每个词都能点
- 从单词查询打开藏语词卡、改注音/录音、关掉 → 仍停在单词查询
- 删除卡片 → 同步 → 不会复活；勾「已添加」不会改变卡片顺序
- 「移到最后」→ 同步后顺序不变，可撤销，创建日期不变
- Daily Pulse 取消勾选 → 同步后不会被勾回来；替换词库不丢熟知记录
- 卡片库展开显示渲染后的卡面，没有原始标记
- 卡片索引里没有正文；缓存过期（`bv` 变了）会重取；没上传的正文不被回收；`data.json` 里卡片不带 `detail`，每张卡有对应的 `cards/<id>.json`
- 朗读默认不强塞音色；选了音色就用它；音色不存在时回落系统
- `data.json` 里没有任何密钥，也没有 `voiceBy`
- 特殊模型自动走 Responses，普通模型仍走 Chat Completions

## 10. 和用户协作

- 用户会先描述现象，不一定知道原因；先定位根因，再改，回复里用一两句话说清「原因 + 改法」
- 涉及产品方案（新功能、数据格式、交互）先讨论再动手；明确的 bug 直接修
- 不确定线上行为时（iOS 版本差异、OpenAI 接口变化），先查资料再下结论
- 完成后提醒用户：提交并等 Pages 部署后，彻底关掉主屏幕 App 再打开
