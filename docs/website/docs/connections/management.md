---
id: connections-management
sidebar_label: 连接管理
title: 连接管理
---

连接管理模块负责维护用户自有的数据库连接，所有敏感信息均在服务端加密并以只读方式使用。本章节介绍连接列表、创建流程与常见问题。

![连接列表占位符](/img/placeholders/connection-list.svg)

## 我的连接列表
- 默认按最近使用排序，支持名称、标签与数据库类型筛选。
- 右上角提供“测试连通性”按钮，可对选中连接发起只读探测。
- 列表展示连接别名、目标库版本、最后验证时间与只读状态。

### 前提条件
- 用户已完成登录并初始化 APP_DB。
- 当前账户拥有查看与创建连接的权限（默认启用）。

### 操作步骤
1. 打开侧边栏的 **Connections** 模块。
2. 使用顶部过滤器定位指定连接；可选中多条连接批量刷新健康状态。
3. 点击任意连接行进入详情抽屉，查看连接字符串摘要与最近错误信息。

### 结果确认
- 健康检查成功会显示绿色对勾与耗时；失败时提供错误代码与建议。

![新建连接表单占位符](/img/placeholders/connection-create.svg)

## 新增连接
### 前提条件
- 已准备好只读账号的 DSN，建议包含 `sslmode=require`。
- `APP_ENCRYPTION_KEY` 已配置；服务端可访问 APP_DB。

### 操作步骤
1. 点击连接列表右上角的 **新建连接**。
2. 填写以下字段：
   - **Alias**：用于显示的连接别名。
   - **DSN**：支持 `postgres://user:pass@host:port/db?sslmode=require` 等格式。
   - **Tags**（可选）：用于命令面板快速过滤。
3. 点击 **验证并保存**，服务端会进行 DSN 解析、白名单校验与只读测试。
4. 校验通过后，系统会返回新连接的 ID 并写入 APP_DB。

### 结果确认
- 表单显示绿色提示“已保存”，并回到列表选中该连接。
- 浏览器 LocalStorage 仅存储连接 ID，不含明文 DSN。

### 常见问题
| 错误提示 | 说明 | 解决方案 |
| --- | --- | --- |
| `invalid_dsn_format` | URL 解析失败或缺少数据库名 | 确认 DSN 完整性，使用 `postgresql://` 或 `postgres://` 前缀 |
| `host_not_allowed` | 命中 SSRF 防护白名单 | 检查主机是否为内网或本地地址，如需放通联系管理员 |
| `encryption_key_missing` | 服务器缺少 `APP_ENCRYPTION_KEY` | 在运行环境补充 32 字节 base64 key 后重启应用 |

## 安全说明
- 所有 DSN 经 AES-256-GCM 加密后写入 `<prefix>user_connections` 表，仅保存 `dsn_cipher` 与 `nonce`。
- 前端不会缓存密码或 token，如需更新密钥，直接重新保存连接即可。
- 连接删除操作仍需二次确认；删除后保留审计记录但无法恢复明文。
