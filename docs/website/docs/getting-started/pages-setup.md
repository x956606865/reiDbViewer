---
id: pages-setup
sidebar_label: GitHub Pages 配置
title: GitHub Pages 配置
---

本文档展示如何使用仓库内置的 Docusaurus 站点在 GitHub Pages 上发布文档，流程基于官方部署实践。具体脚本与配置可参考仓库 `docs/website` 目录。

## 配置 GitHub 仓库
1. 确认仓库启用 GitHub Pages，发布来源选择 **GitHub Actions**。
2. 在仓库 `Settings → Pages` 中记录部署域名，后续会写入 `docusaurus.config.ts` 的 `url` 与 `baseUrl`。
3. 若使用自定义域名，请在 `static/CNAME` 中填入域名，并在 DNS 指向 `username.github.io`。

## 更新 Docusaurus 配置
- 编辑 `docs/website/docusaurus.config.ts`，替换 `url`、`baseUrl`、`organizationName`、`projectName` 与 `editUrl` 为实际值。
- 如果仓库属于个人主页（`username.github.io`），`baseUrl` 应为 `'/'`。
- 若是项目页（`github.com/<org>/reiDbView`），`baseUrl` 设为 `'/reiDbView/'`。

## 本地验证
```bash
pnpm --filter @rei-db-view/docs-site install
pnpm --filter @rei-db-view/docs-site start
```
本地预览默认运行在 `http://localhost:3000`。

## 自动部署
- 默认工作流位于 `.github/workflows/docs.yml`，推送到 `main` 或 `docs/` 目录时自动构建并发布。
- 首次执行会创建 `gh-pages` 分支，该分支由 GitHub Actions 托管，请不要手动修改。

## 审核与回滚
- 部署成功后，访问 GitHub Pages URL 进行验证。
- 如需回滚，可在 `Environments → github-pages` 选择历史版本进行 `Redeploy`。
