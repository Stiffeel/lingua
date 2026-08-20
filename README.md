# Yulengua

![PWA](https://img.shields.io/badge/PWA-Single--file-black?style=flat-square)
![GitHub Pages](https://img.shields.io/badge/Deploy-GitHub%20Pages-222?style=flat-square&logo=github)
![iPhone](https://img.shields.io/badge/iPhone-Home%20Screen-000?style=flat-square&logo=apple)


A personal multilingual learning PWA · AI-powered · local-first
Yulengua是一个多语言学习App，适合汉语母语、有一定语言学基础的业余爱好者。
其设计初衷是充分利用AI在外语学习中的价值，简化流程，省去管理chat、打磨提示词的时间。

**支持语言：🇳🇱荷兰语·🏔️安多藏语·🇰🇿哈萨克语·🇷🇺俄语·🇪🇸西班牙语·🇯🇵日语**

> **Yulengua** 是一个可直接部署到 **GitHub Pages** 的单文件 PWA，  
> 安装到 iPhone 主屏幕后即可全屏运行，核心学习数据默认保存在本机。
> 详细配置方法请看[初始配置](#🚀 初始配置)

**版本更新时，请不要删除桌面图标！**


<p>
  <a href="#features">功能</a> ·
  <a href="#configure">初始配置</a> ·
  <a href="#author">作者的话</a>
</p>

<a id="features"></a>

## ✨ 功能

### 📖 **句子阅读**：分语言按难度生成句子，逐词释义、深度解析、追问、卡片保存。

![0e923b3033f0f3bea3e07c50e76e0d75_raw.mp4 [video-to-gif output image]](https://picgobucketshihy.oss-cn-shanghai.aliyuncs.com/ezgif-837262d3e3a492d9.gif)



### 💬 **场景对话**：用模糊关键词指定主题对话，听力优先练习，纠错和追问。

![image-20260820115228478](https://picgobucketshihy.oss-cn-shanghai.aliyuncs.com/image-20260820115228478.png)



### 🔎 查词 / 整句翻译：六语对照，支持单词详解和追问。

![70ad8246156fd6ccfa48354e9c3c449b.mp4 [video-to-gif output image]](https://picgobucketshihy.oss-cn-shanghai.aliyuncs.com/ezgif-8d09bf35cf253663.gif)



### ⚡ **Daily Pulse**：每日生词、熟词淘汰、勾词造句与复习。

![image-20260820112619883](https://picgobucketshihy.oss-cn-shanghai.aliyuncs.com/image-20260820112619883.png)

- #### 🗂️ **卡片库**：生成适配[墨墨记忆卡制卡语法](https://tutuji333.github.io/markji-faq/questions/content/card-syntax-guide/)的内容，支持语法检查、编辑、复制与批量管理。

- #### 🔊 **发音**：荷西日俄使用 iOS TTS；哈萨克语可接 Azure Speech；藏语支持自定义注音与个人录音。

- #### ✍️ **文字辅助**：俄语 / 哈萨克语手写体、俄语拉丁重音转写、哈萨克托特文算法转换。

- #### 🎚️ **个性化**：按语言指定模型、调整难度、修改选材提示词。

- #### ☁️ **数据**：IndexedDB 本地存储，可选阿里云 OSS 多设备同步与 JSON 备份。



<a id="configure"></a>

---

## 🚀 初始配置

### 1. 配置 OpenAI

进入 **设置**：

1. 在 [OpenAI Platform](https://openai.com/index/openai-api/) 创建 API Key，并填入 **OpenAI API Key**。
2. 选择默认模型；可按需要使用更便宜或更强的模型。
3. 点击 **保存设置**。
4. 点击 **测试 OpenAI 连接**。

*API Key 仅保存在本机，不经过额外服务器。

### 4. 配置各语言

- **难度**：每门语言可在 `-6 ~ +6` 间调整。
- **按语言指定模型**：可让低资源语言单独使用更强模型，其余语言继续跟随默认模型。
- **选材提示词**：可逐语言覆盖内置例句选材规则；留空即使用默认规则。
- **安多藏语注音**：可在设置中插入模板并改成自己的注音体系；之后可在词卡中手动修正注音并录制个人发音。
  如果你对安多藏语有兴趣，欢迎[联系作者](petra.hanyu.shi@outlook.com)交流学习。
- **西里尔手写体**：俄语 / 哈萨克语默认可显示手写体，需要时可关闭。

### 5. 配置语音

**荷兰语 / 西班牙语 / 日语 / 俄语**：无需额外 API。

建议在 iPhone 中进入：**设置 → 辅助功能 → 朗读内容 → 声音**

下载对应语言的“增强”或“优质”音色。

**⚠️哈萨克语 🇰🇿（可选）**

不配置 Azure 时可回退到 OpenAI 语音；若需要 `kk-KZ-AigulNeural`：

1. 登录 [Azure Portal](https://portal.azure.com/?icid=portal#home)。
2. 在顶部搜索创建 **Speech services** 资源。
3. 区域任选，只要支持哈萨克语音，定价层选择 **Free F0**。
4. 在资源的 **密钥和终结点** 中复制 **Key 1** 和区域。
5. 在 Yulengua 中填写：
   - **Azure Speech Key**
   - **Region**，例如 `westeurope`
6. 点击 **测试哈萨克语语音**。

> 必须使用 Speech services 的 Key；Azure AI services / Azure OpenAI 的 Key 不能替代。

### 6. 数据与备份

默认使用 **IndexedDB** 保存本机数据。

⚠️ **删除 iPhone 主屏幕上的 Web App，或清除 Safari 网站数据，可能同时删除本地学习数据。**

因此建议首次配置完成后：

1. 进入 **设置 → 备份**。
2. 点击 **导出备份文件**，保存 JSON 到“文件”或 iCloud。
3. 妥善保管：备份中包含明文 API Key。

如需多设备同步，可额外配置 [**阿里云 OSS**](https://oss.console.aliyun.com/)：

- Endpoint：例如 `oss-eu-central-1.aliyuncs.com`
- Bucket：例如 `yulengua`
- AccessKey ID / Secret：使用 RAM 子用户凭据
- 按《OSS 配置指引》提前完成 Bucket、CORS 与 RAM 权限配置
- 在 App 中开启 **云端同步** 并执行连接测试

OpenAI / Azure / OSS 的 Key 不上传云端；OSS 主要同步学习数据与藏语录音。



<a id="author"></a>

---

## 🧑‍💻 Author

Yulengua 里有一些功能，最初只是因为我苦寻不到合适的现成工具，最后只好自己做。

比如老哈萨克文，也就是托特文 [Töte jazu]。现在大多数哈萨克语学习资料都以哈萨克斯坦使用的西里尔哈萨克文为主。虽然托特文和西里尔文之间的转换本身并不复杂，我却一直没找到一个真正把两套文字并排展示、方便同时学习的 App，于是就把这个功能做进了 Yulengua。

西里尔手写体也是类似。学过西里尔字母的人都知道，**认识印刷体并不等于认识手写体**，但大多数学习 App 只展示印刷体，所以我希望至少在自己的工具里，可以把两套字形直接对照起来。

另一个我很在意的功能，是**按语言选择不同模型**。像西班牙语这类语料丰富、标准化程度高的语言，较便宜的模型已经足够完成大多数任务；但托特文、藏文这类训练数据少、变体又多的语言，昂贵的模型下准确度的提升非常明显明显。以我自己的体验来说，如果希望对藏文进行相对可靠的翻译、解释和分析，在 OpenAI 系列中至少需要 GPT-5.3 这一档，而其他语言则可以用早期模型省预算。

最后还有一个没有解决的遗憾：**藏语语音**。我实在没能找到一个支持安多方言 [Amdo Tibetan]、同时准确度又足以用于学习的语音 API。这也正常，因为即使都被称为安多藏语，夏河／拉卜楞、果洛、阿坝之间的实际发音也可能千差万别，很难用一个“标准音色”覆盖。

安多藏语很美。它保留了很多古老的语言特征，而安多本身也是一个广袤美丽的文化区域。如果会读这种文字、会说这些地方语言的人越来越少，会是一件很可惜的事。只是从现实的商业逻辑来看，建设一个高质量、覆盖多种安多方言的大模型，短期内很难有明确收益。

所以这部分目前只能先留作一个没有完成的功能。也希望未来某一天，真的能看到一个足够好的藏语多方言语言与语音模型出现。

**Maybe one day.**
