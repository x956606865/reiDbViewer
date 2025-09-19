# 桌面端助手功能开发计划

## 1. 背景与目标
- 基于《桌面端助手页面设计方案》，在桌面客户端新增一个 AI 助手入口，为用户提供上下文感知的问答体验。
- 通过模块化实现，确保助手页面与现有只读查询能力深度集成，同时保留严格的安全边界（只读、无敏感信息泄露）。
- 在 4 个迭代内交付可持续演进的助手能力，为后续工具调用、SQL 审核等高级功能铺路。

## 2. 范围界定
- **包含**：新增 `Assistant` Tab、聊天 UI、上下文选择、与 LLM 交互的桥接层、本地对话持久化、基础监控指标。
- **不包含**：数据库写操作、模型托管服务搭建、Web 端助手、跨团队共享上下文同步、权限策略细分。

## 3. 迭代规划

### Sprint 1：最小可用流程（1 周）
- 创建 `assistant` 路由与 Tab（Mantine AppShell 集成）。
- 集成 `@ai-sdk/react` 的 `useChat`，使用 Mock provider 完成基本问答流。
- 引入 Streamdown 渲染流式 Markdown，提供代码块高亮与复制按钮。
- 建立最小 UI 布局：聊天主区 + 输入框。

### Sprint 2：上下文与模板（1-1.5 周）
- 添加 Context Sidebar，接入 `schema-metadata-store`、Saved SQL 列表、最近查询。
- 实现上下文勾选与请求体拼接（`contextChunks`）。
- 提供 Prompt Library（预置模板 + 用户自定义项）。
- 将前端请求桥接到 Tauri 命令 `assistant_chat`（返回假数据或打通首个模型）。

### Sprint 3：对话管理与持久化（1.5 周）
- 实现对话状态管理（Zustand/valtio），支持命名、归档、恢复。
- 将对话记录持久化到本地 SQLite/IndexedDB，包含上下文快照。
- 记录基础指标：响应耗时、上下文大小、token 估算（可基于模型提供的 usage 数据）。
- 完善错误处理与离线/无密钥提示。

### Sprint 4：增强能力与质量线（2 周）
- 接入至少一种真实模型（例如 OpenAI GPT-4o mini），加入 API 密钥管理界面。
- 新增对 LM Studio 本地模型的支持：在设置中可切换 Provider、配置 Base URL（默认 `http://127.0.0.1:1234/v1`），提示使用 `lms server start` 启动本地 OpenAI 兼容服务。
- 增强安全机制：系统提示中声明只读限制、对响应做敏感词检测。
- 加入工具调用基础框架（预留只读 SQL 生成/执行入口，仅模拟执行）。
- 性能优化（懒加载、上下文缓存）与 UI 打磨，完成跨平台测试。

## 4. 详细任务拆解

| 编号 | 任务 | 负责人 | 预计工时 | 依赖 | 验收要点 |
| ---- | ---- | ---- | ---- | ---- | ---- |
| A1 | 新增 Assistant Tab 与路由骨架 | FE | 1d | AppShell 结构 | Tab 可跳转，保持现有页面无回归 |
| A2 | 集成 `useChat` + Mock provider | FE | 1.5d | AI SDK 依赖安装 | 输入后可获得流式回复、加载状态正确 |
| A3 | 引入 Streamdown 与代码块工具栏 | FE | 1d | Tailwind 样式隔离方案 | Markdown 流式渲染无闪烁，样式不影响其它页面 |
| B1 | Context Sidebar（Schema/Saved SQL/最近查询） | FE | 2d | schema-metadata-store 等现有模块 | 勾选项可实时反映到请求预览 |
| B2 | Prompt Library 模块 | FE | 1d | 本地配置 | 可插入模板、支持自定义保存 |
| B3 | Tauri `assistant_chat` 命令桥接 | Full-stack | 2d | Tauri 通信、Mock LLM | 命令接收上下文，返回模拟流数据 |
| C1 | 对话状态管理（store/assistant-session.ts） | FE | 1.5d | Zustand/valtio | 对话切换不丢历史，支持草稿保存 |
| C2 | 对话持久化（SQLite/IndexedDB） | Full-stack | 2d | Tauri SQL/IndexedDB | 列表加载准确，支持删除/归档 |
| C3 | 指标埋点与日志 | Full-stack | 1d | telemetry 模块 | 记录响应耗时、上下文大小等 |
| D1 | 真实模型接入与密钥管理 UI | Full-stack | 3d | Provider SDK、Secrets 插件 | 成功调用模型、错误提示友好 |
| D2 | 安全检查与系统提示规范 | FE + Full-stack | 1.5d | 黑名单/正则库 | 输出符合只读限制，无敏感词误报 |
| D3 | 工具调用骨架与模拟只读 SQL 执行 | Full-stack | 2d | pgExec mock | 可触发模拟工具且结果正确回显 |
| D4 | 跨平台测试与性能优化 | QA/FE | 2d | 构建管线 | Win/macOS 上运行流畅，关键路径无性能警告 |

## 5. 关键依赖与准备
- 同意安装 `@ai-sdk/react`、`streamdown` 等依赖，并确认其不影响现有打包体积。
- 评估 Mantine 与 Tailwind/Streamdown 样式共存策略（必要时在助手容器内引入独立样式表）。
- 准备首个模型的调用凭证（建议支持多环境配置），并在 Tauri 侧实现安全存储；如使用 LM Studio，需要安装 CLI 并通过 `lms server start` 启动本地服务。
- 与安全合规方确认只读策略、敏感数据脱敏要求。

## 6. 风险与应对
- **样式冲突风险**：提前搭建 Storybook/独立页面验证 Streamdown 样式；必要时使用 CSS Modules 包裹。
- **模型成本与失败率**：提供可配置的速率限制、重试机制，必要时允许用户自定义服务端点。
- **上下文过大导致 token 超限**：实现上下文压缩策略（列名/SQL 摘要）与估算提示。
- **离线或无密钥场景**：提供降级提示与本地 Mock，对主流程做分支测试。

## 7. 验收标准
- 助手 Tab 功能在 Windows/macOS 均可稳定运行，布局符合设计稿。
- 至少一个真实模型完成端到端问答，流式渲染顺畅（无显著卡顿）。
- 勾选上下文后，模型回答可引用指定表/列信息且内容准确。
- 本地持久化可列出历史对话，支持重开对话继续提问。
- 日志记录包含上下文摘要、耗时、token 估算，且满足安全规范（无写 SQL）。

## 8. 度量指标
- 模型调用成功率 ≥ 95%。
- 平均首包时延 ≤ 2s（真实模型环境）。
- 上下文命中率（回答中准确引用勾选元数据）≥ 80%。
- 每周主动使用助手的活跃用户数、自定义模板使用次数。
- 用户满意度调研（NPS/FES）作为后续迭代参考。

## 9. 文档与追踪
- 设计文档：`docs/desktop/assistant-page-plan.md`
- 开发计划：`docs/desktop/assistant-development-plan.md`
- 相关 Issue 与任务分配：建议在项目管理工具中按上述编号建立子任务。
- 版本控制：每个 Sprint 结束前合并主干，确保迭代成果可演示。
