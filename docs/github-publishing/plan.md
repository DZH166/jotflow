# JotFlow GitHub 首次发布 Plan

## Architecture Overview

本次不改变应用运行架构，只建立源码远程仓库、版本基线和持续验证流程。

```text
E:\Recall 本地 Git 仓库
  ├─ main：已验证的稳定状态
  ├─ codex/*：后续较大功能的开发分支
  ├─ v0.1.0：指向根提交 66841be
  └─ origin ──HTTPS/Git Credential Manager──> GitHub DZH166/jotflow（Private）
                                                    └─ GitHub Actions CI
                                                       ├─ pnpm install --frozen-lockfile
                                                       ├─ pnpm test
                                                       └─ pnpm build
```

GitHub 仓库通过已登录网页会话创建为空仓库；本地推送使用不含凭据的 HTTPS 远程地址。Windows Git Credential Manager 负责 GitHub 身份授权，任何令牌都不写入仓库、远程 URL、配置文档或命令日志。

## Core Data Structures and Interfaces

### Git references

- `main`：远程默认分支和本地稳定分支。
- `origin/main`：GitHub 上的稳定分支，本地 `main` 对其建立上游跟踪。
- `v0.1.0`：带说明的版本标签，固定指向 `66841be5ff5a97c2676904afdcd27bc922a5ad62`。
- `codex/<version>-<topic>`：后续较大改动的开发分支命名，例如 `codex/v0.2-sync-safety`。

### Repository identity

- GitHub owner：`DZH166`
- Repository：`jotflow`
- Visibility：Private
- Remote URL：`https://github.com/DZH166/jotflow.git`
- Product identity：`JotFlow（小董随心录）`
- Package name：`jotflow`

### CI contract

CI 只读取仓库内容，授予 `contents: read` 最小权限。运行环境固定为 Node 24 和 pnpm 11.19.0，与当前本机主版本一致。依赖必须从 `pnpm-lock.yaml` 冻结安装，随后依次运行完整测试和生产构建；任一步失败，检查即失败。

## Module Design

### GitHub repository

**Responsibility:** 保存项目历史、分支和版本标签，作为后续迭代的远程事实来源。

**Public interface:** `main` 分支、版本标签、仓库网页和克隆 URL。

**Dependencies:** 用户 GitHub 账号与 GitHub 仓库服务。

仓库创建时保持为空，不勾选远程 README、`.gitignore` 或 License，避免与本地根提交形成两套历史。

### Local Git repository

**Responsibility:** 保存开发中的文件和提交，在验证通过后推送远程。

**Public interface:** Git 分支、提交、标签与 `origin`。

**Dependencies:** Windows Git 2.45.1、Git Credential Manager 2.5.0。

本地已有变更按意图拆分提交，不使用 `git add .` 盲目包含文件；每次暂存后检查 `git diff --cached --name-status` 与敏感信息。

### GitHub Actions CI

**Responsibility:** 对推送和拉取请求自动执行同一套测试与生产构建。

**Public interface:** GitHub Checks 状态。

**Dependencies:** `package.json`、`pnpm-lock.yaml`、Node 24、pnpm 11.19.0。

CI 不读取 `.env.local`，核心测试和构建必须在没有真实 Supabase 密钥的环境中通过。

### Version workflow documentation

**Responsibility:** 记录后续开发、合并、推送和打标签的简单规则。

**Public interface:** `docs/version-workflow.md`。

**Dependencies:** 当前 Git 分支策略和项目验证命令。

## Module Interactions

### Initial publication

```text
审查受控文件与敏感信息
  -> 验证 pnpm test / pnpm build / git diff --check
  -> 在 66841be 创建 v0.1.0 标签
  -> 将现有 v0.2 规划与测试基础按职责提交
  -> 更新 JotFlow 项目元数据、版本流程和 CI
  -> 创建空的 Private GitHub 仓库
  -> 配置 origin
  -> 推送 main 与标签
  -> 验证远程分支、文件、隐私状态和 CI
```

### Future iteration

```text
从最新 main 创建 codex/<version>-<topic>
  -> 小步实现和提交
  -> pnpm test + pnpm build
  -> 推送开发分支
  -> 审查后合并 main
  -> 再次验证
  -> 达到里程碑时创建 vX.Y.Z 标签并推送
```

### Credential flow

```text
git push HTTPS
  -> Windows Git Credential Manager
  -> GitHub 浏览器授权（仅在需要时）
  -> 凭据保存在系统凭据管理器
  -> remote URL 始终不包含 token
```

## File Organization

