---
id: intro
sidebar_label: 项目简介
title: 项目概览
---

reiDbView 是一个强调只读安全的 PostgreSQL 数据浏览器。文档站旨在帮助不同角色快速了解项目定位、核心能力与边界假设，并给出桌面端首选的使用方式。

## 你能在这里找到什么
- 快速开始：开发环境准备、桌面端初始化流程、GitHub Pages 发布。
- 架构与安全：双连接池策略、只读守护、模板语法的安全边界。
- 功能指南：Schema 浏览、查询执行、Saved SQL 与运维面板等模块介绍。
- 进阶主题：Keyset 分页、LATERAL Lookup、JSONB 过滤设计（计划撰写）。

## 本站维护原则
- 与仓库 `docs/` 目录保持同步，若有冲突以仓库内容为准。
- 所有流程以“读优先”安全线为核心，不提供自动迁移或写库脚本。
- GitHub Pages 的部署脚本默认使用 Docusaurus 3 与 pnpm，如需其它部署方式请在 issue 中讨论。
