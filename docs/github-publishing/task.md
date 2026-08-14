# JotFlow GitHub 首次发布 Tasks

## File List

| Operation | File | Responsibility |
|---|---|---|
| Modify | `README.md` | JotFlow 双语身份、功能、运行和当前阶段 |
| Modify | `package.json` | `jotflow` 包名、pnpm 版本和现有测试入口 |
| Modify | `.gitignore` | 完整排除本地环境变量和构建/依赖文件 |
| Create | `.github/workflows/ci.yml` | GitHub 推送与拉取请求自动验证 |
| Create | `docs/version-workflow.md` | 后续迭代、分支、提交和版本规则 |
| Preserve | `docs/v0.2/*` | 当前 v0.2 四份规划文件 |
| Preserve | `tests/unit/smoke.test.mjs` | v0.2 测试入口验证 |
| Create | `docs/github-publishing/*` | 本次规格、方案、任务和验收清单 |

## T1: 固化发布文档

**Files:** `docs/github-publishing/spec.md`、`plan.md`、`task.md`、`checklist.md`

**Depends on:** None

**Steps:**
1. 检查四份文件覆盖创建、认证、提交、标签、CI、敏感信息和远程验收。
2. 检查仓库身份固定为 `DZH166/jotflow` Private。
3. 检查任何步骤都不需要把 GitHub token 或 Supabase 密钥写入文件。

**Verification:** 四份文件存在；需求、方案、任务和验收项可以相互追踪。

## T2: 建立 v0.1 版本标签

**Files:** Git tag only

**Depends on:** T1

**Steps:**
1. 验证根提交完整 SHA 为 `66841be5ff5a97c2676904afdcd27bc922a5ad62`。
2. 确认本地和远程不存在冲突的 `v0.1.0` 标签。
3. 创建带说明标签 `v0.1.0`，固定指向根提交。

**Verification:** `git rev-list -n 1 v0.1.0` 返回根提交完整 SHA。

## T3: 提交 v0.2 规划文档

**Files:** `docs/v0.2/spec.md`、`plan.md`、`task.md`、`checklist.md`

**Depends on:** T2

**Steps:**
1. 逐文件确认内容完整且没有密钥。
2. 只暂存 `docs/v0.2/` 四个文件。
3. 检查暂存清单后提交 `docs: define v0.2 stability work`。

**Verification:** 提交只包含四份 v0.2 文档，原文件内容未被修改。

## T4: 提交 v0.2 测试运行基础

**Files:** `package.json`、`tests/unit/smoke.test.mjs`

**Depends on:** T3

**Steps:**
1. 运行现有测试和构建，确认测试入口变更可用。
2. 只暂存测试脚本变更与冒烟测试。
3. 检查暂存差异后提交 `test: establish v0.2 unit test runner`。

**Verification:** `pnpm test` 和 `pnpm build` 通过；提交只包含两个预期文件。

## T5: 准备 JotFlow 仓库元数据与 CI

**Files:** `README.md`、`package.json`、`.gitignore`、`.github/workflows/ci.yml`、`docs/version-workflow.md`、`docs/github-publishing/*`

**Depends on:** T4

**Steps:**
1. 将 README 首标题改为 `JotFlow（小董随心录）`，补齐定位、功能、技术栈、运行、账号同步和阶段说明。
2. 将包名改为 `jotflow`，声明 `pnpm@11.19.0`，不改变应用版本 `0.1.0`。
3. 加固 `.gitignore`，保留 `.env.example`，排除真实环境文件。
4. 新增最小权限 GitHub Actions：Node 24、pnpm 11.19.0、冻结安装、测试和构建。
5. 新增简单版本迭代说明。
6. 逐文件审查并提交 `chore: prepare JotFlow GitHub repository`。

**Verification:** YAML 可解析；README 与 package 元数据一致；暂存清单不含本地文件。

## T6: 本地发布前验收

**Files:** 全部受控项目文件

**Depends on:** T5

**Steps:**
1. 运行 `pnpm install --frozen-lockfile`、`pnpm test`、`pnpm build`。
2. 运行 `git diff --check` 并确认工作区干净。
3. 检查已跟踪和未跟踪文件，确认 `.env.local` 被忽略。
4. 只报告可疑文件路径的方式扫描 GitHub token、Supabase 密钥和嵌入凭据 URL。
5. 检查提交历史和 `v0.1.0` 标签目标。

**Verification:** 所有命令通过，敏感信息扫描无真实秘密，工作区无遗漏。

## T7: 创建 GitHub 私有仓库

**Files:** GitHub repository state

**Depends on:** T6

**Steps:**
1. 使用已登录账号 `DZH166` 打开 GitHub 新建仓库页面。
2. 输入仓库名 `jotflow` 和项目说明，选择 Private。
3. 不初始化 README、`.gitignore` 或 License。
4. 提交创建并验证仓库为空且为 Private。

**Verification:** `https://github.com/DZH166/jotflow` 显示 Private 和空仓库快速设置页。

## T8: 配置远程并首次推送

**Files:** `.git/config` local-only、GitHub refs

**Depends on:** T7

**Steps:**
1. 添加不含凭据的 `origin`：`https://github.com/DZH166/jotflow.git`。
2. 获取远程引用，确认仍为空且无冲突历史。
3. 通过 Git Credential Manager 普通推送 `main` 并建立上游。
4. 普通推送 `v0.1.0` 标签；禁止强制推送。

**Verification:** `git ls-remote origin` 包含 `refs/heads/main` 和 `refs/tags/v0.1.0`；remote URL 不含凭据。

## T9: 远程验收与收尾

**Files:** GitHub repository and Actions state

**Depends on:** T8

**Steps:**
1. 验证 GitHub 仓库为 Private、默认分支为 `main`。
2. 验证 README、v0.2 文档、测试、CI 和源码可见。
3. 验证 `v0.1.0` 指向根提交。
4. 等待首次 GitHub Actions 完成；失败时读取失败步骤、本地复现并修复。
5. 最终检查本地 `main` 跟踪 `origin/main` 且工作区干净。

**Verification:** checklist 全部通过，Actions 状态成功，本地与远程 HEAD 一致。

## Execution Order

```text
T1 -> T2 -> T3 -> T4 -> T5 -> T6 -> T7 -> T8 -> T9
```