| Operation | File | Responsibility |
|---|---|---|
| Modify | `README.md` | 使用 JotFlow 双语身份，补充当前能力、运行方式和阶段说明 |
| Modify | `package.json` | 包名调整为 `jotflow`，声明 pnpm 11.19.0；保留当前 v0.2 测试脚本 |
| Create | `.github/workflows/ci.yml` | 推送与拉取请求的测试、构建验证 |
| Create | `docs/version-workflow.md` | 后续分支、提交、合并、标签和推送规则 |
| Preserve and commit | `docs/v0.2/spec.md` | v0.2 已批准需求 |
| Preserve and commit | `docs/v0.2/plan.md` | v0.2 已批准技术方案 |
| Preserve and commit | `docs/v0.2/task.md` | v0.2 任务拆分 |
| Preserve and commit | `docs/v0.2/checklist.md` | v0.2 验收清单 |
| Preserve and commit | `tests/unit/smoke.test.mjs` | 当前 v0.2 Node 测试入口冒烟验证 |
| Preserve and commit | `package.json` existing diff | 当前 v0.2 单元测试与扩展测试入口 |
| Create | `docs/github-publishing/spec.md` | 已批准的首次发布规格 |
| Create | `docs/github-publishing/plan.md` | 本技术方案 |
| Create | `docs/github-publishing/task.md` | 后续批准的执行顺序 |
| Create | `docs/github-publishing/checklist.md` | 后续批准的验收清单 |

不修改或提交 `.env.local`；不添加 License；不提交 `dist`、`node_modules` 或任何浏览器数据。

## Commit Design

在不改写根提交的前提下，按职责建立清晰历史：

1. `docs: define v0.2 stability work`：只包含 `docs/v0.2/` 四份文档。
2. `test: establish v0.2 unit test runner`：只包含现有 `package.json` 测试脚本变更和 `tests/unit/smoke.test.mjs`。
3. `chore: prepare JotFlow GitHub repository`：README、包元数据、CI、版本流程和 GitHub 发布四份文档。

提交前逐组审查暂存内容。若实施时发现上述文件仍被其他正在执行的任务修改，则停止对应提交，待文件稳定后重新检查；不覆盖、不回滚其他任务的工作。

## Technical Decisions

| Decision | Choice | Rationale |
|---|---|---|
| 仓库可见性 | Private | 当前仍处于稳定性开发阶段，避免过早公开内部实现和未完成文档 |
| 仓库初始化 | GitHub 空仓库 | 保留本地根提交，避免无关合并历史 |
| Git 传输 | HTTPS + Git Credential Manager | 当前电脑已安装 GCM，不需要在 remote 中保存 token |
| 默认分支 | `main` | 与当前本地分支一致，作为稳定状态 |
| 首个标签 | `v0.1.0` 指向 `66841be` | 与 `package.json` 当前版本和技术闭环阶段一致 |
| 开发分支 | `codex/` 前缀 | 与当前 Codex 工作方式一致，便于识别和回收 |
| 版本格式 | SemVer `vMAJOR.MINOR.PATCH` | 便于后续 v0.2、修复版和 v1.0 里程碑表达 |
| CI 平台 | GitHub Actions | 与仓库同平台，初始维护成本低 |
| CI 运行时 | Node 24 + pnpm 11.19.0 | 与当前本机环境一致，降低环境差异 |
| CI 权限 | `contents: read` | 验证任务不需要写仓库 |
| License | 暂不添加 | 私有阶段无需提前决定开源授权，公开前单独评估 |
| v0.2 在途文件 | 分职责提交并保留 | 用户工作不可丢失，同时让历史区分规划、测试基础和发布配置 |

## Security and Failure Handling

- 推送前同时检查 Git 已跟踪、暂存和未跟踪文件，不能只依赖 `.gitignore`。
- 搜索常见密钥前缀、真实 Supabase URL、管理员 key 和嵌入凭据的远程 URL；只输出文件位置和结论，不回显秘密值。
- 浏览器创建仓库时只提交仓库名、说明和 Private 设置，不上传本地文件。
- 如果 GCM 需要授权，使用 GitHub 官方浏览器流程；不向对话索取密码、验证码或个人访问令牌。
- 如果远程仓库意外产生初始化提交，停止推送并检查历史，不使用强制推送覆盖。
- 如果 CI 首次失败，先读取失败步骤并在本地复现；修复和重新验证后再推送，不把失败状态描述为完成。

## Requirement Traceability

| Requirement | Technical home |
|---|---|
| F1 | GitHub 空 Private 仓库创建流程 |
| F2、F3 | 本地 `origin`、`main` 上游和普通推送 |
| F4 | `v0.1.0` annotated tag |
| F5 | README 与 `package.json` 元数据 |
| F6 | `docs/version-workflow.md` |
| F7 | `.github/workflows/ci.yml` |
| F8 | 分组提交 `docs/v0.2/` |
| F9 | Git、GitHub 页面和 Actions 三层验证 |
| N1、N2、N3 | `.gitignore`、受控暂存、敏感信息扫描和 GCM |
| N4、N5 | 本地验证和冻结依赖 CI |
| N6 | 普通提交、标签与非强制推送 |
| N7 | Out of Scope 与文件清单约束 |
