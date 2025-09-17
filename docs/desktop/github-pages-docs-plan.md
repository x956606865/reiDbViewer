# GitHub Pages 文档站建设方案

## 背景与目标
- 为 reiDbView 项目提供一个集中、易访问的使用与开发文档入口。
- 利用 GitHub Pages 免费托管能力实现自动化构建与部署，减少人工维护成本。
- 确保文档信息覆盖路径从快速上手到高级主题，方便不同角色的读者查阅。

## 站点框架选型
- 候选方案：Docusaurus、VitePress、Docsify、Mintlify 等静态站点生成器。
- 推荐优先选择 Docusaurus：
  - React 生态，方便复用现有组件经验。
  - 内置全文搜索、国际化、多版本支持，适合后续扩展。
  - 与 GitHub Actions、Pages 集成成熟。
- 若团队更偏好纯 Markdown 渲染，可考虑 VitePress 作为备选；需要在决策阶段输出优劣分析备忘。

## GitHub Pages 部署流程
1. 在仓库下新增 `docs/website`（或约定目录）作为文档站源文件夹。
2. 配置 `docusaurus.config.ts`：
   - `url`：GitHub Pages 域名，如 `https://<org>.github.io`。
   - `baseUrl`：若使用项目页，设置为 `/reiDbView/`。
   - `i18n`：至少开启 `zh-CN`，可预留 `en` 以便未来扩展。
3. 在 `package.json` 或独立 workspace 内添加脚本：
   - `pnpm --filter docs dev` → 本地预览。
   - `pnpm --filter docs build` → 生成静态文件。
4. 新增 `.github/workflows/docs.yml`：
   - 触发：`push` 至 `main`、`docs/**`、`docs/website/**`。
   - 步骤：`actions/setup-node@v4` → `pnpm -w install` → `pnpm --filter docs build`。
   - 使用 `actions/upload-pages-artifact` 与 `actions/deploy-pages` 发布至 `gh-pages` 分支。
5. 在仓库设置中启用 GitHub Pages，发布来源选择 `GitHub Actions`；如需自定义域名，新增 `static/CNAME`。

## 文档信息架构初稿
- `简介`
  - 项目定位与核心特性
  - 运行环境与只读安全原则
- `快速开始`
  - 环境准备（Node 20、pnpm、桌面端安装要求）
  - 初次运行与 `/install` 初始化流程
- `核心功能`
  - Schema Explorer：界面说明、API 约束、降级策略
  - 数据浏览与查询执行：AST → SQL 流程、只读限制、超时
  - Saved SQL 管理：模板语法、导入导出、分页与安全
  - 运维面板：预设查询、信号 API、安全提醒
- `高级主题`
  - 新模板语法（条件/循环）、Keyset 分页与 LATERAL、JSONB 处理
  - 应用数据库结构与初始化 SQL 生成规则
- `安全与合规`
  - 环境变量配置、加密策略、输入校验 checklist（引用 `docs/security.md`）
- `运维与部署`
  - GitHub Pages 发布流程、桌面端发布、版本升级指引
- `附录`
  - FAQ、术语表、API 参考（参数说明、Zod schema 摘要）、变更日志

## 内容编写要点
- 每篇文章标明适用范围与前置条件，突出只读安全红线（无自动迁移、禁止写库）。
- 使用英文文件名与段落中的英文术语保留原语义，保持与代码一致；正文可采用中文说明。
- 对关键流程配合 Mermaid 时序图或流程图（Docusaurus 可通过插件支持）。
- 避免文档与 README 重复，可在构建阶段同步 README 核心片段至首页。

## 推进步骤
1. 确认文档站框架（优先 Docusaurus），如需比较备选方案先产出评估笔记。
2. 在仓库初始化文档站骨架，配置基础导航与主题。
3. 梳理现有 `docs/` 与内部笔记内容，映射到新的目录结构，列出缺口清单。
4. 起草至少三篇核心页面（首页、快速开始、Schema Explorer）并进行本地预览。
5. 配置 GitHub Actions 自动部署，完成 Pages 首次发布并记录验证步骤。
