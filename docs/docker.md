# Docker 化与一键运行指南

本项目提供 `Dockerfile` 与 `docker-compose.yml`，可将 `apps/web`（Next.js 15 / React 19 / App Router）构建为小体积、可移植的镜像，开箱即用。

## 快速开始（本地）

前置：已安装 Docker Desktop 或 docker-cli。

```bash
# 构建镜像（名称可自定义）
docker compose build

# 运行（默认监听 3000）
docker compose up -d

# 访问 http://localhost:3000
```

停止与清理：

```bash
docker compose down
```

## 关于环境变量

运行时读取的环境变量见 `apps/web/lib/env.ts`：

- `APP_DB_URL`：应用自有 PG 连接，用于存储用户、会话与加密后的用户自有连接等。
- `APP_ENCRYPTION_KEY`：32 字节 base64，用于 AES-256-GCM 加/解密（示例：`MDEy...`）。
- 其他限时与分页参数：`QUERY_TIMEOUT_DEFAULT_MS` 等，可保留默认值。

出于安全考虑，`docker-compose.yml` 未内置任何机密；请在启动时通过 shell 环境或 `env_file` 注入，避免写入镜像。

## 构建说明

- `apps/web/next.config.ts` 设为 `output: 'standalone'`，镜像仅包含运行所需的追踪文件。
- 构建阶段使用 pnpm（通过 Corepack 激活），产物复制到运行阶段镜像；最终镜像基于 `node:20-bullseye-slim`。
- 运行命令为 `node server.js`（Next standalone 服务器）。

## 开发模式（可选）

生产镜像默认不可写、无代码挂载。如需热重载开发，建议另建 `docker-compose.dev.yml` 将工作区挂载到容器并运行 `pnpm --filter @rei-db-view/web dev`。

## 限制与注意

- 本项目明确为“只读数据库浏览器”，任何数据库变更需在数据库客户端手工执行，本应用不会自动迁移数据库。
- 若未设置 `APP_DB_URL`，应用仍可启动，但某些需要应用库的功能会返回 501（初始化未完成）。在 UI 的 `/install` 可复制 SQL 并手工初始化。
- 不要将 `.env` 提交到版本库或打包进镜像。

