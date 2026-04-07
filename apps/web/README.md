# TodoList Web 前端

这是 TodoList 的用户端前端应用（SPA + PWA），基于 `React + TypeScript + Vite`。

## 技术栈

- React
- TypeScript
- Vite
- Tailwind CSS
- shadcn/ui

## 本地开发

在仓库根目录执行：

```bash
pnpm install
pnpm --filter web dev
```

默认开发地址：

- `http://localhost:5173`

## 后端接口地址

前端默认请求：

- `http://localhost:3000`

如需自定义，请在运行前设置环境变量：

```bash
VITE_API_BASE_URL=http://localhost:3000
```

## 构建与预览

```bash
pnpm --filter web build
pnpm --filter web preview
```

## 当前功能进度（阶段性）

- 邮箱验证码登录页面
- OAuth 回调页面
- 会话本地缓存与启动恢复
- 基础工作台页面骨架

## 目录说明

- `src/pages`：页面组件
- `src/components`：通用 UI 组件
- `src/services`：接口请求与会话处理
- `src/lib`：工具函数
