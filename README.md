<center>
<h1>TodoList</h1>
<img src="TodoList.png">
<p>一个面向个人与团队的离线优先的待办事宜 Web App，目标是把传统待办清单升级为“可执行计划系统”</p>
<p>
  <img src="https://img.shields.io/github/stars/Yaosanqi137/TodoList?style=for-the-badge&logo=github" alt="GitHub stars">
  <img src="https://img.shields.io/github/forks/Yaosanqi137/TodoList?style=for-the-badge&logo=github" alt="GitHub forks">
  <img src="https://img.shields.io/github/last-commit/Yaosanqi137/TodoList?style=for-the-badge&logo=github" alt="Last commit">
  <img src="https://img.shields.io/badge/React-18-61DAFB?style=for-the-badge&logo=react&logoColor=black" alt="React 18">
  <img src="https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript 5">
  <img src="https://img.shields.io/badge/NestJS-11-E0234E?style=for-the-badge&logo=nestjs&logoColor=white" alt="NestJS">
  <img src="https://img.shields.io/github/license/Yaosanqi137/TodoList?style=for-the-badge" alt="License">
</p>
</center>

---

## 核心功能

## 任务管理

- 创建、编辑、删除任务
- 任务字段：主题、详细内容、DDL、状态、优先级、标签
- 富文本内容支持：图片、视频、链接等媒体信息
- 面向执行的展示：按时间、优先级、状态分组

## AI 分析与 AI 问答

- 对单任务进行可执行策略建议（步骤拆解、风险点、时间预估）
- 对任务集合做协调建议（先后顺序、时间冲突优化）
- 支持会话式问答，围绕用户现有任务上下文进行回答
- 支持多 AI 渠道切换与故障兜底

## Astrbot 双向集成

- TodoList 可调用 Astrbot 接口，复用用户在 Astrbot 中配置的 AI 提供商
- TodoList 可注册为 Astrbot skill，被 QQ 机器人调用
- 机器人可执行典型操作：添加任务、修改任务、删除任务、请求建议

## DDL 邮件提醒

- 任务临近截止时间时触发邮件通知
- 支持可靠定时任务队列，避免高峰期漏发
- 后续可扩展多级提醒策略（如 24h/6h/1h）

## 认证与账号安全

- 邮箱验证码登录
- 2FA（TOTP）
- OAuth 第三方登录：QQ / 微信 / GitHub
- JWT 双 Token（Access + Refresh）机制

## PWA 与本地能力

- 支持“添加到桌面/主屏幕”
- 首次访问后缓存关键静态资源，离线可进入
- 本地数据通过 Dexie.js 管理 IndexedDB
- 联网后自动进行增量同步与冲突处理

## 管理后台（Admin WebUI）

- 站点品牌配置：头像、Header 等视觉信息
- 用户配额管理：默认 100MB，可按用户覆盖
- 存储用量监控与限制策略
- 日志查看与运维辅助功能
- 基于 Token 的后台登录控制

---

## TODO List :(

> 状态说明：`[x]` 已完成，`[ ]` 进行中/未开始（请随开发进度更新）

| 顺序 | 功能实现项（用户视角）             | 你会看到的效果                          | 状态 |
| ---- | ---------------------------------- | --------------------------------------- | ---- |
| 1    | 明确产品能力与交互流程             | 确认 TodoList 的核心使用方式与页面路径  | [x]  |
| 2    | 实现基础登录（邮箱验证码）         | 可以注册/登录并进入主页面               | [ ]  |
| 3    | 实现任务基础能力（增删改查）       | 可以创建、编辑、删除、完成任务          | [ ]  |
| 4    | 实现富文本与媒体内容               | 任务详情可插入图片、视频、链接等内容    | [ ]  |
| 5    | 实现本地离线存储（Dexie）          | 无网时仍可打开并编辑任务                | [ ]  |
| 6    | 实现云端同步与冲突处理             | 恢复网络后自动同步，冲突按规则合并      | [ ]  |
| 7    | 实现提醒系统（邮件）               | DDL 临近时收到邮件提醒                  | [ ]  |
| 8    | 实现 AI 问答（用户自带 Key）       | 可直接用自己的 AI API Key 获取建议      | [ ]  |
| 9    | 实现 Astrbot Provider 接入         | 可复用 Astrbot 内配置的 AI 提供商       | [ ]  |
| 10   | 实现公共 AI 通道（可开关）         | 管理员开启后，用户可直接使用站点公共 AI | [ ]  |
| 11   | 实现 Astrbot Skill 对接            | 可通过 QQ 机器人添加/修改任务与获取建议 | [ ]  |
| 12   | 实现完整账号安全（2FA + OAuth）    | 支持 2FA、QQ/微信/GitHub 登录           | [ ]  |
| 13   | 实现 PWA 安装与离线体验优化        | 支持“添加到桌面”，像本地 App 一样使用   | [ ]  |
| 14   | 实现管理后台（配额/日志/系统配置） | 管理员可管理用户配额、站点信息、日志    | [ ]  |
| 15   | 上线前安全与性能收尾               | 使用更稳定、更安全，核心链路可观测      | [ ]  |

