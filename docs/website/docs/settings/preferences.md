---
id: settings-preferences
sidebar_label: 设置与偏好
title: 设置与偏好
---

设置面板允许用户调整语言、时区、主题与查询相关的默认行为，并提供安全与会话管理选项。

![设置面板占位符](/img/placeholders/settings.svg)

## 个人资料
- 支持切换界面语言（当前仅中文）、时区与日期格式。
- 头像与显示名称同步自登录信息，后续版本将提供自定义字段。

## 查询默认值
- **Timeout**：对应 `QUERY_TIMEOUT_DEFAULT_MS`，范围 1s ~ `QUERY_TIMEOUT_MAX_MS`。
- **Max Rows**：单次查询返回行数上限，受 `env.MAX_ROW_LIMIT` 约束。
- **Formatting**：可选择是否自动格式化 SQL、启用驼峰列名转换。

## 数据展示偏好
- 列宽记忆：关闭后，表格将在每次刷新时重置到默认宽度。
- JSON 展示：选择默认折叠层级与是否显示行号。
- Null 值渲染：可选“空白”“`NULL` 标签”或“斜体灰字”。

## 安全选项
- **Idle Lock**：设置 UI 空闲多久自动锁定，需要重新登录才能访问敏感数据。
- **Confirm before exporting**：开启后导出前强制弹窗提醒数据脱敏要求。
- **Two-step actions**：包含终止连接、刷新 Schema 等操作的二次确认。

## 重置与同步
- 点击“恢复默认”将清除本地存储的偏好设置，但不会影响服务器配置。
- 偏好设置仅保存在当前设备，如需跨设备同步，请导出配置文件并在新设备导入。
