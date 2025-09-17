---
id: security
sidebar_label: 安全基线
title: 安全基线
---

安全设计围绕“只读、可审计、无隐式写库”展开，以下总结核心措施与必须遵循的守则。

## 命令与连接控制
- 查询执行通过 `withSafeSession` 包裹，统一设置 `SET LOCAL statement_timeout` 与 `idle_in_transaction_session_timeout`。
- 默认 `search_path=pg_catalog,"$user"`，避免引用意外触发用户自定义函数。
- Saved SQL 执行路径仅接受 `SELECT/WITH` 语句，模板编译阶段若检测到写操作会直接拒绝。

## 数据加密
- 用户提交的 DSN 使用 `APP_ENCRYPTION_KEY`（32 字节 base64）通过 AES-256-GCM 加密后存储。
- 浏览器永不保存明文 DSN，只保留连接 ID。

## 输入校验
- API 入参使用 `zod` 进行类型校验，表名/列名等标识符需经过白名单映射。
- 与模板语法相关的变量类型在 `packages/types` 中定义，前后端共享约束，避免绕过校验。

## 审计与日志（规划中）
- 支持记录 AST 哈希、参数摘要与返回行数，取代直接存储 SQL 原文。
- 提供 JSONB 字段脱敏策略与敏感列默认掩码。

详细 checklist 请参考仓库 `docs/security.md`。
