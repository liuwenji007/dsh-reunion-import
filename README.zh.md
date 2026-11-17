# 重逢 · 轻量续写与人格还原

**装完就能用。** 把 DeepSeek **分享链接**（推荐）或导出 **zip** 贴进 dsh-go，一句话接着聊——默认只注入约 **3.5k 字**续写包，不把全文反复灌进上下文。

最短步骤（小红书 / 普通用户）见 **[docs/QUICKSTART.zh.md](docs/QUICKSTART.zh.md)**。

## 装完就能用（3 步）

1. 手机 DeepSeek：打开会话 → **分享** → 复制 `https://chat.deepseek.com/share/…`（不要图片分享）。
2. 在当前会话发：

   > 用重逢接着聊：`https://chat.deepseek.com/share/xxxx`

3. 助手应调用 **`reunion_continue`**（导入 + 装载一次完成）。然后**直接说下一句**。

zip 备选：

> 用重逢接着聊这个导出：`/path/to/export.zip`（多会话时先「帮我看看这个导出」再带上会话 id）

不要拆成 import + load。完整气泡请用 Session 导入插件；人格蒸馏见下文进阶。

## 上下文与费用（怎么讲才准确）

`thread` 默认把约 **3.5k 字**（大约两千多 tokens）的续写包注入会话；完整 Session
导入则会把原对话尽量带进上下文。量上差的是「每轮重复携带的背景」：

| 原对话大约 | 全文背景（约） | 重逢背景（约） | 每轮少带的量级 |
| --- | --- | --- | --- |
| 3 万字 | ~2 万 tokens | ~0.3 万 | 少一个数量级里偏小的那种 |
| 10 万字 | ~6 万 | ~0.3 万 | 大约少 **20×** 量级的背景 |
| 30 万字 | ~19 万 | ~0.3 万 | 背景可少到接近 **1/60** |

用官方 API 时：**token 量差很大；账单差价还取决于缓存是否命中、Flash/Pro、是否思考模式。**
空闲时段、前缀缓存命中时，一晚上的**价差**往往只有几分到一块出头；多次未命中或
Pro + 超长时，差价才会明显到「几块～几十块」。不要承诺固定省多少钱——承诺「少灌全文」更稳。
价格以 [DeepSeek 模型与价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing) 为准。

## 进阶：先选对工具（Session 导入 vs 重逢）

官网/App 提示「不活跃长对话不能继续」时，记录通常还在，只是续不上。接到 DSH / dsh-go
**不只有重逢一条路**：

| 你要什么 | 用什么 | 得到什么 |
| --- | --- | --- |
| 侧栏里看到**完整历史气泡**，像原对话一样往下接 | DSH 的 DeepSeek Chat Import（或社区 Session 导入插件） | 每个官网会话 → 一个可续写的 DSH Session |
| **少占上下文**，只要接得上题 + 语气还在 | 重逢 `thread` / `reunion_continue` | `THREAD.md` 续写包（约 3.5k 字）注入当前会话 |
| 带走**可移植人格**（口吻 + 关系记忆），换会话还能 load | 重逢 `merge` / `separate` | `SOUL.md` + `MEMORY.md` + 磁盘存档 |

重逢**不是**第二个「把聊天搬进侧栏」的导入器；它做的是蒸馏与轻量续写。

重逢是一个 Host-only 的 DSH bundle：不加聊天面板、不改界面，只加十二个工具，以及一个可选的
「按会话注入人格/线程段落」。

- **上下文带走。** 导出文件只在本地读取，归一化成 `companions/<slug>/transcript.jsonl`；
  原始导出文件永远不会被修改。
- **蒸馏，不是灌原文。** `SOUL.md`（口吻规则 + 5–10 条逐字原句）与 `MEMORY.md`（关系记忆，
  有硬预算）来自一份「可测量的证据」摘要，而不是把 transcript 塞进提示词。
- **三种形态，不是一种。** 大多数导出都是一次性问答。重逢提供 `thread`（单会话 → 续聊
  摘要，不抽人格）、`merge`（多个会话 → 一个人格）、`separate`（每个会话一个人格）。
- **接着聊。** `reunion_load` 只把摘要或 `SOUL.md` + `MEMORY.md` 注入当前会话；
  `mode: "skill"` 还会写一个工作区技能，之后的任何会话都能装载。
- **本地、可删。** 全是纯文本文件；没有遥测、不抓页面、不逆向接口。平常只读本地导出；
  **唯一例外**：当你传入 DeepSeek 公开分享链接时，会请求 `chat.deepseek.com` 拉快照。
  删人格就删干净；卸载插件不会删数据。

## 导入前先选形态

大多数导出一大半是一次性问题。重逢不会强行给所有会话抽人格：`inspect` 和 `read`
先确认，`thread` 只续聊，只有 `merge` 才做人格式蒸馏。