---

## 技术架构

## Monorepo

- 仓库管理：`pnpm workspaces` 或 `Turborepo`
- 目标：在一个仓库管理客户端、服务端、后台，统一工程规范与依赖
- 共享能力：TypeScript 类型、工具库、API SDK、Lint/Format 配置

## 客户端（C 端 SPA + PWA）

- 框架：React 18 + TypeScript + Vite
- UI：Tailwind CSS + shadcn/ui
- 富文本：Tiptap
- 状态管理：Zustand
- 离线存储：Dexie.js（IndexedDB）
- PWA：vite-plugin-pwa（Service Worker + 资源缓存）

## 管理后台

- 复用 React + TypeScript + Vite
- 后台组件库：Ant Design 或 Mantine（待最终确认）
- 目标：提升数据管理类页面的开发效率与稳定性

## 后端 API（BFF + 核心服务）

- 框架：NestJS + TypeScript
- 数据库：PostgreSQL + Prisma ORM
- 缓存与任务队列：Redis + BullMQ
- 文件存储：MinIO（S3 兼容，可迁移至 OSS/COS）

## 认证中心

- JWT 双 Token：Access Token + Refresh Token
- 2FA：otplib（TOTP）
- OAuth：Passport.js 策略体系

---

## 仓库目标结构

```text
TodoList/
  apps/
    web/              # C端 SPA + PWA
    admin/            # 管理后台
    api/              # NestJS 后端
  packages/
    shared-types/     # 前后端共享类型
    ui/               # 可复用 UI 组件（可选）
    sdk/              # API 客户端封装（可选）
    eslint-config/    # 统一规范（可选）
    tsconfig/         # 统一 TS 配置（可选）
  infra/
    docker/           # PostgreSQL/Redis/MinIO 等本地编排（规划）
  docs/
    architecture/     # 架构文档与决策记录（ADR）
```

---

## 部署与使用

### 1. 环境要求

- Node.js `20.x`
- pnpm `9.15.2`
- PostgreSQL `14+`（本地或远程都可）
- 可选：MinIO / S3（附件上传功能使用）

### 2. 安装依赖

```bash
pnpm install
```

### 3. 后端环境变量配置

1. 复制环境变量示例文件：

```bash
cp apps/api/.env.example apps/api/.env
# PowerShell:
# Copy-Item apps/api/.env.example apps/api/.env
```

2. 至少修改以下配置：

- `DATABASE_URL`：你的 PostgreSQL 连接串
- `AUTH_ACCESS_SECRET`：生产环境请改为高强度随机值
- `MAIL_SMTP_*`：邮件服务器配置（验证码/提醒邮件）
- `OAUTH_*`：第三方登录配置（未接入可先保留示例值）
- `S3_*`：对象存储配置（未启用附件可后续再配）

### 4. 初始化数据库

```bash
pnpm --filter @todolist/api exec prisma db push
```

### 5. 本地开发启动

1. 启动后端（默认端口 `3000`）：

```bash
pnpm --filter @todolist/api start:dev
```

2. 启动前端（默认端口 `5173`）：

```bash
pnpm --filter web dev
```

3. 若前端需连接非默认后端地址，可设置：

```bash
VITE_API_BASE_URL=http://localhost:3000
```

### 6. 生产构建与运行

1. 构建：

```bash
pnpm run build
```

2. 运行 API（需先构建）：

```bash
pnpm --filter @todolist/api start
```

3. 发布 Web：

- `apps/web/dist` 为静态资源产物，建议使用 Nginx/静态托管服务发布。

### 7. CI/CD 说明（当前仓库）

- PR 质量检查：`.github/workflows/pr-quality.yml`
- Web 部署模板：`.github/workflows/deploy-web.yml`
- Admin 部署模板：`.github/workflows/deploy-admin.yml`
- API 镜像构建：`.github/workflows/api-docker-image.yml`

说明：

- Web/Admin 工作流通过 Webhook 触发真实部署，需在仓库 Secrets 配置：
  - `WEB_DEPLOY_WEBHOOK_URL`
  - `ADMIN_DEPLOY_WEBHOOK_URL`
- API 镜像工作流仅在存在 `apps/api/Dockerfile` 时执行镜像构建与推送。

## License

本项目遵循 [GNUv3](./LICENSE)。
