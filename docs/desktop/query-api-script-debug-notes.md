# Query API Script 历史记录调试纪要

> 更新日期：2025-09-23 17:20（由 Codex 自动整理）

## 背景

- 症状：在桌面端查询页执行脚本后能够看到历史记录；切换到其他 Saved SQL 再切回或重启应用后，历史面板不再显示记录。
- 环境：`pnpm --filter @rei-db-view/desktop dev`，Tauri 桌面客户端。
- 数据库验证：`query_api_script_runs` 表中可以查询到新插入的数据。

## 最近改动与日志

### 1. Tauri 端（`apps/desktop/src-tauri/src/api_scripts.rs`）

- 新增命令 `list_api_script_runs`，使用 `sqlite::SqliteArguments` 拼装 SQL。
- 调试输出：
  - `list_api_script_runs called: limit=..., script_id=..., query_id=...`
  - `list_api_script_runs fetched N rows`
  - （已在问题解决后移除多余日志，保留必要的错误警告输出。）

## 处理进度

- 2025-09-23 19:05：修复 `refreshRef` 初始值，确保依赖变化会立刻触发真实刷新。
- 2025-09-23 19:20：修复 `mountedRef` 在 React Strict Mode 下提前被置为 `false` 的问题，避免刷新被短路。
- 2025-09-23 19:40：经复测，切换 Saved SQL 后历史列表能够稳定加载；调试期间添加的临时日志已移除，仅保留必要的错误/警告输出。

## 后续关注点

- 若未来再次出现历史列表为空，先确认 `query_api_script_runs` 表内是否存在对应记录，再检查桌面端 `list_api_script_runs` 调用参数是否包含 `query_id`、`script_id`。
- 如需重新排查，可临时在 `useApiScriptRuns` 周边恢复调试日志，但调试结束后应及时移除，避免噪声。

EOF