| 形态 | `mode` | 产物 | 适合 |
| --- | --- | --- | --- |
| 继续一个线程 | `thread` | `transcript.jsonl` + `THREAD.md`（事实 + 口吻原句 + 最近几轮；默认约 3.5k 字） | 要省上下文的续写；要完整气泡请用 Session 导入插件 |
| 同一人物、多个线程 | `merge` | `SOUL.md` + `MEMORY.md` + 存档 | 同一个 AI 角色分散在多个对话里 |
| 还原官网的线程 | `separate` | 每个会话一个目录 | 每个会话各自独立、各自装载 |

`thread` 是确定性的，不调用模型；`merge` 才有 digest → 预览 → 确认 → commit 的人格流程。

## 安装

这个包是一个本地 bundle 目录。在 DSH 里打开 **插件** → **添加插件** 选这个目录，或用
DSH 的插件管理器从命令行安装。安装后插件页会出现 **重逢 · 对话导入与人格还原**，默认启用。

需要 DSH `0.2.x`；CLI 与测试需要 Node 22+。

## 使用

仓库里有一份完全虚构的演示导出 [`examples/demo-export`](examples/demo-export)（一段 8 条消息的陪伴对话、
一段 10 条消息的论文选题对话）；CLI 一节的演示命令可以直接拿它跑，不必碰你的真实数据。

1. **拿到导出，或一条分享链接。**
   - 全量：DeepSeek **设置 → 数据管理 → 导出所有历史对话**（zip）。
   - 手机更省事：在 DeepSeek App/网页对**单个会话**点「分享」，复制
     `https://chat.deepseek.com/share/…` 链接（不要用图片分享）。
2. **先看清楚。** 对助手说：

   > 帮我看看这个导出里有什么：`/path/to/export.zip`

   或：

   > 帮我看看这个分享：`https://chat.deepseek.com/share/xxxx`

   它会调用 `reunion_inspect`：不写任何文件，输出结构、会话数与消息数、每个字段的含义、
   首尾消息预览，以及所有没认出来的字段。分享链接会联网拉取公开快照。
3. **决定「线程 → 人格」怎么对应。**

   导出里每个会话本来就是独立的，和官网列表一致。可以保留这种形态，也可以有意归并：

   > 每个会话各自导入成独立人格。（`mode: "separate"`）

   > 把会话 c1、c2 导入成「小满」这个人格。（`mode: "merge"`，默认）

   > 继续会话 c1，从上次停下的地方接着聊。（`mode: "thread"`）

   > 用这条分享链接 thread 导入，接着聊。（分享链接默认就是 `thread`）

   thread 模式写完 `THREAD.md` 就结束：没有人格预览、不需要确认；`reunion_load` 直接把
   摘要装进会话。

   merge 模式在导出包含多个会话、又没指定 id（`sessions`）时会拒绝合并，除非显式
   `all: true`，避免把不同人物误合并。separate 模式按会话标题各自建人格；之后仍可以挑其中
   几个用 sessions 再合并。两种模式都按内容 + 时间戳去重并记录来源文件哈希，同一份文件重复
   导入不会产生重复消息。
4. **蒸馏。** `reunion_digest` 给出口吻证据、逐字原句候选、用户自述（记忆原料）、共有词、
   时间线与低置信度项。助手据此写 `SOUL.md` 与 `MEMORY.md`——不是抄 transcript。
5. **预览、确认。** `reunion_compose` 校验草稿，展示 5 条口吻特征、3 条记忆条目、3 句新写的
   示例回复。用户说「像」之后，`reunion_commit` 才真正写入 `SOUL.md`、`MEMORY.md` 和
   `meta.json`。
6. **开始聊。** `reunion_load`（默认 `mode: "session"`）把人格段落注册到当前会话，然后直接说
   第一句，例如：

   > 我回来啦。

   `mode: "skill"` 会同时写 `.dsh/skills/reunion-<ascii-slug>/SKILL.md`，之后的会话可以按
   装载结果里给出的技能名调用它。

`reunion_list` 列人格；`reunion_unload` 只把人格从当前会话退出（不动文件）；
`reunion_delete`（`confirm: true`）彻底删除人格。

### 命令行（不需要模型）

```sh
node bin/reunion.mjs inspect examples/demo-export
node bin/reunion.mjs import examples/demo-export --mode thread \
  --sessions demo-thread --name 论文选题
node bin/reunion.mjs inspect https://chat.deepseek.com/share/<share_id>
node bin/reunion.mjs import https://chat.deepseek.com/share/<share_id> --mode thread
node bin/reunion.mjs inspect /path/to/export.zip --query 论文选题 --sort span
node bin/reunion.mjs read /path/to/export.zip --session c1 --offset 0 --limit 20
node bin/reunion.mjs import /path/to/export.zip --name 小满 \
  --sessions c1,c2 --companions companions
node bin/reunion.mjs import /path/to/export.zip --mode thread \
  --sessions c1 --name 论文选题
node bin/reunion.mjs import /path/to/export.zip --mode separate
node bin/reunion.mjs list
node bin/reunion.mjs delete 小满 --yes
```

