# JotFlow GitHub 首次发布 Spec

## Background

“小董随心录”已经完成 v0.1 技术闭环，并确定英文项目名为 JotFlow。当前代码只保存在本机 Git 仓库中，尚未连接远程仓库。项目需要上传到用户自己的 GitHub 账号，形成可恢复、可追踪并适合后续版本迭代的代码历史。

GitHub 登录账号已确认为 `DZH166`，仓库名 `jotflow` 当前可用。首次发布采用私有仓库，待稳定和整理简历展示材料后再单独评估公开与开源许可。

## Goals

- 在 GitHub 账号 `DZH166` 下建立私有仓库 `jotflow`。
- 安全上传当前项目，不包含 Supabase 密钥、本地账号会话、构建产物或依赖目录。
- 保留现有 Git 历史和 `main` 分支，不生成冲突的远程初始化提交。
- 建立清晰的 JotFlow 中英文项目身份和 v0.1 版本基线。
- 建立适合持续迭代的分支、提交、版本标签和自动验证规则。

## Functional Requirements

- F1：创建 `DZH166/jotflow` 私有 GitHub 仓库，仓库创建时不额外生成 README、`.gitignore` 或 License。
- F2：本地仓库必须以 `origin` 连接到该 GitHub 仓库，默认分支保持为 `main`。
- F3：首次推送必须保留现有提交历史，并在 GitHub 上正确显示全部受版本控制的项目文件。
- F4：当前根提交 `66841be` 必须标记为 `v0.1.0`，作为已完成技术闭环的基线；正在规划的 v0.2 文档保留在后续提交中，不回写到 v0.1 标签。
- F5：README 和项目元数据使用 `JotFlow（小董随心录）` 的双语身份；应用界面继续显示“小董随心录”，本次不进行产品界面改名。
- F6：增加一份版本迭代说明，约定 `main` 保存已验证状态，较大功能使用 `codex/` 前缀分支，提交信息描述单一变化，里程碑使用语义化版本标签。
- F7：增加最小 GitHub Actions 验证流程，在推送和拉取请求时安装锁定依赖并执行现有测试与生产构建。
- F8：当前未提交的 `docs/v0.2/spec.md` 和 `docs/v0.2/plan.md` 必须作为独立文档提交保留；不得覆盖或丢弃。
- F9：完成推送后必须验证仓库为 Private、默认分支为 `main`、标签 `v0.1.0` 存在、远程文件可见且本地与远程提交一致。

## Non-Functional Requirements

- N1：`.env.local`、`.env.*.local`、`node_modules`、`dist` 和本地缓存不得进入 Git 历史或上传内容。
- N2：不得在命令、日志、文档、远程地址或浏览器表单中暴露 Supabase 密钥、GitHub 密码、令牌或登录会话。
- N3：仓库创建和首次推送前必须执行一次受控文件清单与敏感信息检查；发现可疑内容时停止上传。
- N4：推送前必须通过项目现有测试和生产构建。
- N5：GitHub Actions 使用锁文件安装依赖，保证本机和远程验证尽量一致。
- N6：首次发布不得改写、压缩或删除现有 Git 历史。
- N7：本次只配置源码仓库，不部署公网网站，也不改变 Supabase 项目设置。

## Out of Scope

- 将仓库设为公开或选择开源 License。
- 部署 JotFlow 正式网站、配置自定义域名或发布应用商店版本。
- 修复 v0.2 稳定核心规格中列出的同步、备份和手机端问题。
- 建立复杂的多人协作权限、强制代码审查或自动发布流水线。
- 把 Supabase 数据库内容、用户数据或 `.env.local` 上传到 GitHub。

## Acceptance Criteria

- AC1：访问 `https://github.com/DZH166/jotflow` 时，已登录所有者可以看到仓库，未授权访问者不能读取仓库内容。
- AC2：GitHub 仓库默认分支为 `main`，其最新提交与本地 `main` 的提交 SHA 一致。
- AC3：GitHub 上不存在 `.env.local`、依赖目录、构建目录或真实密钥；`.env.example` 只包含占位符。
- AC4：GitHub 标签列表包含 `v0.1.0`，并指向根提交 `66841be`。
- AC5：README 首屏显示 `JotFlow（小董随心录）`，并能说明项目定位、运行方式和当前阶段。
- AC6：版本迭代说明能够明确回答“在哪里开发、何时合并 main、何时打版本标签、上传前验证什么”。
- AC7：GitHub Actions 对首次推送运行测试和生产构建，最终状态通过。
- AC8：`docs/v0.2/spec.md` 和 `docs/v0.2/plan.md` 在远程仓库中存在，内容与本机原文件一致。
- AC9：`git status` 干净，`git remote -v` 只显示不含凭据的 GitHub 地址，本地 `main` 正确跟踪 `origin/main`。
