---
id: quickstart
sidebar_label: 快速上手
title: 快速上手
---

本文指引你在本地拉起 reiDbView 桌面端并连接到目标数据库。步骤假定你已经具备 Node.js 20 与 pnpm 环境，且拥有只读数据库凭据。

## 环境准备
1. `corepack enable`，确保 pnpm 版本 ≥ 9。
2. `pnpm -w install` 安装依赖。
3. `pnpm --filter @rei-db-view/web dev` 启动开发服务器（若仅调试查询引擎，可以运行 `pnpm --filter @rei-db-view/web dev -- --turbo` 加速热更新）。

## 初始化应用数据库
- 访问 `/install` 页面，根据提示执行 SQL 初始化 APP_DB（不会自动写库）。
- 确保 `APP_ENCRYPTION_KEY` 已配置为 32 字节 base64 字符串。
- 初始化完成后，重进应用自动进入 Schema Explorer。

## 连接目标数据库
1. 前往 `/connections` 页面新增连接，输入别名与 DSN；服务端会使用 `APP_ENCRYPTION_KEY` 进行 AES-256-GCM 加密。
2. 默认仅保存连接 ID 于浏览器 `localStorage`，不会暴露明文 DSN。
3. 选择连接后即可在 `/browse/<schema>/<table>` 浏览数据并通过只读查询 API 获取结果。

若需要生成静态文档，请继续阅读《GitHub Pages 配置》章节。
