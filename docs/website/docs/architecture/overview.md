---
id: overview
sidebar_label: 系统架构
title: 系统架构总览
---

reiDbView 采用前端（Next.js 桌面版包装）与服务端混合架构，目标是提供只读安全的 PostgreSQL 浏览体验。

## 组件分层
- **桌面端容器**：Tauri 打包的 Web 前端，提供导航、连接切换与数据浏览界面。
- **App Router 后端**：位于 `apps/web`，负责认证、用户连接管理与查询执行 API。
- **Query Engine**：`packages/query-engine` 提供 AST → SQL 编译，确保查询参数化与 Keyset 分页策略。
- **App DB**：保存用户、连接配置与 Schema 缓存，所有初始化 SQL 由用户手工执行。

## 请求流程
1. 用户选择连接，前端从 `localStorage` 读取连接 ID。
2. API 端通过 `withSafeSession` 建立只读事务，设置 `statement_timeout` 与 `search_path`。
3. 查询引擎根据 AST 生成参数化 SQL，执行后返回结果与预览文本。
4. 若执行失败，前端降级到 `/api/query/preview` 仅展示 SQL。

## 关键约束
- 禁止写库操作；所有 API 仅允许 `SELECT/WITH`。
- 双连接池分离元数据与用户数据，避免长事务互相影响。
- 所有输入需经 `zod` 校验与白名单过滤。
