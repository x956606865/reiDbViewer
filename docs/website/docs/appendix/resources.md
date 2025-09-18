---
id: appendix-resources
sidebar_label: 附录
title: 附录与资源
---

汇总常见问题、术语解释与支持渠道，便于在遇到特殊情况时快速查找参考资料。

![附录占位符](/img/placeholders/appendix.svg)

## 常见问题 FAQ
- **安装页提示缺列**：对照 `/install` 页面生成的 SQL，确认是否遗漏 ALTER 语句。
- **Saved SQL 无法执行**：检查是否包含写操作或变量类型不匹配。
- **导出文件编码异常**：确认系统区域设置，必要时在设置面板改用 UTF-8。

## 术语解释
- **Keyset Pagination**：基于排序键的分页方式，避免深分页性能问题。
- **LATERAL Lookup**：在视图中通过 `LEFT JOIN LATERAL` 引入外部列的查询策略。
- **Read-only Session**：通过 `SET TRANSACTION READ ONLY` 与超时守护限制写操作的会话。

## 支持与反馈
- GitHub Issues：提交 Bug 或功能需求，附带复现信息与日志片段。
- 安全邮箱：若发现潜在安全问题，请发送至安全团队地址，并在主题中标注“reiDbView”。
- 文档改进：欢迎在文档页点击“在 GitHub 上编辑此页”提交 PR。

## 相关文档
- 《docs/security.md》：输入校验、安全清单与应急预案。
- 《docs/desktop/github-pages-docs-plan.md》：文档站规划与更新 checklist。
- 《packages/query-engine/README.md》：AST→SQL 实现与测试说明。
