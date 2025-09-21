# 桌面端助手页面设计方案

## 1. 背景与目标
- 为桌面用户提供一个集查询上下文、知识库提示与 AI 问答于一体的“助手”入口，降低在多个页面之间来回切换的操作成本。
- 依托现有的只读数据库浏览能力，快速整理元数据和示例查询，作为对话上下文，提高回答准确性。
- 设计一套可扩展的 UI + 服务接口，为后续的查询生成、SQL 审核、运维建议等高级功能留出空间。

## 2. 外部方案调研
### 2.1 Vercel AI SDK
- 提供 `useChat` 等前端 Hook，自动管理消息状态、输入状态，并支持从后端实时流式刷新答案。该 Hook 默认按数据流协议返回消息分片，能在 React 客户端中平滑呈现流动的回复。
- SDK 支持扩展数据分片（如 `data-weather`）与工具调用，便于后续加入结构化信息或触发本地分析。
- 建议采用 `@ai-sdk/react` + 桌面端自建 `/api/chat` 或 Tauri 命令桥接，这样可以兼容我们自定义的只读上下文拼接与模型提供者（OpenAI、Anthropic、DeepSeek 等）。

### 2.2 Vercel AI Elements
- 官方提供的聊天 UI 组件库，基于 shadcn/ui + Tailwind + Vercel AI SDK，内置 `Conversation`、`Message`、`Response` 等常见组件。
- CLI 会将组件直接拉取到本地代码仓库，允许定制；但依赖 Tailwind 变量模式，和我们当前 Mantine 体系存在样式栈差异，需要隔离容器或将组件迁移为 Mantine 风格版。
- 组件库还包含 prompt 输入、内嵌引用、思考链展示等扩展，适合后续拆分为可复用的原子组件。

### 2.3 Streamdown
- 新开源的流式 Markdown 渲染器，主打在 Markdown 片段未闭合时的容错处理，官方已经应用在 AI Elements 的 Response 组件里。
- 原生支持 GFM、KaTeX、Mermaid、Shiki 代码高亮，并通过 Tailwind 样式表提供默认排版。
- 可单独引入到桌面端，替换现有 `react-markdown`，并在流式响应到达时即时渲染，避免内容闪烁。

### 2.4 适配策略概述
- 桌面端目前使用 Mantine + CSS Modules，应优先评估“保留 Mantine 布局 + 迁移核心聊天组件”的方案：
  1. 将 AI Elements 结构抽象成纯 JSX + 样式 `className`，模型层改为 Mantine 组件或 CSS Modules。
  2. Streamdown 样式通过私有容器引入 Tailwind `@source`，并限制作用域，防止污染全局。
  3. 若未来希望全面引入 Tailwind，再规划 global reset 与 Mantine 共存策略。

## 3. 功能范围与用户旅程
- **入口与导航**：AppShell 新增 “Assistant” Tab，支持快捷键（例如 `Ctrl/Cmd+K` 打开浮层）。
- **上下文选择**：左侧抽屉列出当前连接的 Schema、表、Saved SQL、最近查询，支持勾选后自动注入系统提示。
- **对话主视图**：中部显示消息时间线，支持流式回复、代码块高亮、JSON 折叠、复制按钮。
- **提示模板库**：右侧提供常用问句（如“帮我解释列含义”、“生成只读查询”等），一键插入输入框。
- **对话管理**：允许命名、保存、归档对话，并关联当前连接 ID，方便回放。
- **安全提示**：对潜在写操作、超出权限的问题给出只读警告或引导。

## 4. 上下文注入策略
- **基础元数据**：复用 `schema-metadata-store` 缓存，构造结构化 JSON（schema/table/列描述）作为系统提示片段。
- **示例数据/统计**：调用已有的 `pgExec` 只读查询接口，限制行数（如 5 行）并脱敏关键列后作为附加上下文。
- **Saved SQL 摘要**：对用户常用查询提取描述、where 条件，供模型了解业务规则。
- **自定义笔记**：允许用户在本地保存补充说明（Tauri 文件或 IndexedDB），在对话开始前选择注入。
- **注入方式**：前端整理为 `contextChunks`，放入 `useChat` 的 `experimental_prepareRequestBody`，后台统一拼接系统消息。

## 5. 系统架构设计
### 5.1 前端组件分层
- `routes/assistant.tsx`：路由入口，负责布局（左右三栏）与状态组合。
- `components/assistant/ChatPanel.tsx`：封装 `useChat`，处理消息列表、滚动、复制、错误提示。
- `components/assistant/ContextSidebar.tsx`：展示元数据、Saved SQL、最近查询列表，复用已有 hooks。
- `components/assistant/PromptLibrary.tsx`：常用提示模板管理（本地配置 + 用户自定义）。
- `components/assistant/StreamingMessage.tsx`：封装 Streamdown，处理 Markdown、代码块、JSON 展开。
- `store/assistant-session.ts`：以 Zustand/valtio 管理当前对话状态、上下文勾选、草稿输入等。

