# Rei DbView 桌面端自动更新功能设计

## 背景现状

- 当前通过 `.github/workflows/desktop-bundle.yml` 使用标签 `desktop-v*` 发布桌面端安装包，用户需手动下载。
- `tauri.conf.json` 未启用 `createUpdaterArtifacts`，缺乏 `latest.json` 与 `.updater.zip`。
- 未集成 `@tauri-apps/plugin-updater` 与 `@tauri-apps/plugin-process`，也未配置相关 capabilities 与前端交互。

## 目标

- 启动时后台检测最新版本，并在 UI 中提示可用更新。
- 提供手动检查入口，支持用户查看版本详情后触发一键安装。
- 下载完成后验证签名、安装并自动重启应用。
- 优先覆盖 Windows（NSIS/MSI）与 macOS（DMG）平台；Linux 提供提醒或后续扩展。

## 非目标

- 不实现差分/增量更新。
- 不改动现有证书或 CI 签名逻辑，只新增 updater 所需密钥管理。
- 不支持多仓库来源切换，默认指向官方 Release。

## 体系架构与流程

1. **生成签名**：使用 `pnpm tauri signer generate` 产生 `app.private.key`/`app.pubkey`，公钥写入 `tauri.conf.json`，私钥放入 GitHub Secrets（如 `TAURI_UPDATER_PRIVATE_KEY`）。
2. **构建阶段**：
   - `tauri.conf.json` 中开启 `bundle.createUpdaterArtifacts`。
   - 配置 `updater`：
     ```json
     {
       "active": true,
       "dialog": false,
       "pubkey": "<base64 公钥>",
       "endpoints": [
         "https://github.com/<owner>/<repo>/releases/latest/download/latest.json"
       ]
     }
     ```
   - 运行 `tauri build` 时生成 `bundle/updater` 目录下的 `.updater.zip` 和 `latest.json`。
3. **CI 发布**：
   - 构建 Job 结束前移动 `bundle/updater` 至 `dist/updater`；
   - 发布 Job (`softprops/action-gh-release`) 上传 `dist/**/*` 时包含 `updater` 文件。
   - 若使用 `workflow_dispatch.inputs.profile`，根据 `profile` 重命名 `latest.json`（如 `latest-beta.json`）。
4. **运行时**：
   - Rust 端在 `Cargo.toml` 引入 `tauri-plugin-updater`、`tauri-plugin-process`，在 `main.rs` 注册插件：
     ```rust
     tauri::Builder::default()
         .plugin(tauri_plugin_process::init())
         .setup(|app| {
             app.handle()
                 .plugin(tauri_plugin_updater::Builder::new().build())?;
             Ok(())
         })
         .run(tauri::generate_context!())?;
     ```
   - 更新 `src-tauri/capabilities/default.json` 添加 `"updater:default"`、`"process:allow-relaunch"` 等权限（使用 codegen 确认枚举）。
   - 前端安装 `@tauri-apps/plugin-updater` 与 `@tauri-apps/plugin-process` 依赖。
5. **前端交互**：
   - 新增 `useAppUpdate`（或 store）封装 `check()`、`downloadAndInstall()`，管理状态机（`idle/checking/available/downloading/installing/relaunching/failed`）。
   - App 启动时后台触发检查，有更新则通过 `@mantine/notifications` 或顶部 Banner 提示。
   - 在 `AppFrame` 右侧增加“检查更新”按钮或菜单，点击打开 `UpdateModal` 展示版本信息（含 Release Notes 摘要、发布时间、体积）。
   - 用户点击“立即安装”后展示进度条（若 `update.onProgress` 可用则实时更新），完成后调用 `relaunch()` 并提示即将重启。
   - 错误场景提供重试与“打开 Release 页面”链接（如需，可引入 `@tauri-apps/plugin-shell`）。
6. **渠道策略（可选）**：
   - Stable 默认使用 `latest.json`。
   - 如需 Beta，CI 根据 `profile=beta` 生成 `latest-beta.json`，客户端在设置中存储所选频道并切换 `endpoints`。

## 测试计划

- 单测：对更新状态 store/hook 编写测试，覆盖成功、失败、重复检查等分支。
- 集成：在 macOS、Windows、Linux 分别安装旧版本，指向测试 manifest 验证下载、安装与重启流程。
- 安全：伪造签名错误的 manifest/zip，确认插件拒绝并上报。
- 回归：确保无更新时不会误触发提示，安装包仍可独立安装。

## 风险与缓解

- **签名缺失**：构建脚本检查密钥是否注入，缺失时 fail-fast。
- **渠道覆盖**：对 `latest.json` 重命名时校验，避免 stable 被 beta 覆盖。
- **平台差异**：NSIS/DMG 支持自动更新，MSI/AppImage 需实测；若不支持，UI fallback 为跳转下载。
- **下载失败**：提供重试与错误提示；必要时引导用户至 Release 页面。
- **用户数据**：更新仅替换应用二进制，不触碰 `app_prefs`；提示用户在更新前完成查询。

## 待确认

1. GitHub 仓库 owner/repo、渠道命名约定。（当前仓库，当前分支）
2. 是否正式支持 Beta 频道，频道选择 UI 放置位置。（不需要）
3. 更新完成后是否需要用户手动确认重启。（需要）
4. Linux 平台是否只展示提示而不自动安装。（如果可以，保持多平台一致）
5. 是否需要统计更新成功率并上报。（暂缓）
