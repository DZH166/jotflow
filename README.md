# JotFlow（小董随心录）

一个离线优先、支持跨设备同步的个人信息捕捉与找回工具。

JotFlow 用来随手保存一瞬间的想法、链接、图片、资料和网页快照。它不要求用户先想好标题或分类，只专注一件事：现在快速记下，以后凭模糊线索找回来。

## 当前阶段

- `v0.1.0`：本地记录、搜索、附件、备份、MHTML 离线快照、真实邮箱账号及 Supabase 双端同步技术闭环。
- `v0.2.0`：稳定核心正在迭代，重点解决账号隔离、同步并发、失败重试、备份安全和手机端账号入口。

当前仓库适合个人受控测试，尚未作为公开产品发布。

## 已有能力

- 快速记录随想、链接、图片和普通附件。
- 按时间浏览，支持编辑、置顶、筛选和关键词线索搜索。
- 浏览器本地离线保存；未登录时保留独立的本地暂存。
- 导入 MHTML 网页归档，并在无脚本沙箱中离线阅读。
- 导出和恢复包含记录、附件与网页快照的本地备份。
- 使用 Supabase 邮箱注册、验证、登录和私有账号数据空间。
- 在不同客户端之间同步记录、附件和网页快照。
- Windows Chrome/Edge 网页归档扩展。

## 技术栈

- Vite + 原生 TypeScript
- Supabase Auth、PostgreSQL、Row Level Security 和 Storage
- localStorage + IndexedDB
- Chrome/Edge Manifest V3 扩展
- Node test runner

## 本地运行

需要 Node.js 24 和 pnpm 11。

```bash
pnpm install --frozen-lockfile
pnpm dev
```

默认开发地址为 `http://localhost:4173/`。没有 Supabase 配置时，应用仍可以作为本地暂存工具运行。

如需启用真实账号与跨设备同步，将 `.env.example` 复制为 `.env.local`，填写自己的 Supabase Project URL 与公开前端 key。不要把 `service_role` key 放进前端或提交到 Git。

详细步骤见 [`docs/supabase-setup.md`](docs/supabase-setup.md)。

## 验证

```bash
pnpm test
pnpm build
```

GitHub 上的每次主要推送和拉取请求都会执行相同的测试与生产构建。

## 项目文档

- [`CONTEXT.md`](CONTEXT.md)：领域词汇和已确认业务规则
- [`docs/mvp.md`](docs/mvp.md)：产品承诺和 MVP 范围
- [`docs/account-sync-contract.md`](docs/account-sync-contract.md)：账号与同步契约
- [`docs/backup-contract.md`](docs/backup-contract.md)：本地备份契约
- [`docs/web-snapshot-contract.md`](docs/web-snapshot-contract.md)：离线网页快照契约
- [`docs/v0.2/`](docs/v0.2/)：稳定核心的规格、方案、任务和验收清单
- [`docs/version-workflow.md`](docs/version-workflow.md)：后续版本迭代规则
