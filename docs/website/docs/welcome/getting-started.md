---
id: welcome-getting-started
sidebar_label: 欢迎与快速入门
title: 欢迎与快速入门
---

欢迎来到 reiDbView 桌面版。这里汇总了产品定位、运行前的检查项与首次安装流程，帮助你在确保安全策略生效的情况下完成启动。

![桌面端安装向导占位符](/img/placeholders/welcome-installer.svg)

## 产品概览
- **设计目标**：提供安全的只读 PostgreSQL 浏览体验，覆盖 Schema 查看、查询执行、Saved SQL 与运维诊断。
- **适用场景**：业务分析、运营排查、运维读-only 巡检、BI 辅助查验。
- **安全原则**：所有请求落在只读事务内执行，默认拒绝写操作；敏感凭据仅在本地加密存储。

## 系统要求
| 组件 | 建议版本 | 说明 |
| --- | --- | --- |
| 操作系统 | Windows 11 / macOS 13 / Ubuntu 22.04 | 需具备访问目标数据库的网络权限 |
| Node.js | 20 LTS（用于本地开发或自助构建） | 使用 `corepack enable` 统一 pnpm 版本 |
| 数据库 | PostgreSQL 12+（目标实例） | 需准备只读账号，确保具备 `pg_catalog` 访问权限 |
| 应用库 | PostgreSQL（APP_DB） | 存储用户、连接信息与 Schema 缓存，初始化需人工执行 SQL |

## 首次安装
### 前提条件
1. 获取签名的桌面安装包或在本地运行 `pnpm --filter @rei-db-view/web dev` 打包。
2. 准备 APP_DB 的连接串、只读数据源 DSN 与 `APP_ENCRYPTION_KEY`（32 字节 base64）。

### 操作步骤
1. **安装与启动**：运行安装包或通过 `pnpm --filter @rei-db-view/web dev` 在开发模式打开桌面端。
2. **访问引导页**：首次启动将跳转至 `/install`，录入 APP_DB schema 与前缀，复制安装页提供的 SQL。
3. **执行初始化 SQL**：在可信的 DB 客户端中执行 SQL 脚本，创建用户、连接与缓存相关表。
4. **确认初始化完成**：回到安装页点击“我已执行”，接口会校验必需表与列的存在性。
5. **配置环境变量**：确保桌面端运行环境中设置 `APP_DB_URL`、`APP_ENCRYPTION_KEY` 等项目必需变量。

### 结果确认
- `/install` 页面显示 **“initialized: true”**，并列出所有期望的表。
- 登录页面可正常展示，输入测试账号后进入桌面主界面。
- 顶部状态条显示当前连接处于 **Read-only** 模式。

### 常见故障排查
| 症状 | 可能原因 | 处理建议 |
| --- | --- | --- |
| 安装页持续提示缺表 | SQL 未完整执行或使用了错误的 schema | 重新对照安装页生成的 SQL；确保 `search_path` 与 schema 名一致 |
| 登录后空白页 | APP_DB 未提供默认用户或 session 失效 | 使用 CLI 创建测试用户或检查 `better-auth` 配置 |
| 连接数据库失败 | DSN 未启用 TLS 或 IP 未加入白名单 | 确认 `sslmode=require`；联系数据库管理员放通网络 |

> 提示：所有初始化脚本须由 DBA 手动执行，应用不会自动迁移数据库。