### 5.2 数据流
1. 用户选择上下文，生成 `ContextPayload` 并缓存。
2. 用户发送问题时，`useChat` 调用桌面端暴露的 `invoke('assistant_chat')`（Tauri command）或本地 HTTP。
3. 后端（Rust/Tauri 或 Node sidecar）汇总：系统提示 + 用户问题 + 上下文 JSON。
4. 通过统一的 LLM Provider 适配层发送请求，启用流式响应；支持多供应商切换与重试。
5. 响应用数据流协议写回前端，`StreamingMessage` 即时渲染。
6. 回复完成后记录元信息（耗时、token 估算、上下文哈希），供后续审计。

### 5.3 模型接入层
- **Provider 适配器**：抽象 `sendChat(prompt, options)`，支持 OpenAI、Anthropic、Azure OpenAI、DeepSeek 等；敏感密钥存放在 Tauri `Secrets` 插件或系统环境变量，绝不写入仓库。
- **对话记忆**：默认只保留当次对话历史，可选择开启“有限记忆”（最近 N 轮）以控制 token 消耗。
- **工具调用**：后续可接入 `streamText` 的工具模式，触发本地只读 SQL 执行或数据汇总（需严格校验只读语句）。

### 5.4 状态与持久化
- 对话记录存储在本地（IndexedDB/SQLite via Tauri），字段包含：`id`、`connectionId`、`title`、`messages`、`contextSnapshot`、`createdAt`、`updatedAt`。
- 上下文勾选、偏好（自动附带哪些信息）保存在 `localStorage`。
- 考虑引入轻量压缩（如 JSONL + brotli）避免记录体积过大。

## 6. 安全与合规
- 仅允许检索/预览数据，不触发任何写操作；在系统提示中明确“助手只能生成只读 SQL/分析”。
- 对外部模型调用添加速率限制与请求签名日志，防止批量泄露。
- 所有用户自定义密钥通过系统级安全存储注入，UI 中提供“测试连接”与“忘记密钥”按钮。
- 对模型响应进行简单的注入检测（关键词黑名单、正则检查），在发现敏感提示时给出警告。

## 7. 实施计划（建议迭代）
1. **可行性验证（Sprint 1）**
   - 在桌面端创建 `assistant` 路由与 Tab。
   - 引入 `@ai-sdk/react`、构建最小 `useChat` + Streamdown 流程（可用 Mock provider）。
2. **上下文集成（Sprint 2）**
   - 打通 schema/saved SQL/最近查询勾选，与请求体拼接。
   - 增加 Prompt 模板、快速插入能力。
3. **持久化与对话管理（Sprint 3）**
   - 本地保存对话、支持命名/归档、重新打开对话恢复上下文。
   - 统计交互指标（token 估算、响应耗时）。
4. **高级能力（Sprint 4+）**
   - 工具调用（自动补全只读 SQL 示例、调取统计函数）。
   - 支持附件（CSV/JSON）上传供模型参考（仅临时存储）。

## 8. 风险与待定问题
- **样式冲突**：Tailwind 与 Mantine 并存需测试，必要时封装 Shadow DOM 或 CSS Modules 重写。
- **模型成本**：需要明确默认模型、计费策略与失败重试逻辑。
- **隐私合规**：若未来允许自定义 Model Endpoint，确保请求前提示用户风险，并提供可选匿名化策略。
- **离线体验**：未联网或密钥缺失时的降级 UX —— 提示文案与 Mock 数据。

## 9. 验收标准
- 助手 Tab 在 Windows/macOS 上均可正常打开，UI 不出现样式错乱。
- 在至少一种主流模型（如 OpenAI GPT-4o mini）下完成端到端对话，且流式渲染无明显卡顿。
- 勾选上下文后，模型回答中能引用指定表/列等信息，并在响应中展示 Markdown/代码高亮。
- 日志中能查看到每次对话的上下文摘要、耗时与 token 估算。
- UI 内无写 SQL、无权限操作的“误导性”建议。

## 10. 后续优化方向
- 增加“多模型对比”或“草稿/重写”能力，帮助用户比较两个回答。
- 结合 Saved SQL 模板，自动生成参数化查询并提供直接运行入口（仍需二次确认）。
- 引入权限策略：根据用户角色控制可见的上下文范围（例如隐藏敏感 schema）。
- 探索将助手集成到全局命令面板，实现跨页面的自然语言操作。

## 附录
- 相关代码位置参考：
  - `apps/desktop/src/App.tsx`：现有 Tab 导航与路由。
  - `apps/desktop/src/lib/schema-metadata-store.ts`：元数据缓存。
  - `apps/desktop/src/services/pgExec.ts`：只读查询执行封装。
  - `apps/desktop/src/components/ConnectionSwitcher.tsx`：连接上下文切换逻辑。
- 推荐监控指标：模型调用成功率、平均响应时长、上下文命中率、用户满意度反馈。