`inspect` 不写任何文件；`import` / `list` / `delete` 与工具共用同一份库代码，产物完全一致。

## 隔离：装载人格到底影响什么

- **不主动装载就不影响任何会话。** 导入只是在磁盘写文件；DSH 不会自动读取
  `companions/`，原有会话和新会话的行为与之前完全一样。
- **人格只属于一个会话。** `reunion_load` 通过该会话的 agent 上下文注册段落；其他会话、子代理、
  定时任务、之后新建的会话都不会继承。`reunion_unload` 可以随时退出；换一个人格会替换上一个。
- **它不写进会话日志。** 重启 DSH、恢复该会话、fork，或新建会话后都需要重新 `reunion_load`
  （或改用生成的技能）；这样人格不会渗到之后的工作里。
- **段落是装载时的快照。** 取的是当时的 SOUL.md 与 MEMORY.md；之后再 `reunion_commit`
  不会改变已装载的会话，需要重新 load。在 DSH 里的对话也不会自动写回 MEMORY.md。
- **会话已有历史时人格会作用于整段对话。** 在已经聊了很久的会话里装载，之后的回答（包括对早期
  内容的回应）都会用这个口吻。想干净开始，请在新会话里装载。
- **`mode: "skill"` 是唯一工作区级的影响面。** 它会在 `.dsh/skills/` 写一个技能；同工作区的
  每个会话都能在技能目录里看到一行摘要，但 SOUL/MEMORY 正文只在该技能被调用时加载。删除人格会
  一并删除技能。
- **隔离说的是上下文，不是文件权限。** 人格文件就是普通文件；如果你明确要求，任何会话都可以读它。
- **transcript 永远不进上下文。** 装载后的会话只看到线程摘要，或 SOUL.md + MEMORY.md；
  而且都要先 `reunion_load`。
- **线程的作用域也一样。** 摘要只是当前会话的提示段落；其他会话和之后的新会话需要重新装载。

## 数据位置与删除

```
companions/<slug>/
  SOUL.md            仅人格：口吻与人格约束 + 逐字原句锚点
  MEMORY.md          仅人格：关系记忆（有预算，含低置信度分节）
  THREAD.md          仅线程：事实性续聊摘要
  transcript.jsonl   完整存档，每行 { role, content, ts, turn }
  meta.json          kind（persona|thread）、来源、SHA-256、消息数、时间范围、预算
```

- 目录可配置：`config.companionsDir`（默认 `companions`，相对会话工作目录，也可写绝对路径）。
- 归并后线程边界仍然保留：`meta.json` 里每个来源会话都记录它在合并后的 `transcript.jsonl`
  中占用的 `turnFrom`/`turnTo` 范围，能反查某条消息原本属于哪个线程。
- separate 模式每个会话一个目录；同一份导出重复导入会报告「已存在」，不会重复合并。
- thread 模式的 `meta.kind` 是 `thread`：不写 SOUL/MEMORY，也不适用人格工具；
  `reunion_digest`/`reunion_compose`/`reunion_commit` 会拒绝它，直接 `reunion_load` 即可。
- 删除：`reunion_delete` 带 `confirm: true`，或
  `node bin/reunion.mjs delete <slug> --yes`。会删掉整个目录（四个文件）和生成的技能，并从
  所有会话卸载人格；没有别的地方引用这些数据。
- 原始导出文件从未被写入。
- 卸载插件后 `companions/` 仍然在；要删就手动删或先用 CLI 删。

## 隐私

- 全程在本机进程内处理；插件不发任何网络请求，唯一的模型流量就是会话本身。
- 没有遥测、统计或后台任务。
- 文件就是 UTF-8 文本和 JSON；`meta.json` 记录每个来源导出的哈希。
- 默认情况下 transcript 不进入模型上下文；只有 `reunion_load` 之后，`SOUL.md` 与
  `MEMORY.md` 会进入会话。

## 边界（必读）

- **格式支持。** 读取器按 DeepSeek `export_format_version: 3` 的压缩包编写；其他 JSON /
  JSON Lines 走通用 `role`/`content` 推断。`inspect` 一定会报告认出了什么、没认出什么。
- **服务端已删除的对话救不回来。** 如果 DeepSeek 已经清除了某个会话，导出里就不会有它。
  重逢只能保存你手里的、并保护以后产生的；它不声称知道 DeepSeek 的保留策略。
