# 桌面端自动更新开发计划

## 背景与目标

- 基于现有 `.github/workflows/desktop-bundle.yml` 发布流程，补齐自动更新所需产物并确保签名安全。
- 应用启动时自动检查 Github Release 是否存在新版本，并在 UI 内提示用户下载安装。
- 用户可手动触发更新、查看版本说明、控制安装与重启；Linux 先实现检测与提醒。
- 构建与发布过程一旦缺失签名或 updater 产物即失败，避免分发风险。

## 假设与边界

- Release 标签继续使用 `desktop-v*`，发布仓库与当前项目一致。
- 不实现差分更新与渠道切换（beta），暂不调整现有证书管线。
- 更新完成后需用户确认重启；不会动到 `app_prefs` 或其他用户数据。
- Linux 平台暂不执行自动安装，先提示手动下载。

## 阶段性任务

### 阶段一：密钥与配置基线

- 生成 `app.private.key` / `app.pubkey`，公钥写入 `tauri.conf.json`，私钥保存至安全存储并配置为 GitHub Secret `TAURI_UPDATER_PRIVATE_KEY`。
- 更新 `tauri.conf.json`：`bundle.createUpdaterArtifacts=true`，`updater.active=true`、`dialog=false`、`endpoints` 指向 `https://github.com/<owner>/<repo>/releases/latest/download/latest.json`。
- 构建脚本在缺失密钥时直接 fail-fast，防止未签名产物外发。

#### 实施记录（2025-09-24）

