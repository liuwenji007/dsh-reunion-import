# 重逢 · 3 步接着聊（普通用户）

装好 **dsh-go / DSH** 并启用本插件后，用下面最短路径即可。默认是**轻量续写**（核心记忆 + 近期约 3.7k 字），不是把整段历史搬进侧栏。重要的事会留在核心记忆里；细节一时想不起来可以让助手回想（`reunion_recall`）。这不是无损无限对话：新聊太长仍会占上下文，全文只在本地存档里。回想写入磁盘后，要重新装载才会进入常驻段落。

更完整的说明见 [README.zh.md](../README.zh.md)。

## 推荐：分享链接（手机最省事）

1. 打开 DeepSeek App/网页里的那段对话 → **分享** → 复制链接  
   （只要 `https://chat.deepseek.com/share/…`，不要用图片分享。）
2. 在 dsh-go **当前会话**里发一句：

   > 用重逢接着聊：`https://chat.deepseek.com/share/你的id`

3. 等助手调用 `reunion_continue` 完成后，**直接说下一句**（例如「我们接着上次的说」）。

不要拆成「先 import 再 load」；一条 `reunion_continue` 就够。

## 备选：导出 zip

1. DeepSeek：**设置 → 数据管理 → 导出所有历史对话**，得到 zip。
2. 把 zip 放到电脑上的路径（本机路径，不是网盘分享页）。
3. 若导出里**只有一个**你要续的会话，直接说：

   > 用重逢接着聊这个导出：`/你的路径/export.zip`

4. 若有**多个**会话，先说：

   > 帮我看看这个导出里有什么：`/你的路径/export.zip`

   再指定 id：

   > 用重逢接着聊这个导出：`/你的路径/export.zip`（会话 `demo-thread`）

仓库自带演示目录（无需真实数据）：

```sh
node bin/reunion.mjs inspect examples/demo-export
node bin/reunion.mjs import examples/demo-export --mode thread \
  --sessions demo-thread --name 论文选题
```

## 常见失败

| 现象 | 怎么办 |
| --- | --- |
| 提示链接无效 / 原会话已删 | 在 DeepSeek 重新点分享，或改用 zip |
| 快照里没有可导入消息 | 换一条有正文的对话再分享 |
| zip 说有多个会话要选 | 先 inspect，把会话 id 传给 continue |
| 路径找不到 | 确认是本机绝对/相对路径；分享请贴链接，不要当文件名 |

## 验收清单（给作者 / 安装者）

- [ ] 插件页标题/描述提到「一句话接着聊」或 `reunion_continue`
- [ ] 按上文口令，分享路径在文档上可复现（真实链接需本机网络）
- [ ] `node bin/reunion.mjs inspect examples/demo-export` 能列出 2 个会话
- [ ] `node --test` 全绿
- [ ] 多会话未选 id 时，错误会提示选一个会话（人话）

## 不要用本路径的时候

- 要在侧栏看到**完整历史气泡** → 用 DeepSeek Chat Import（或同类 Session 导入），不是重逢。
- 要带走**可移植人格**（口吻 + 关系记忆）→ 见 README 里的 `merge` / `separate`（进阶）。
