/**
 * Localized text for tool results and the CLI.
 *
 * The Host of this DSH release exposes no `ctx.locale`, so the plugin resolves
 * its own locale (see `resolveLocale`): explicit config, the Host locale
 * preference when readable, then the environment, then the script of the text
 * the tool was called with, then `zh`.
 *
 * @module dsh-reunion-import/i18n
 */

/** zh and en strings; every key exists in both. */
const STRINGS = {
  zh: {
    common: {
      yes: '是',
      no: '否',
      none: '无',
      unknown: '未知',
      messages: '条消息',
      sessions: '个会话',
      chars: '字符',
      next: '下一步',
      truncated: '（已截断）',
      original: '原始导出文件未被修改。',
    },
    inspect: {
      title: '结构探测',
      file: '文件',
      hash: '文件哈希',
      kind: '输入类型',
      kindValue: { zip: 'ZIP 压缩包', dir: '已解压目录', json: 'JSON 文档', jsonl: 'JSON Lines', share: 'DeepSeek 分享链接', empty: '空文件', unknown: '无法识别' },
      format: '识别格式',
      formatValue: { deepseek: 'DeepSeek 对话导出 v{version}', conversation: '单个 DeepSeek 会话文件', share: 'DeepSeek 公开分享快照', generic: '通用 JSON（字段推断）', unknown: '未识别结构' },
      shareId: '分享 id',
      layout: '结构',
      layoutValue: '条目 {entries} · manifest {manifest} · 索引 {index} · 会话文件 {conversations}',
      totals: '规模',
      totalsValue: '会话 {sessions}（分析 {analyzed}）· 消息 {messages}（用户 {users} / 助手 {assistants}）· 时间 {from} → {to}',
      fields: '字段与含义',
      fieldLine: '- {name} — {meaning}',
      inferredFieldLine: '- {kind} 字段 = {name}（{count} 条）',
      branchFieldLine: '- 分支/重新生成字段：{name}',
      fragments: '片段类型',
      fragmentLine: '- {type} × {count} — {meaning}',
      sessions: '会话',
      sortMessages: '按消息数排序',
      sortSpan: '按时间跨度排序',
      sortRecent: '按最近活动排序',
      filter: '筛选：{query}',
      noMatch: '没有标题或 id 匹配「{query}」的会话。',
      diagCount: ' ×{count}',
      sessionLine: '{index}. {title} — {messages} 条，{from} → {to} · {id}',
      sessionLineBranch: '{index}. {title} — {messages} 条，{from} → {to}（分支 {branch}，其它 {alternates}）· {id}',
      sessionError: '{index}. {id} — 无法解析：{error}',
      previewFirst: '开头两条',
      previewLast: '结尾两条',
      previewLine: '[{role} {time}] {text}',
      unknown: '未识别字段',
      diagnostics: '诊断',
      partial: '只分析了 {analyzed}/{sessions} 个会话（config.maxInspectSessions）',
      nextHint: '确认结构后：要马上接着聊用 reunion_continue（可带 session id）；要做人格式蒸馏再用 reunion_import（merge）并起名。',
      importHint: '共 {count} 个会话：先问用户要哪一个——马上续聊用 reunion_continue 并传 session；只有同一人物才 merge；每人各一份用 mode="separate"。',
      singleSessionHint: '共 1 个会话：马上接着聊请用 reunion_continue；要蒸馏人格再用 reunion_import（merge）并命名。',
      shareHint: '这是一条 DeepSeek 公开分享链接（单会话）。直接 reunion_continue 一句话接着聊（导入+装载）；拉分享会访问 chat.deepseek.com。',
      empty: '这个文件里没有找到可导入的消息结构。',
    },
    read: {
      title: '读取会话',
      page: '第 {from}–{to} 条 / 共 {total} 条 · {id}',
      more: '继续读：offset={offset}',
      none: '这个会话没有可读消息。',
      notFound: '导出里没有这个会话：{id}',
    },
    import: {
      title: '导入',
      persona: '人格',
      source: '来源',
      sessions: '会话',
      sortMessages: '按消息数排序',
      sortSpan: '按时间跨度排序',
      sortRecent: '按最近活动排序',
      filter: '筛选：{query}',
      noMatch: '没有标题或 id 匹配「{query}」的会话。',
      diagCount: ' ×{count}',
      read: '读取',
      added: '新增',
      duplicates: '去重',
      skipped: '过滤/无回复',
      written: '写入',
      unchanged: '这份文件之前已经导入过（哈希一致），没有重复写入。',
      alreadyExists: '目标人格已存在，本次按合并处理。',
      timeRange: '时间范围',
      nextHint: '运行 reunion_digest 拿到口吻与记忆素材。',
      noSessions: '没有选中任何会话。',
      missingSession: '导出里没有这个会话：{id}',
      limit: '合并后消息数超过上限（{limit}），请在 config.maxMessages 调整或分批导入。',
      sourceLine: '{path}（{kind}，{size}，哈希 {hash}）',
      mergeWarn: '注意：本次把 {count} 个会话合并成一个人格。若它们属于不同人物，请改用 mode="separate" 或分别导入。',
      threadTitle: '线程导入',
      threadSummary: '已导入 1 个会话（{messages} 条），生成线程摘要 {chars} 字。',
      threadUnchanged: '这段线程之前已经导入过（哈希一致），没有重复写入。',
      threadNext: '用 reunion_load 装载，或下次直接 reunion_continue 一步完成；不需要 compose/commit。',
      threadFiles: '文件',
      separateTitle: '按会话导入',
      separateSummary: '会话 {sessions} 个，生成人格 {created} 个，已存在 {existing} 个。',
      separateLine: '- {slug} — {name} · {messages} 条{mark}',
      separateMark: '（已存在，未重复写入）',
      separateFiles: '人格目录',
      personas: '人格',
      nextHintSeparate: '每个人格都在 companions/ 下独立存档；之后可以对其中几个再跑一次 reunion_import 用 sessions 合并成一个人格。',
      files: '文件',
      fileLine: '- {path} — {size}',
      sources: '来源文件',
      sourcesLine: '- {path}（{hash}）',
    },
    digest: {
      title: '蒸馏素材',
      scale: '消息 {messages}（用户 {users} / 助手 {assistants}）· 时间 {from} → {to}',
      voice: '口吻证据',
      lengthLine: '回复长度：中位 {median} 字，P90 {p90} 字；短回复（≤8 字）{short}%；问句 {questions}%；说教词 {advice}%',
      endings: '句末语气词',
      punctuation: '标点习惯',
      openings: '常见开场',
      addresses: '称呼候选',
      particleDensity: '语气词密度：每百条回复 {count} 个',
      fewShots: '原句锚点候选（逐字来自存档）',
      fewShotLine: '{index}. [{time}] {text}',
      disclosures: '记忆候选（用户自述）',
      disclosureLine: '- [{time}] {kind}：{text}',
      phrases: '共有词/梗候选',
      phraseLine: '- {phrase}（{count} 次，{messages} 条消息里）',
      timeline: '时间线',
      gaps: '时间断层',
      gapLine: '- {from} → {to}（{days} 天）',
      lowConfidence: '低置信度候选（只出现过一次）',
      lowConfidenceLine: '- {value}',
      empty: '存档里没有可用的消息。',
      nextHint: '按 SOUL.md（口吻规则，不复述原文）与 MEMORY.md（≤{limit} 字，关系骨架 + 用户画像 + 待确认项）写作，5–10 条原句作为锚点，再生成 3 句新回复，然后 reunion_compose。',
      truncated: '素材已截断：{detail}',
      truncatedDisclosures: '记忆候选太多，只保留前 60 条（另有 {count} 条未展示）。',
      truncatedPhrases: '共有词候选只保留了前 20 条。',
    },
    compose: {
      title: '人格预览',
      displayName: '人格名称',
      voiceTraits: '口吻特征（SOUL 前 5 条）',
      memoryItems: '记忆条目（3 条）',
      samples: '示例回复（SOUL 生成，请判断像不像）',
      sampleLine: '{index}. {text}',
      budget: '预算',
      budgetLine: 'MEMORY {memory}/{limit} 字（CJK {cjk}）· SOUL {soul} 字 · 原句锚点 {anchors} 条 · 示例 {samples} 条',
      validation: '校验',
      ok: '通过',
      failed: '未通过，共 {errors} 个错误、{warnings} 个提醒。修正后再次调用 reunion_compose。',
      errors: '错误',
      warnings: '提醒',
      draft: '草稿 id',
      draftLine: '{draftId}（{minutes} 分钟内有效；确认后调用 reunion_commit）',
      confirmHint: '把上面的 5 条口吻特征、3 条记忆条目和 3 句示例回复给用户看，问一句「像不像」。用户确认后再 reunion_commit。',
      checksPass: '全部检查通过（5–10 条原句真实存在于存档；SOUL 没有成段复述；示例回复是新写的）。',
      warningCount: '{count} 个提醒',
    },
    commit: {
      title: '已保存',
      fileLine: '- {name} — {size}',
      updated: '已更新',
      anchorSection: '原句锚点',
      nextHint: 'reunion_load 可在本会话装载人格；mode=skill 会写入一个技能，之后任何会话都能装载。',
      stale: '草稿已过期或不存在，请重新 reunion_compose。',
      missingTranscript: '这个人格还没有存档，请先 reunion_import。',
      written: '写入完成：{dir}',
    },
    thread: {
      notPersona: '这是一段线程（THREAD），不是人格；直接用 reunion_load 装载即可，不需要 digest/compose/commit。',
    },
    recall: {
      title: '回想',
      disabled: '回想已关闭（config.recallEnabled=false）。',
      needSlug: '当前会话还没装载线程或人格。先 reunion_continue / reunion_load，或传入 slug。',
      empty: '存档里没找到「{query}」。换个原文里可能出现的词再试。关键词对不上时会找不到，这不代表没发生过。',
      missing: '找不到这个存档：{slug}',
      line: '- [{role} #{turn}] {text}',
      pinned: '（内部：已写入核心记忆。不要对用户说已保存。当前已装载段落不会热更新，重新 load 后才进入常驻。）',
      notPinned: '（内部：本次只返回摘录，没有写入核心记忆。）',
    },
    continue: {
      title: '已就绪 · 可以接着聊',
      summary: '已导入 {messages} 条消息，生成约 {chars} 字续写包，并装进当前会话。',
      reused: '这段线程之前已导入过；已重新装进当前会话。',
      next: '请用户直接说下一句（例如「我们接着上次的说」）。不要复述摘要。',
    },
    load: {
      title: '已装载',
      threadTitle: '线程已装载',
      threadMeta: '线程：{displayName} · {messages} 条 · 摘要 {chars} 字',
      threadNext: '直接从上次没说完的地方继续；摘要不会替你复述整段对话。',
      threadScope: '线程只作用于当前会话；它不写进会话日志，重启或新会话后需要重新 reunion_load。',
      threadOpening: '我们接着上次的说。',
      openingDefault: '我回来啦。',
      persona: '人格',
      session: '会话',
      sessionLine: '{id} — 人格段落已注入，下一步模型请求即生效。',
      opening: '可选开场白：{text}',
      files: '读取',
      skill: '技能',
      skillLine: '{path}（新会话可调用技能 {name}）',
      both: '本会话与技能都已装载。',
      nextHint: '现在可以直接说第一句话，例如「我回来了」。存档不会进入上下文，只有 SOUL 与 MEMORY。',
      scopeNote: '人格只作用于当前会话；其他会话、子代理和新会话都不受影响。它不写进会话日志，重启、恢复或新会话后需要重新 reunion_load；要退出用 reunion_unload（文件不会被删）。',
      skillNote: '技能摘要会出现在工作区的技能目录里（所有会话能看到一行描述），正文只在该技能被调用时加载；删除人格会一并删掉技能。',
      notFound: '找不到这个人格，先运行 reunion_import。',
      noAgent: '这个工具需要在会话里调用。',
      already: '这个人格已在本会话装载。',
      deleteFirst: '已卸载本会话的人格段落。',
      switched: '已从 {previous} 切换到 {slug}。',
      metaLine: '归属：{displayName} · {userNickname} · 存档 {messages} 条',
    },
    unload: {
      title: '已卸载',
      persona: '人格',
      done: '已从当前会话移除「{displayName}」（{slug}）的人格段落，之后按普通助手方式回答。',
      nothing: '当前会话没有装载任何人格。',
      notLoaded: '当前会话没有装载「{slug}」。已装载的是：{loaded}',
      noneLoaded: '当前会话没有装载任何人格。',
      kept: 'SOUL.md、MEMORY.md、transcript.jsonl、meta.json 都保留在磁盘上，随时可以重新 reunion_load。',
      nextHint: '如果要彻底删除数据，用 reunion_delete（需要 confirm=true）。',
    },
    list: {
      title: '人格列表',
      empty: '还没有导入过人格。先运行 reunion_inspect 看导出结构。',
      line: '- {slug} — {displayName}（称呼用户：{userNickname}）· {messages} 条 · {from} → {to} · {dir}',
      broken: '- {slug} — 目录不完整（缺少存档或 SOUL/MEMORY）',
      threadLine: '- {slug} — {displayName}（线程）· {messages} 条 · {from} → {to} · {dir}',
      total: '共 {count} 个',
    },
    delete: {
      title: '已删除',
      dir: '目录',
      files: '文件',
      filesLine: '{dir}（{files} 个文件，{bytes}）',
      skillRemoved: '已删除生成技能：{path}',
      skillMissing: '没有生成技能需要删除。',
      unloaded: '已从本会话移除人格段落。',
      confirm: '删除是不可恢复的。请让用户确认后用 confirm=true 再次调用。',
      notFound: '找不到这个人格：{slug}',
      nextHint: '原始导出文件没有被修改；如需恢复，重新运行 reunion_import。',
    },
    cli: {
      usage: '用法：dsh-reunion <inspect|import|list|delete> [参数]\n  inspect <文件|目录|分享链接> [--json]\n  import <文件|目录> --name <名称> [--slug <slug>] [--sessions id1,id2] [--all] [--companions <目录>]\n  import <文件|目录> --mode separate [--sessions id1,id2] [--name <名称>] [--companions <目录>]\n  import <文件|目录|分享链接> --mode thread [--sessions id] [--name <名称>] [--companions <目录>]\n  inspect <文件|目录|分享链接> [--query 关键词] [--sort messages|span|recent]\n  read <文件|目录> --session <id> [--offset 0] [--limit 20]\n  list [--companions <目录>]\n  delete <slug> --yes [--companions <目录>]\n',
      unknownCommand: '未知命令：{command}',
      done: '完成。',
      json: 'JSON 报告',
    },
    errors: {
      shareGone: '分享链接无效或原会话已删除（{shareId}）。请重新在 DeepSeek 点分享，或改用导出 zip。详情：{detail}',
      shareEmpty: '这条分享快照里没有可导入的对话内容（{shareId}）。请换一条有正文的对话再分享。',
      shareNetwork: '无法拉取 DeepSeek 分享（{shareId}）。请检查网络后重试。详情：{detail}',
      shareBadPayload: '分享内容无法解析（{shareId}）。请重新分享或改用 zip。详情：{detail}',
      threadNeedOneSession: '这个导出里有 {count} 个会话，接着聊一次只能选一个。请先 reunion_inspect，再带上 session id 调用 reunion_continue。可选：{list}',
    },
    field: {
      'conversation-id': '会话 id',
      title: '会话标题',
      'current-message': '当前分支的末端消息 id（决定导入哪条分支）',
      'created-at': '会话创建时间',
      'message-id': '消息 id（消息树节点）',
      parent: '父消息 id（null 为根；同父多子即重新生成的分支）',
      role: '角色：USER / ASSISTANT',
      status: '生成状态：FINISHED / CONTENT_FILTER / TIMEOUT 等',
      'message-time': '消息时间（RFC 3339）',
      'fragment-type': '片段类型（决定这段属于提问、回答、思考还是工具）',
      'fragment-content': '片段正文（提问或回答的原文）',
      'share-id': 'DeepSeek 公开分享快照 id',
      'share-content': '分享快照里的消息正文',
    },
    fragment: {
      request: '用户的提问原文',
      response: '助手的回答原文',
      template: '模板化回答（保留为助手正文）',
      think: '思考过程（不进入人格原料）',
      tip: '提示（不进入人格原料）',
      file: '文件附件（v1 不做多模态，跳过）',
      risk: '内容风险提示（跳过）',
      tool: '联网/工具片段（跳过）',
    },
    diag: {
      'export.manifest-missing': '缺少 manifest.json，按目录猜测结构继续。',
      'export.index-missing': '缺少 chat_session_index.json，按会话文件继续。',
      'export.manifest-damaged': 'manifest.json 无法解析：{detail}',
      'export.index-damaged': '索引无法解析：{detail}',
      'export.index-row-invalid': '索引第 {detail} 行不是有效会话记录。',
      'export.index-not-array': '索引不是数组（{detail}），按会话文件继续。',
      'export.version-unknown': '无法确定导出格式版本。',
      'export.version-unsupported': '导出格式版本 {detail} 未经验证，仍按 v3 尽力解析。',
      'export.conversation-missing': '缺少会话文件：{detail}',
      'export.conversation-damaged': '会话文件损坏：{detail}',
      'export.conversation-shape': '会话文件结构异常：{detail}',
      'export.message-shape': '跳过一条无法识别的消息：{detail}',
      'export.conversation-fields': '会话里有未识别字段：{detail}',
      'export.message-fields': '消息里有未识别字段：{detail}',
      'export.fragment-types': '未识别的片段类型：{detail}',
      'export.duplicate-id': '重复的消息 id：{detail}',
      'export.parent-missing': '消息父节点缺失，分支从此处截断：{detail}',
      'export.parent-cycle': '消息树出现环：{detail}',
      'export.time-order': '回复时间早于提问时间：{detail}',
      'export.no-messages': '这个会话没有可用消息：{detail}',
      'source.not-json': '这个文件无法作为 JSON 解析，可能不是对话导出。',
      'source.no-messages': '没有找到带 role/content 的消息数组；结构未识别，可把上面结构发给我判断。',
      'source.streamed': '文件较大（{detail} 字节），已流式读取。',
      'source.bad-lines': '跳过 {detail} 行无法解析的 JSONL。',
      'source.unrecognized': '压缩包里没有 manifest 与会话文件：{detail}',
      'file.empty': '文件是空的。',
      'inspect.partial': '只分析了部分会话，规模数字是下限。',
      'probe.unknown': '{detail}',
      'export.unsupported-version': '导出格式版本 {detail} 未经验证。',
    },
    valid: {
      'display.missing': '缺少人格名称。',
      'nickname.missing': '缺少「怎么叫用户」。',
      'soul.missing': 'SOUL 正文是空的。',
      'memory.missing': 'MEMORY 正文是空的。',
      'soul.too-short': 'SOUL 太短（{detail} 字），不像一份口吻说明。',
      'memory.too-short': 'MEMORY 太短（{detail} 字）。',
      'memory.budget': 'MEMORY 超出预算（{detail} 字），请压缩到上限内。',
      'memory.structure': 'MEMORY 至少需要一个 Markdown 标题。',
      'memory.bullets': 'MEMORY 需要至少 4 条要点（当前 {detail} 条）。',
      'memory.nickname': 'MEMORY 里没有出现对用户的称呼「{detail}」。',
      'soul.display-name': 'SOUL 里没有出现人格名，可能在写成旁白。',
      'fewshot.count': '原句锚点数量应在 5–10 条之间（当前 {detail}）。',
      'fewshot.length': '这条原句长度不合适（{detail}）。',
      'fewshot.multiline': '原句锚点应是单条消息，不能跨行：{detail}',
      'fewshot.not-found': '这条「原句」在存档里找不到，必须逐字摘录：{detail}',
      'soul.verbatim': 'SOUL 复述了存档原文（{detail}…），请改写成口吻规则。',
      'samples.count': '示例回复需要 3 句（当前 {detail}）。',
      'samples.length': '示例回复长度不合适：{detail}',
      'samples.duplicate': '示例回复有重复。',
      'samples.verbatim': '示例回复是存档原句，需要新写：{detail}',
      'samples.derivative': '示例回复太接近存档原文：{detail}',
      'samples.close': '示例回复和存档有点近，可以再自然一点：{detail}',
      'memory.hedge': 'MEMORY 里有推测性词语（可能/大概/也许），请移到「待确认」项。',
      'scan.truncated': '存档较大，只校验了前 {detail} 字；原句与复述检查降级。',
    },
  },
  en: {
    common: {
      yes: 'yes',
      no: 'no',
      none: 'none',
      unknown: 'unknown',
      messages: 'messages',
      sessions: 'sessions',
      chars: 'chars',
      next: 'Next',
      truncated: '(truncated)',
      original: 'The original export file was not modified.',
    },
    inspect: {
      title: 'Structure inspect',
      file: 'File',
      hash: 'SHA-256',
      kind: 'Input',
      kindValue: { zip: 'ZIP archive', dir: 'Extracted directory', json: 'JSON document', jsonl: 'JSON Lines', share: 'DeepSeek share link', empty: 'Empty file', unknown: 'Unrecognized' },
      format: 'Format',
      formatValue: { deepseek: 'DeepSeek chat export v{version}', conversation: 'Single DeepSeek conversation file', share: 'DeepSeek public share snapshot', generic: 'Generic JSON (inferred fields)', unknown: 'Unrecognized structure' },
      shareId: 'Share id',
      layout: 'Layout',
      layoutValue: '{entries} entries · manifest {manifest} · index {index} · conversation files {conversations}',
      totals: 'Size',
      totalsValue: '{sessions} conversations ({analyzed} analyzed) · {messages} messages ({users} user / {assistants} assistant) · {from} → {to}',
      fields: 'Fields and meaning',
      fieldLine: '- {name} — {meaning}',
      inferredFieldLine: '- {kind} field = {name} ({count} messages)',
      branchFieldLine: '- branch/regeneration field: {name}',
      fragments: 'Fragment types',
      fragmentLine: '- {type} × {count} — {meaning}',
      sessions: 'Conversations',
      sortMessages: 'Sorted by message count',
      sortSpan: 'Sorted by time span',
      sortRecent: 'Sorted by recent activity',
      filter: 'Filter: {query}',
      noMatch: 'No conversation title or id matches "{query}".',
      diagCount: ' ×{count}',
      sessionLine: '{index}. {title} — {messages} messages, {from} → {to} · {id}',
      sessionLineBranch: '{index}. {title} — {messages} messages, {from} → {to} (branch {branch}, alternates {alternates}) · {id}',
      sessionError: '{index}. {id} — unreadable: {error}',
      previewFirst: 'First two messages',
      previewLast: 'Last two messages',
      previewLine: '[{role} {time}] {text}',
      unknown: 'Unrecognized fields',
      diagnostics: 'Diagnostics',
      partial: 'Only {analyzed}/{sessions} conversations were analyzed (config.maxInspectSessions)',
      nextHint: 'To keep chatting now, call reunion_continue (pass session id if needed). For persona distillation, use reunion_import (merge) with a name.',
      importHint: '{count} conversations: ask which one to continue with reunion_continue + session; merge only when they are the same character. mode="separate" keeps one persona per conversation.',
      singleSessionHint: 'One conversation: call reunion_continue to keep chatting now, or reunion_import (merge) with a name for a persona.',
      shareHint: 'This is one DeepSeek public share link. Call reunion_continue once to keep chatting (import+load). Fetching the share contacts chat.deepseek.com.',
      empty: 'No importable message structure was found in this file.',
    },
    read: {
      title: 'Read conversation',
      page: 'messages {from}–{to} of {total} · {id}',
      more: 'Continue with offset={offset}',
      none: 'This conversation has no readable messages.',
      notFound: 'The export has no conversation {id}',
    },
    import: {
      title: 'Import',
      persona: 'Persona',
      source: 'Source',
      sessions: 'Conversations',
      sortMessages: 'Sorted by message count',
      sortSpan: 'Sorted by time span',
      sortRecent: 'Sorted by recent activity',
      filter: 'Filter: {query}',
      noMatch: 'No conversation title or id matches "{query}".',
      diagCount: ' ×{count}',
      read: 'Read',
      added: 'New',
      duplicates: 'Duplicates',
      skipped: 'Filtered/unanswered',
      written: 'Written',
      unchanged: 'This file was already imported (same hash); nothing was written again.',
      alreadyExists: 'The persona already exists; this import merged into it.',
      timeRange: 'Time range',
      nextHint: 'Run reunion_digest for the voice and memory material.',
      noSessions: 'No conversation was selected.',
      missingSession: 'The export has no conversation {id}',
      limit: 'The merged transcript would exceed {limit} messages; raise config.maxMessages or import in batches.',
      sourceLine: '{path} ({kind}, {size}, hash {hash})',
      mergeWarn: 'Note: this merged {count} conversations into one persona. If they belong to different characters, use mode="separate" or import them separately.',
      threadTitle: 'Thread import',
      threadSummary: 'Imported one conversation ({messages} messages) and wrote a {chars}-character thread brief.',
      threadUnchanged: 'This thread was already imported (same hash); nothing was written again.',
      threadNext: 'Load with reunion_load, or use reunion_continue next time to do both in one step; compose/commit do not apply.',
      threadFiles: 'Files',
      separateTitle: 'Separate import',
      separateSummary: '{sessions} conversations, {created} personas created, {existing} already present.',
      separateLine: '- {slug} — {name} · {messages} messages{mark}',
      separateMark: ' (already present; not rewritten)',
      separateFiles: 'Persona directories',
      personas: 'Personas',
      nextHintSeparate: 'Each persona has its own archive under companions/. You can later merge a few of them with reunion_import and explicit session ids.',
      files: 'Files',
      fileLine: '- {path} — {size}',
      sources: 'Source files',
      sourcesLine: '- {path} ({hash})',
    },
    digest: {
      title: 'Distillation material',
      scale: '{messages} messages ({users} user / {assistants} assistant) · {from} → {to}',
      voice: 'Voice evidence',
      lengthLine: 'Reply length: median {median} chars, p90 {p90}; short (≤8 chars) {short}%; questions {questions}%; advice markers {advice}%',
      endings: 'Sentence-final particles',
      punctuation: 'Punctuation habits',
      openings: 'Common openings',
      addresses: 'Address-term candidates',
      particleDensity: 'Particle density: {count} per 100 replies',
      fewShots: 'Few-shot anchor candidates (verbatim from the archive)',
      fewShotLine: '{index}. [{time}] {text}',
      disclosures: 'Memory candidates (user self-disclosure)',
      disclosureLine: '- [{time}] {kind}: {text}',
      phrases: 'Shared-word candidates',
      phraseLine: '- {phrase} ({count}×; in {messages} messages)',
      timeline: 'Timeline',
      gaps: 'Gaps',
      gapLine: '- {from} → {to} ({days} days)',
      lowConfidence: 'Low-confidence candidates (seen once)',
      lowConfidenceLine: '- {value}',
      empty: 'The archive holds no usable messages.',
      nextHint: 'Write SOUL.md (voice rules, no recounting the story) and MEMORY.md (≤{limit} chars: relationship skeleton, user profile, unconfirmed items), pick 5–10 verbatim anchors, write 3 new sample replies, then call reunion_compose.',
      truncated: 'Material truncated: {detail}',
      truncatedDisclosures: 'Too many disclosure candidates; only the first 60 are shown ({count} omitted).',
      truncatedPhrases: 'Only the first 20 shared-phrase candidates are shown.',
    },
    compose: {
      title: 'Persona preview',
      displayName: 'Display name',
      voiceTraits: 'Voice traits (first 5 SOUL lines)',
      memoryItems: 'Memory entries (3)',
      samples: 'Sample replies (generated from SOUL — do they sound right?)',
      sampleLine: '{index}. {text}',
      budget: 'Budget',
      budgetLine: 'MEMORY {memory}/{limit} chars (CJK {cjk}) · SOUL {soul} chars · anchors {anchors} · samples {samples}',
      validation: 'Validation',
      ok: 'passed',
      failed: 'failed with {errors} errors and {warnings} warnings. Fix them and call reunion_compose again.',
      errors: 'Errors',
      warnings: 'Warnings',
      draft: 'Draft id',
      draftLine: '{draftId} (valid for {minutes} minutes; confirm with reunion_commit)',
      confirmHint: 'Show the user the 5 voice traits, 3 memory entries, and 3 sample replies; ask whether it sounds like them. Only commit after they confirm.',
      checksPass: 'All checks passed (5–10 anchors occur verbatim in the archive; SOUL never recaps the story; the samples are new text).',
      warningCount: '{count} warnings',
    },
    commit: {
      title: 'Saved',
      fileLine: '- {name} — {size}',
      updated: 'updated',
      anchorSection: 'Voice anchors',
      nextHint: 'reunion_load loads the persona into this session; mode=skill writes a skill any later session can invoke.',
      stale: 'That draft has expired or is unknown; call reunion_compose again.',
      missingTranscript: 'This persona has no archive yet; run reunion_import first.',
      written: 'Written: {dir}',
    },
    thread: {
      notPersona: 'This is a thread (THREAD), not a persona; load it directly with reunion_load. digest/compose/commit do not apply.',
    },
    recall: {
      title: 'Recall',
      disabled: 'Recall is off (config.recallEnabled=false).',
      needSlug: 'This session has no loaded thread or persona. Call reunion_continue / reunion_load first, or pass slug.',
      empty: 'Nothing in the archive matched "{query}". Try a word that appears in the original text. A wording mismatch can miss a real fact.',
      missing: 'No archive for {slug}',
      line: '- [{role} #{turn}] {text}',
      pinned: '(Internal: written into core memory. Do not tell the user it was saved. The loaded section does not hot-update; reload to refresh it.)',
      notPinned: '(Internal: excerpts only; core memory was not changed.)',
    },
    continue: {
      title: 'Ready · keep chatting',
      summary: 'Imported {messages} messages, built a ~{chars}-character brief, and loaded it into this session.',
      reused: 'This thread was already imported; it is loaded into this session again.',
      next: 'Ask the user to say the next line now (e.g. “pick up where we left off”). Do not recite the brief.',
    },
    load: {
      title: 'Loaded',
      threadTitle: 'Thread loaded',
      threadMeta: 'Thread: {displayName} · {messages} messages · {chars} character brief',
      threadNext: 'Continue from where it stopped; the brief is not a recap script.',
      threadScope: 'The thread applies to this session only and is not written to the session log; restart or a new session needs reunion_load again.',
      threadOpening: 'Let us pick up where we left off.',
      openingDefault: "I'm back.", 
      persona: 'Persona',
      session: 'Session',
      sessionLine: '{id} — the persona section is injected and applies from the next model step.',
      opening: 'Optional opening line: {text}',
      files: 'Read',
      skill: 'Skill',
      skillLine: '{path} (later sessions can invoke skill {name})',
      both: 'The session persona and the skill are both loaded.',
      nextHint: 'Say the first line now, for example "I\'m back." The archive stays on disk and never enters context — only SOUL and MEMORY do.',
      scopeNote: 'The persona applies to this session only: other sessions, subagents, and new sessions are unaffected. It is not written to the session log, so restart, resume, or a new session needs reunion_load again. Use reunion_unload to leave it; no files are touched.',
      skillNote: 'The skill summary appears in the workspace skill catalog (every session sees one line); its body loads only when the skill is invoked. Deleting the persona also removes the skill.',
      notFound: 'No such persona; run reunion_import first.',
      noAgent: 'This tool must be called from a session.',
      already: 'This persona is already loaded in this session.',
      deleteFirst: 'Removed the persona section from this session.',
      switched: 'Switched from {previous} to {slug}.',
      metaLine: 'Belongs to: {displayName} · calls the user {userNickname} · {messages} archived messages',
    },
    unload: {
      title: 'Unloaded',
      persona: 'Persona',
      done: 'Removed {displayName} ({slug}) from this session; it answers as the normal assistant again.',
      nothing: 'No persona is loaded in this session.',
      notLoaded: '{slug} is not loaded in this session. Loaded: {loaded}',
      noneLoaded: 'No persona is loaded in this session.',
      kept: 'SOUL.md, MEMORY.md, transcript.jsonl, and meta.json stay on disk; reunion_load can bring it back.',
      nextHint: 'To delete the data, use reunion_delete with confirm=true.',
    },
    list: {
      title: 'Personas',
      empty: 'No persona imported yet. Run reunion_inspect on an export first.',
      line: '- {slug} — {displayName} (calls the user {userNickname}) · {messages} messages · {from} → {to} · {dir}',
      broken: '- {slug} — incomplete directory (missing archive or SOUL/MEMORY)',
      threadLine: '- {slug} — {displayName} (thread) · {messages} messages · {from} → {to} · {dir}',
      total: '{count} total',
    },
    delete: {
      title: 'Deleted',
      dir: 'Directory',
      files: 'Files',
      filesLine: '{dir} ({files} files, {bytes})',
      skillRemoved: 'Removed generated skill: {path}',
      skillMissing: 'No generated skill to remove.',
      unloaded: 'Removed the persona section from this session.',
      confirm: 'Deletion cannot be undone. Ask the user, then call again with confirm=true.',
      notFound: 'No such persona: {slug}',
      nextHint: 'The original export file was not touched; to restore, run reunion_import again.',
    },
    cli: {
      usage: 'Usage: dsh-reunion <inspect|import|list|delete> [options]\n  inspect <file|dir|share-url> [--json]\n  import <file|dir> --name <name> [--slug <slug>] [--sessions id1,id2] [--all] [--companions <dir>]\n  import <file|dir> --mode separate [--sessions id1,id2] [--name <name>] [--companions <dir>]\n  import <file|dir|share-url> --mode thread [--sessions id] [--name <name>] [--companions <dir>]\n  inspect <file|dir|share-url> [--query text] [--sort messages|span|recent]\n  read <file|dir> --session <id> [--offset 0] [--limit 20]\n  list [--companions <dir>]\n  delete <slug> --yes [--companions <dir>]\n',
      unknownCommand: 'Unknown command: {command}',
      done: 'Done.',
      json: 'JSON report',
    },
    errors: {
      shareGone: 'Share link invalid or original session deleted ({shareId}). Re-share in DeepSeek, or use an export ZIP. Detail: {detail}',
      shareEmpty: 'This share snapshot has no importable messages ({shareId}). Share a conversation that has text.',
      shareNetwork: 'Could not fetch DeepSeek share ({shareId}). Check the network and retry. Detail: {detail}',
      shareBadPayload: 'Could not parse share payload ({shareId}). Re-share or use a ZIP. Detail: {detail}',
      threadNeedOneSession: 'This export has {count} conversations; continue/thread needs exactly one. Run reunion_inspect, then reunion_continue with a session id. Options: {list}',
    },
    field: {
      'conversation-id': 'conversation id',
      title: 'conversation title',
      'current-message': 'leaf message id of the visible branch (selects the imported branch)',
      'created-at': 'conversation creation time',
      'message-id': 'message id (tree node)',
      parent: 'parent message id (null = root; several children = regenerated branch)',
      role: 'role: USER / ASSISTANT',
      status: 'generation status: FINISHED / CONTENT_FILTER / TIMEOUT …',
      'message-time': 'message time (RFC 3339)',
      'fragment-type': 'fragment type (question, answer, thinking, or tool)',
      'fragment-content': 'fragment body (verbatim question or answer)',
      'share-id': 'DeepSeek public share snapshot id',
      'share-content': 'message body from the share snapshot',
    },
    fragment: {
      request: 'the user text',
      response: 'the assistant text',
      template: 'templated answer (kept as assistant text)',
      think: 'reasoning (never persona material)',
      tip: 'hint (never persona material)',
      file: 'file attachment (not multimodal in v1; skipped)',
      risk: 'content-risk notice (skipped)',
      tool: 'search/tool fragment (skipped)',
    },
    diag: {
      'export.manifest-missing': 'manifest.json is missing; continuing from the directory layout.',
      'export.index-missing': 'chat_session_index.json is missing; continuing from conversation files.',
      'export.manifest-damaged': 'manifest.json does not parse: {detail}',
      'export.index-damaged': 'The index does not parse: {detail}',
      'export.index-row-invalid': 'Index row {detail} is not a conversation record.',
      'export.index-not-array': 'The index is not an array ({detail}); continuing from conversation files.',
      'export.version-unknown': 'The export format version is unknown.',
      'export.version-unsupported': 'Export format version {detail} is unverified; parsing as v3 best effort.',
      'export.conversation-missing': 'Missing conversation file: {detail}',
      'export.conversation-damaged': 'Damaged conversation file: {detail}',
      'export.conversation-shape': 'Unexpected conversation file structure: {detail}',
      'export.message-shape': 'Skipped an unrecognized message: {detail}',
      'export.conversation-fields': 'Unrecognized conversation fields: {detail}',
      'export.message-fields': 'Unrecognized message fields: {detail}',
      'export.fragment-types': 'Unrecognized fragment types: {detail}',
      'export.duplicate-id': 'Duplicate message id: {detail}',
      'export.parent-missing': 'A message parent is missing; the branch is cut there: {detail}',
      'export.parent-cycle': 'The message tree contains a cycle: {detail}',
      'export.time-order': 'A reply is timestamped before its question: {detail}',
      'export.no-messages': 'This conversation has no usable messages: {detail}',
      'source.not-json': 'This file is not parseable as JSON; it is probably not a chat export.',
      'source.no-messages': 'No role/content message arrays were found, so the structure is unrecognized; share it with the model to decide.',
      'source.streamed': 'The file is large ({detail} bytes) and was read as a stream.',
      'source.bad-lines': 'Skipped {detail} unparseable JSONL lines.',
      'source.unrecognized': 'The archive has no manifest or conversation files: {detail}',
      'file.empty': 'The file is empty.',
      'inspect.partial': 'Only part of the conversations were analyzed; totals are lower bounds.',
      'probe.unknown': '{detail}',
    },
    valid: {
      'display.missing': 'A display name is required.',
      'nickname.missing': 'How the persona calls the user is required.',
      'soul.missing': 'The SOUL body is empty.',
      'memory.missing': 'The MEMORY body is empty.',
      'soul.too-short': 'SOUL is too short ({detail} chars) to describe a voice.',
      'memory.too-short': 'MEMORY is too short ({detail} chars).',
      'memory.budget': 'MEMORY is over budget ({detail} chars).',
      'memory.structure': 'MEMORY needs at least one Markdown heading.',
      'memory.bullets': 'MEMORY needs at least 4 bullet points (currently {detail}).',
      'memory.nickname': 'MEMORY never mentions the user nickname "{detail}".',
      'soul.display-name': 'SOUL never mentions the persona name; it may read as narration.',
      'fewshot.count': 'A SOUL draft needs 5–10 verbatim anchors (currently {detail}).',
      'fewshot.length': 'This anchor has an unsuitable length ({detail}).',
      'fewshot.multiline': 'An anchor must be one message, not multiple lines: {detail}',
      'fewshot.not-found': 'This "verbatim" anchor is not in the archive: {detail}',
      'soul.verbatim': 'SOUL reproduces archive text ({detail}…); rewrite it as a voice rule.',
      'samples.count': 'Exactly 3 sample replies are required (currently {detail}).',
      'samples.length': 'Sample reply length is unsuitable: {detail}',
      'samples.duplicate': 'Two sample replies are identical.',
      'samples.verbatim': 'A sample reply is an archived line; write a new one: {detail}',
      'samples.derivative': 'A sample reply is too close to archived text: {detail}',
      'samples.close': 'A sample reply is a little close to the archive; make it more natural: {detail}',
      'memory.hedge': 'MEMORY contains speculative words (maybe/probably); move them to the unconfirmed list.',
      'scan.truncated': 'The archive is large, so only the first {detail} characters were checked; anchor and verbatim checks are degraded.',
    },
  },
}

