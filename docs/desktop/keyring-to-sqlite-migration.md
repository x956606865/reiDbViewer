# 桌面端钥匙串存储迁移方案

## 背景与目标

- 现行桌面端实现仍通过 Tauri `invoke('set_secret'|'get_secret'|...)` 将敏感信息写入系统钥匙串（Keychain/Credential Manager）。
- 项目基线在 `AGENTS.md` 中已明确：所有本地配置与凭证统一持久化在 `app_prefs` SQLite，并禁止写入外部钥匙串。
- 目标：彻底移除对钥匙串的写入依赖，使用本地 SQLite（配合设备级 AES 密钥）保存助手 API Key、用户数据库 DSN 等敏感字段；同时提供平滑迁移与必要的回滚路径。

## 现状盘点

| 模块 | 当前存储 | 说明 |
| --- | --- | --- |
| `apps/desktop/src/lib/assistant/api-key-store.ts` | 仅钥匙串 (`assistant:<provider>`) | `AssistantSettingsModal` 保存后即写入钥匙串，纯 UI 模式无法工作。|
| `apps/desktop/src/lib/keyring.ts` + `localStore.ts` | SQLite 加密副本 + 可选钥匙串 (`conn:<id>`) | DSN 默认写入 `user_connections.dsn_cipher`，但仍尝试同步钥匙串并保留 `dsn_key_ref` 回退。|
| `apps/desktop/src-tauri/src/main.rs` | 暴露 `set_secret/get_secret/delete_secret/has_secret` 指令 | 所有钥匙串操作入口；依赖 `keyring` crate 和 `secrets-minimal` capability。|
| UI 文案 | 仍提示“凭据已保存到系统钥匙串” | `apps/desktop/src/routes/connections.tsx` 等存在 Keyring 相关提示。|

## 迁移原则

1. 敏感数据仅保存于 `sqlite:rdv_local.db`，以 `app_prefs` 表或专用表存储；内容一律 AES-256-GCM 加密。
2. 使用现有 `secret-store` 模块提供的设备级密钥，避免重复造轮子。
3. 首次迁移需自动从钥匙串读取旧数据并写回 SQLite，然后删除钥匙串条目，确保用户无感。
4. 一旦迁移完成，运行流程不得再依赖钥匙串存在；Tauri 层可选择保留只读迁移命令一段时间，最终移除依赖。
5. 不引入未审计的外部存储或明文落盘。

## 目标状态设计

### 助手 API Key
- 新建 `assistantSecretStore`（或扩展现有 `secret-store`），键名约定：`assistant.apiKey.<provider>`。
- 结构：`{ cipher: string, iv: string, tag: string, created_at: number, updated_at: number }` 序列化后存入 `app_prefs`。
- `AssistantSettingsModal`：
  - 保存时调用新的 `setAssistantSecret(provider, plaintext)`。
  - 读取时若 SQLite 命中则直接解密；若未命中则触发迁移流程从钥匙串读取一次。
  - 保留 UI 中的“可选”逻辑，但提示文案改为“凭据已加密存储在本地 SQLite”。
- 测试：扩展 `api-key-store.test.ts`，模拟 SQLite 插入/读取；删除钥匙串 mock。

### 用户连接 DSN
- `localStore.ts`
  - 去除 `setDsnSecret` / `getDsnSecret` 的调用；DSN 一律依赖 `dsn_cipher`。
  - 新增启动迁移：若行存在 `dsn_key_ref` 或 `dsn_cipher` 为空，则从钥匙串加载 → 使用 AES 加密 → 更新 `dsn_cipher` & 清空 `dsn_key_ref`，成功后调用 `delete_secret`。
  - 移除“optional keyring”返回值；返回值两种状态统一为 `sqlite-encrypted`。
- `keyring.ts`
  - 迁移完成后仅保留 `tryMigrateFromKeyring` 等过渡函数，最终版本可删除整个模块。
- UI 提示：修改 `apps/desktop/src/routes/connections.tsx`、`schema.tsx`、`browse.tsx` 中的文案和错误处理，不再提及钥匙串。

### Tauri 层
- 增加一次性迁移命令：
  - 在 Rust 端提供 `migrate_keyring_payloads()`，遍历可能的 `account` 前缀列表（`assistant:`、`conn:`），调用 JS 发出的请求时按需返回旧密钥。
  - 或者在 JS 侧触发时逐个调用现有 `get_secret`，迁移完成即调用 `delete_secret`。
