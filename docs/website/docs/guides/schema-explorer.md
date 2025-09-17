---
id: schema-explorer
sidebar_label: Schema Explorer
title: Schema Explorer 操作指南
---

Schema Explorer 提供表结构与索引的集中浏览体验，默认读取应用数据库缓存，必要时可触发刷新连接真实数据库自省。

## 页面入口
- 路径：`/schema`
- 依赖：用户需要登录并选择连接；若 APP_DB 未完成初始化，页面会重定向到 `/install`。

## 功能概览
- **Schema 列表**：展示可见 schema；支持本地隐藏规则（`apps/web/lib/schema-hide.ts`）。
- **表详情**：字段信息、类型、是否可为空、默认值。
- **索引信息**：整合 `pg_index` 与 `pg_indexes`，显示唯一性、表达式、包含列。
- **刷新元数据**：按钮触发 `/api/schema/refresh`，只读事务写入缓存。

## 使用建议
- 优先在低峰期刷新 schema，自省操作会扫描系统表。
- 当缓存缺失时 API 会返回 mock 数据，前端应提示用户完成初始化。
- 若需要新增 APP_DB 表或列，务必同步更新 `appdb-init.ts` 与安装页面提示。