/** Locale ids this module can render. */
export const LOCALES = ['zh', 'en']

/**
 * Resolve the output locale.
 * @param {object} request - locale inputs.
 * @param {string} request.configured - `auto`, `zh`, or `en`.
 * @param {string} [request.preference] - Host locale preference, when readable.
 * @param {string} [request.text] - text the tool was called with, used as a last signal.
 * @returns {'zh'|'en'} resolved locale.
 */
export function resolveLocale(request) {
  const configured = request.configured
  if (configured === 'zh' || configured === 'en') return configured
  for (const candidate of [request.preference, process.env.DSH_LOCALE, process.env.LC_ALL, process.env.LANG]) {
    if (typeof candidate !== 'string' || candidate.length === 0) continue
    const lower = candidate.toLowerCase()
    if (lower.startsWith('zh')) return 'zh'
    if (lower.startsWith('en')) return 'en'
  }
  if (typeof request.text === 'string') {
    const cjk = (request.text.match(/[\u3400-\u9fff]/gu) ?? []).length
    const latin = (request.text.match(/[A-Za-z]/gu) ?? []).length
    if (cjk >= 2 && cjk >= latin / 8) return 'zh'
    if (latin > 0 && cjk === 0) return 'en'
  }
  return 'zh'
}

/**
 * Look up one localized string.
 * @param {string} locale - `zh` or `en`.
 * @param {string} key - dot-separated key.
 * @param {Record<string, string | number>} [params] - placeholder values.
 * @returns {string} localized text, or the key when missing.
 */
