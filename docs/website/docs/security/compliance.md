---
id: security-compliance
sidebar_label: 安全与合规提醒
title: 安全与合规提醒
---

本章节复盘 reiDbView 的只读安全策略、数据处理约束与合规建议，帮助团队在使用工具时遵循最小权限原则。

![安全策略占位符](/img/placeholders/security.svg)

## 只读策略
- 所有查询通过 `withSafeSession` 进入只读事务，显式设置 `statement_timeout` 与 `idle_in_transaction_session_timeout`。
- Query Engine 仅接受 `SELECT/WITH` AST；检测到写操作即返回 `write_not_allowed`。
- Saved SQL 模块与运维工具均在执行前进行语句类型检查。

## 数据加密
- 用户 DSN 通过 `APP_ENCRYPTION_KEY`（32 字节 base64）使用 AES-256-GCM 加密后写入 APP_DB。
- 浏览器仅保存连接 ID，断开连接后可通过设置面板快速失效本地缓存。
- 审计日志计划存储 AST 哈希、参数摘要与行数分档，避免记录原始 SQL。

## 输入校验
- 所有 API 入参使用 `zod` 校验，表名、列名走白名单映射，防止 SQL 注入。
- 模板变量需声明类型，运行时会按类型进行再次验证。

## 使用建议
- 在生产环境启用只读账号，确保无 `CREATE/ALTER` 权限。
- 定期轮换 `APP_ENCRYPTION_KEY`，更新后重新保存连接即可生效。
- 导出数据前确认敏感列的掩码策略，必要时通过设置启用强制脱敏。

## 合规与审计
- 配合公司安全规范，建议在 APP_DB 中启用操作审计表并限制访问权限。
- 对外共享截图或导出文件前，务必确认数据分级要求。
- 如遇安全事件，请参考《docs/security.md#incident-response》中的处理步骤。
