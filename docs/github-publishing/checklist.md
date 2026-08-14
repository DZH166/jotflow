# JotFlow GitHub 首次发布 Checklist

## Implementation Completeness

- [ ] `DZH166/jotflow` 已创建为 Private 空仓库。（Verification：GitHub 仓库页隐私标记与创建结果。）
- [ ] 本地 `origin` 使用不含凭据的 HTTPS URL。（Verification：`git remote -v`。）
- [ ] `main` 已推送并跟踪 `origin/main`。（Verification：`git status --branch` 和 `git rev-parse`。）
- [ ] `v0.1.0` 指向根提交 `66841be5ff5a97c2676904afdcd27bc922a5ad62`。（Verification：本地标签和 `git ls-remote`。）
- [ ] README 和包元数据使用 JotFlow 双语身份。（Verification：远程文件页面。）
- [ ] v0.2 四份规划文档和冒烟测试被保留。（Verification：本地提交清单与远程树。）
- [ ] 版本迭代说明已加入仓库。（Verification：阅读 `docs/version-workflow.md`。）
- [ ] GitHub Actions CI 已加入仓库。（Verification：工作流文件和 Actions 页面。）

## Security

- [ ] `.env.local`、`.env.*.local`、`node_modules` 和 `dist` 不在 Git 索引或远程仓库中。（Verification：`git check-ignore`、`git ls-files` 和远程树。）
- [ ] `.env.example` 只含占位符。（Verification：人工读取文件。）
- [ ] 已跟踪、暂存和未跟踪文件中没有 GitHub token、Supabase 真实密钥或带凭据的 URL。（Verification：发布前文件名级扫描。）
- [ ] GitHub remote URL 不包含用户名密码或 token。（Verification：`git remote -v`。）
- [ ] GitHub Actions 权限仅为读取仓库内容。（Verification：检查 workflow `permissions`。）
- [ ] 仓库未添加不明确的开源 License，仍保持 Private。（Verification：仓库页和文件树。）

## Git History and Versioning

- [ ] 原根提交未被修改、压缩或删除。（Verification：`git log --reverse`。）
- [ ] v0.2 文档、测试基础和发布配置按职责分为独立提交。（Verification：`git show --stat`。）
- [ ] 没有使用强制推送。（Verification：执行记录和远程历史。）
- [ ] `main` 是远程默认分支。（Verification：GitHub Branches/仓库首页。）
- [ ] 后续分支、提交、验证和标签规则有清晰说明。（Verification：`docs/version-workflow.md`。）

## Build and Test

- [ ] 冻结锁文件安装成功。（Verification：`pnpm install --frozen-lockfile`。）
- [ ] 单元和扩展测试全部通过。（Verification：`pnpm test`。）
- [ ] TypeScript 类型检查和生产构建通过。（Verification：`pnpm build`。）
- [ ] Git 差异没有空白错误。（Verification：`git diff --check`。）
- [ ] GitHub Actions 首次运行测试和构建通过。（Verification：Actions 运行详情。）

## Remote Verification

- [ ] GitHub 远程 `main` SHA 与本地 `main` SHA 完全一致。（Verification：本地 `git rev-parse HEAD` 与远程引用。）
- [ ] GitHub 标签 `v0.1.0` SHA 与本地标签目标一致。（Verification：本地与远程 tag 解引用。）
- [ ] README、`src/`、`supabase/`、`extensions/`、`tests/` 和 `docs/` 均可在远程查看。（Verification：GitHub 文件树。）
- [ ] GitHub 仓库没有额外初始化提交或意外文件。（Verification：远程提交历史。）

## End-to-End Scenario

- [ ] 从本地已验证状态创建 Private GitHub 仓库，推送 `main` 和 `v0.1.0`，GitHub 自动完成测试与构建，最终本地和远程历史一致且没有上传任何秘密。（Verification：Git、本地命令、GitHub 仓库页和 Actions 四方证据。）