- 在完成迁移并确保没有调用后：
  - 移除 `keyring` crate、`set_secret` 等命令以及 `secrets-minimal` 能力文件。
  - 更新 `Cargo.toml`、`Cargo.lock`、`tauri.conf.json`。

## 实施步骤

1. **封装新存储 API**
   - 在 `apps/desktop/src/lib/secret-store.ts` 基础上新增通用 `setEncryptedPref(key, value)` / `getEncryptedPref(key)`。
   - 编写单测覆盖序列化与解密流程。
2. **助手模块迁移**
   - 重写 `api-key-store.ts`，弃用 `@tauri-apps/api/core`，改用新的加密偏好存储。
   - 在初始化时执行一次性迁移逻辑（如果检测到钥匙串有旧值）。
   - 更新 `AssistantSettingsModal` 对状态提示的 copy。
   - 补充测试、调整 mock。
3. **连接存储迁移**
   - 去除 `lib/keyring.ts` 的默认导出，改为迁移辅助函数。
   - `localStore.ts` 写入/读取仅依赖 AES cipher；增加迁移函数 `migrateConnectionSecrets()`。
   - 运行 `pnpm test --filter @rei-db-view/desktop localStore` 等验证。
4. **UI 文案与提示更新**
   - 检查所有 `keyring` 关键词，更新为 SQLite 描述。
5. **Tauri 命令收敛**
   - 实现迁移期调用 `get_secret/delete_secret` 的 JS wrapper。
   - 确认无 JS 代码引用后，分阶段移除 `keyring` 命令及依赖。
6. **回归测试**
   - 手动测试 `dev:tauri` 和纯 `dev:ui`：
     - 新增连接、删除连接、切换连接。
     - 助手配置保存/读取。
     - 断电/重启后数据仍在。
   - 验证 SQLite `app_prefs` & `user_connections` 数据正确加密（无明文）。

## 兼容与迁移策略

- 应用启动时（JS 侧）执行：
  1. `migrateAssistantSecretsFromKeyring()`：对 `['openai','custom','lmstudio','ollama']` 逐一尝试读取钥匙串；若成功则写入 SQLite 并删除钥匙串。
  2. `migrateConnectionSecretsFromKeyring()`：扫描 `user_connections` 中 `dsn_cipher` 为空或存在 `dsn_key_ref` 的记录，读取后写入密文并清空引用。
- 迁移成功与否需记录日志；失败时提示用户手动重新输入。
- 迁移代码保留至少两个版本，以便用户升级后仍能自动搬迁旧数据。

## 回滚预案

- 若迁移过程中 SQLite 写入失败：
  - 保留旧钥匙串条目，提示用户重试。
  - 记录错误日志，避免删除原始凭据。
- 若上线后发现严重问题，可暂时恢复读取钥匙串作为 fallback（保留 `get_secret` 调用），但禁止继续写入，确保安全要求不被破坏。

## 测试计划

- 单元测试：
  - 新增 `secret-store` 扩展测试（加密/解密、随机 key 生成）。
  - `api-key-store`、`localStore` 在迁移后的读写流程上增加 case。
- 集成测试：
  - 使用 Vitest 模拟 SQLite 实例，验证迁移函数能处理已有 `dsn_key_ref` 数据。
- 手动验证：
  - macOS/Windows 启动旧版本保存密钥 → 升级到新分支 → 确认密钥仍可读取且钥匙串条目已删除。

## 风险与缓解

| 风险 | 影响 | 缓解措施 |
| --- | --- | --- |
| 迁移过程中写入失败导致凭证丢失 | 用户需重新录入 DSN/API Key | 先写入 SQLite 后再删除钥匙串；错误时保留旧值并提示。|
| 纯 UI 模式缺少 WebCrypto | 助手/连接无法加密数据 | 继续依赖浏览器提供的 `crypto.subtle`（Tauri + Chromium 环境均支持）；在初始化时检测并给出明确提示。|
| 旧版本回退时读取不到钥匙串 | 回退版本失效 | 在迁移完成后、移除钥匙串依赖前发布一次中间版本，确保用户在此版本上已完成迁移；文档中提示回退需手动导入。|

## 后续工作

1. 更新开发文档与安全清单，明确“禁止引用钥匙串”的要求。
2. 在 `docs/desktop/assistant-development-plan.md`、`docs/desktop/开发计划.md` 中同步进度。
3. 评估是否可以将 `secret-store` 抽象成全局密钥管理工具，供未来的凭证（如 Saved SQL token）复用。