- `apps/desktop/src-tauri/tauri.conf.json` 已开启 `createUpdaterArtifacts`，并将 GitHub Release `latest.json` 设置为默认更新源；`updater.pubkey` 暂留占位符 `REPLACE_WITH_APP_PUBKEY`，替换后需保持 `updater.pubkey` 与 `plugins.updater.pubkey` 一致。
- 新增 `apps/desktop/scripts/ensure-updater-signing.mjs`，`pnpm run check:updater-signing` 会在 `build:tauri` 与 `tauri.conf.json > beforeBuildCommand` 中自动执行。当环境缺失 `TAURI_SIGNING_PRIVATE_KEY`（或仍使用旧变量 `TAURI_UPDATER_PRIVATE_KEY`）或占位公钥未替换时会立即终止构建，可通过显式设置 `ALLOW_UNSIGNED_DESKTOP_BUILD=1` 暂时跳过（仅限本地调试）。
- 生成密钥的推荐步骤：
  1. 在仓库根目录执行 `pnpm --filter @rei-db-view/desktop exec tauri signer generate -w apps/desktop/src-tauri/app.private.key`（不会写入 git，`.gitignore` 已忽略该文件）。
  2. 将命令输出的公钥（形如 `RWR...` 的 base64 字符串，可保留原有换行或合并为一行）写入 `tauri.conf.json` 中两个 `pubkey` 字段，并删除 `app.pubkey` 原文件。
  3. 将 `app.private.key` 内容配置到 GitHub Secrets `TAURI_SIGNING_PRIVATE_KEY`，若设置密码同步写入 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`。
  4. 在本地或 CI 构建前导出私钥环境变量，例如：
     ```bash
     export TAURI_SIGNING_PRIVATE_KEY="$(cat apps/desktop/src-tauri/app.private.key)"
     # 可选：export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="<passphrase>"
     ```
  5. 手动删除或安全存储本地私钥文件，仅保留密文或 Secrets。
- GitHub Actions 后续需读取同名 Secrets；在未替换公钥前，`check:updater-signing` 会失败，用于防止无签名产物发布。

### 阶段二：Rust 端插件集成

- `Cargo.toml` 添加 `tauri-plugin-updater`、`tauri-plugin-process`（桌面目标）。
- 在 `src-tauri/src/main.rs` 注册插件，确保桌面平台共享初始化逻辑。
- 更新 `src-tauri/capabilities/default.json`，开放 `updater:default`、`updater:download`、`process:allow-relaunch` 等必需权限。
- 预留后台检查入口：应用启动后异步调用 `check()`，失败日志写入.

### 阶段三：前端交互与状态管理

- 安装 `@tauri-apps/plugin-updater`、`@tauri-apps/plugin-process`，封装 `useAppUpdate` 状态机：`idle → checking → available → downloading → installing → relaunching/failed`。
- 启动自动检查，发现更新后以 Banner 或通知提示；提供“稍后提醒”选项。
- 在 `AppFrame` 添加“检查更新”入口，弹出 `UpdateModal` 显示版本、发布时间、Release Notes 摘要、包体积。
- 下载/安装时展示进度条（若 `onProgress` 可用则实时更新），完成后提示用户保存工作并调用 `relaunch()`。
- 错误处理：网络失败、签名错误展示可重试操作与跳转 Release 页的链接。

### 阶段四：CI/CD 流程更新

- CI 构建 job 中保留 `bundle/updater/*` 并在归档时移动到 `dist/updater`，与安装包一起上传。
- 发布 job (`softprops/action-gh-release`) 上传包含 `latest.json`、平台对应 `.updater.zip` 的资源包。
- 若未来扩展 `workflow_dispatch.inputs.profile`，根据 profile 重命名 manifest（例如 `latest-beta.json`）并校验 stable 渠道不被覆盖。
- CI 增加验证步骤：缺失 manifest / zip 或签名错误时阻断发布。

#### 实施记录（2025-09-25）

- `.github/workflows/desktop-bundle.yml` 构建 job 在 `Build desktop bundles` 之后执行 `Collect desktop artifacts`，强制检查 `bundle/updater` 下的 `latest.json` 与 `.zip` 是否存在，并将安装包与 updater 产物复制到 `target/release/ci-artifacts/<os>` 目录统一归档。
- 新增脚本 `apps/desktop/scripts/compose-updater-artifacts.mjs`，发布 job 下载矩阵产物后使用 Node 20 运行该脚本，将各平台 manifest 合并为单一 `latest.json`（按 `profile` 自动生成 `latest-<profile>.json`），同时拷贝签名过的 `.zip` 至 `dist/updater/`。
- 发布阶段仅上传 `dist/reidbview-desktop-*/bundle/*` 与 `dist/updater/*`，避免重复上传中间产物；脚本会在缺失 manifest / zip 或版本不一致时立刻失败，从 CI 层阻断发布。

### 阶段五：验证与文档

- 本地/CI 校验 `latest.json` 内容：版本号、摘要、SHA256 等字段与产物一致。
- 在 macOS、Windows 上安装旧版本执行完整更新回归；Linux 验证提醒流程。
- 人工演练伪造 manifest、损坏 zip 的失败场景，确认安全提示。
- 更新文档（用户手册、设计文档）与发行说明模板，记录自动更新使用说明与故障排查。
- 汇总测试日志、截图与 Known Issues，完成内部演示与签收。

## 验收标准

### 功能验收

- 启动自动检查：联网 10 秒内完成检查，无更新时静默，仅日志记录“no update”。
- 手动检查：入口可返回最新状态（无更新 / 有更新 / 失败），版本信息与 GitHub Release 保持一致。
- 下载&安装：Windows、macOS 可完整下载 `.updater.zip`、安装并提示重启；新进程版本号更新且旧进程正常退出。
- 签名校验：篡改 `latest.json` 或 `.updater.zip` 时客户端拒绝安装并显示明确错误。
- Linux：提示包含下载链接与说明，不出现自动安装行为。

### 可靠性验收

- 网络异常时自动重试不超过 3 次，仍失败则提示用户稍后再试，应用其他功能不受影响。
- 更新提示不会打断当前查询；重启前提示“请先保存查询结果”。
- 构建或发布流水线若缺失密钥/产物，CI 会中断并标记失败。

### 安全与合规

- 发布的 `latest.json` 与 `.updater.zip` 均由 CI 自动生成并签名；Release 不包含未经签名文件。
- 更新流程不修改用户数据目录（如 `app_prefs`）。
- 文档提供手动更新 fallback 指南，满足读优先策略。

### 测试完成标准

- 单元测试：`useAppUpdate` 状态机覆盖成功、失败、重复检查、取消等路径，CI 通过。
- 手动回归：macOS Sonoma、Windows 11 各完成一次端到端更新演练，记录版本号、耗时、日志证据。
- 回归验证：旧版本安装包可独立安装运行，不依赖 updater。
- 安全演练：伪造 manifest/损坏 zip 测试均被拒绝并产生日志。

## 交付物

- 代码改动（Rust/前端/配置）及相应测试用例。
- 更新后的 GitHub Actions workflow 与密钥管理说明。
- 新增或修订的用户手册、设计文档、发布检查表。
- 测试记录：平台矩阵、步骤、结果、截图/日志。
- 发布前自检清单与回滚方案草案。

## 后续可选工作

- 规划 Beta 渠道与渠道切换 UI。
- 集成更新成功率/失败统计与匿名上报。
- 调研差分更新或第三方方案（如 Sparkle、NSIS Patching）。