- **不抓取、不登录、不碰接口。** 只读你给它的文件。
- **每个会话只导入一条分支。** 当时屏幕上的分支（`current_message_id`）会导入；重新生成的
  其它分支只在 `meta.json` 里计数，不存档。
- **导出是一组相互独立的会话。** 官网如此，separate 模式也如此；merge 只是「同一个人物分散在
  多个线程」时的显式选择，多会话导出不会被默认合并。
- **不做多模态。** 图片、文件、思考（`THINK`）、提示、工具片段都不进入 transcript；
  被内容过滤撤回的问答对会整对跳过，与当时看到的对话一致。
- **不做「复活已故者」之类引导。** 人格就是你实际聊过的那个 AI 角色。
- **蒸馏质量受证据限制。** 存档小，原句锚点就少，低置信度项就多；预览就是让你否掉「不像」的稿子。
- **线程摘要是确定性的。** 它抽取「决定/待办」、挑几句口吻原句、再带最近几轮；是一张续聊地图，
  不是模型写的总结。漏了什么，transcript 还在磁盘上。

## 配置

在 bundle 的配置行（或 profile patch）里改。默认值：

| 键 | 默认 | 含义 |
| --- | --- | --- |
| `companionsDir` | `companions` | 人格目录位置，相对工作区或绝对路径。 |
| `skillsDir` | `.dsh/skills` | `mode: "skill"` 生成技能的目录。 |
| `locale` | `auto` | `auto` / `zh` / `en`；`auto` 依次看 Host locale 偏好、环境变量、调用文本。 |
| `maxMemoryChars` | `8000` | `MEMORY.md` 硬预算，按非空白字符计数。 |
| `fewShotMin` / `fewShotMax` | `5` / `10` | 逐字原句数量范围。 |
| `digestMaxChars` | `12000` | 返回给模型的摘要上限。 |
| `maxEntryBytes` | 64 MiB | 单个压缩包条目读入内存的上限。 |
| `maxJsonBytes` | 128 MiB | 一次性解析的 JSON 上限。 |
| `maxMessages` | `300000` | 存档消息数上限。 |
| `maxSearchChars` | 16 M | 校验时索引的存档字符数。 |
| `maxInspectSessions` | `1000` | `inspect` 最多读多少会话，超出标注「部分」。 |
| `threadBriefChars` | `2500` | `THREAD.md`（近期续写）字符预算。与 CORE 一起常驻，合计略多于旧的单层 3500。 |
| `coreChars` | `1200` | `CORE.md` 硬约定预算。回想摘录超出时先丢最旧的回想。 |
| `recallEnabled` | `true` | 是否允许 `reunion_recall` 查存档。 |
| `recallAutoPin` | `true` | thread 回想命中后是否静默写入 `CORE.md`。 |
| `recallMaxHits` | `5` | 单次回想最多返回几条。 |
| `recallMaxChars` | `2000` | 单次回想返回的总字符预算。 |
| `verbatimWindow` | `24` | 检测 SOUL 复述原文的窗口长度。 |
| `previewChars` | `160` | inspect 里单条预览长度。 |
| `reportMaxChars` | `12000` | inspect 报告上限。 |
| `draftTtlMs` | 1 小时 | 未确认草稿的有效期。 |

## 测试

```sh
node --test
```

覆盖 ZIP 读取（stored / deflate / ZIP64 / 损坏）、流式 JSON 遍历（分块边界、超大数组、深度
限制）、DeepSeek 分支选择与片段提取、导入幂等与多会话归并、固定 transcript 上的蒸馏摘要，
以及包括反复述在内的全部校验规则。全部测试不调用模型。

## 目录

```
index.js              Host 插件：十二个工具 + 按会话的人格/线程段落
lib/config.mjs        可调参数、默认值、类型校验
lib/i18n.mjs          中英结果文案与 locale 解析
lib/source.mjs        输入识别，ZIP/目录/JSON/JSONL 打开
lib/zip.mjs           只读 ZIP 读取器（无依赖）
lib/json-stream.mjs   增量 JSON 遍历
lib/deepseek.mjs      导出 v3 解析、分支选择、消息归一化
lib/generic.mjs       未知格式推断
lib/probe.mjs         inspect 报告
lib/import.mjs        导入、归并、meta.json
lib/transcript.mjs    JSONL 存档、指纹、流式归并
lib/digest.mjs        确定性蒸馏摘要
lib/validate.mjs      草稿校验与反复述守卫
lib/store.mjs         人格目录、技能、删除
lib/render.mjs        SOUL/MEMORY 生成与结果渲染
bin/reunion.mjs       CLI：inspect、import、list、delete
docs/DETAIL.md        插件页图片
```