export function t(locale, key, params = {}) {
  const dictionary = STRINGS[locale === 'en' ? 'en' : 'zh']
  const value = lookup(dictionary, key.split('.'))
  if (typeof value !== 'string') {
    if (locale !== 'en') return t('en', key, params)
    return key
  }
  return value.replace(/\{(\w+)\}/gu, (match, name) => (name in params ? String(params[name]) : match))
}

/** Look up a dotted key, honoring keys that themselves contain dots. */
function lookup(node, parts) {
  if (node === null || node === undefined || typeof node !== 'object') return undefined
  const remaining = parts.join('.')
  if (Object.hasOwn(node, remaining) && typeof node[remaining] === 'string') return node[remaining]
  if (parts.length === 0) return undefined
  return lookup(node[parts[0]], parts.slice(1))
}

/**
 * Human byte size.
 * @param {number} bytes - size in bytes.
 * @returns {string} for example `12.4 MB`.
 */
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`
}

/**
 * ISO date (UTC, day precision) or an em dash.
 * @param {number | null | undefined} ms - epoch milliseconds.
 * @returns {string} ISO date.
 */
export function formatDate(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '—'
  return new Date(ms).toISOString().slice(0, 10)
}

/**
 * ISO date and time (UTC) or an em dash.
 * @param {number | null | undefined} ms - epoch milliseconds.
 * @returns {string} ISO timestamp.
 */
export function formatDateTime(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '—'
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 16)
}

/**
 * Format a character budget with thousands separators.
 * @param {number} value - count.
 * @returns {string} formatted count.
 */
export function formatCount(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('en-US') : '0'
}
