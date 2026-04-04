# 贡献指南（Contributing）

本文档定义 TodoList 仓库的协作规范，所有贡献者提交代码前请先阅读。

## 1. 分支模型

- 长期分支：
  - `main`：生产稳定分支
  - `develop`：开发集成分支
- 功能分支：
  - 命名：`feature/<phase>-<name>`
  - 示例：`feature/p1-code-quality-hooks`
- 其他分支：
  - `release/<version>`
  - `hotfix/<issue-id>-<short-desc>`

## 2. 提交流程

1. 从目标基线分支切出功能分支。
2. 每完成一个小功能，提交一个最小 commit。
3. 完成后推送分支并创建 PR。
4. 通过 Code Review 后再合并到目标分支。

## 3. Commit 规范

- 使用 Conventional Commits：
  - `feat(scope): ...`
  - `fix(scope): ...`
  - `chore(scope): ...`
  - `docs(scope): ...`
  - `test(scope): ...`
  - `ci(scope): ...`
- 要求：
  - commit 粒度最小化，不要把多个不相关改动塞进一个提交。
  - commit 必须可回滚、可解释。
  - 默认使用 GPG 签名提交：`git commit -S`。

## 4. PR 规范

- PR 标题简明描述变更目标。
- PR 描述至少包含：
  - 变更概述
  - 具体改动
  - 测试结果
  - 风险评估
  - 回滚方案
- 一个 PR 只解决一类问题，避免“超大 PR”。

## 5. 代码质量检查

提交前建议至少执行：

```bash
pnpm install
pnpm run lint
pnpm run typecheck
pnpm run test
```

说明：

- `pre-commit` 会自动执行 `lint-staged`。
- `pre-push` 会自动执行 `typecheck + test`。

## 6. 变更边界要求

- 不要提交无关文件（例如本地 IDE 缓存、临时导出文件）。
- 不要随意修改与当前任务无关的历史代码。
- 如发现仓库出现非本人预期改动，先暂停并和维护者确认。
