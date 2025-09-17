---
id: query-execution
sidebar_label: Query Execution
title: 查询执行工作流
---

查询执行 API 为用户提供安全、可预测的只读查询体验，核心逻辑位于 `apps/web/app/api/query/execute/route.ts` 与 `packages/query-engine`。

## 前端生成 AST
- 浏览页面通过条件控件组装 AST，所有列、排序与筛选字段来自服务端元数据。
- AST 提交至 `/api/query/execute` 时会携带当前连接 ID 与分页信息。

## 服务端执行
1. `withSafeSession` 建立只读事务并应用超时限制。
2. Query Engine 将 AST 转换成参数化 SQL，维护 `$n` 占位符顺序。
3. 若返回行数超过 `MAX_ROW_LIMIT`，请求会被拒绝并给出提示。
4. 查询成功返回数据行、列配置与 SQL 预览文本，供前端展示。

## 降级策略
- 当执行接口返回错误且包含 `preview` 字段时，前端降级调用 `/api/query/preview`，仅展示 SQL 不执行。
- Saved SQL 路径同样支持预览模式，确保模板语法调试阶段不会触发真实查询。

## 调试建议
- 在 `pnpm test --filter query-engine` 运行单测验证 AST → SQL 行为。
- 使用 `apps/web/lib/sql-template.ts` 的预览函数检查模板变量展开是否符合预期。
