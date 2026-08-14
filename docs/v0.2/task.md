# 小董随心录 v0.2 稳定核心 Tasks

## File List

| Operation | File | Responsibility |
|---|---|---|
| Modify | `package.json` | 增加 Node 24 内置单元测试入口并拆分测试脚本 |
| Modify | `src/domain.ts` | revision、文件传输、清理任务类型 |
| Modify | `src/account-store.ts` | 所有读写改为显式 DataScope |
| Create | `tests/unit/account-store.test.mjs` | 范围隔离、迁移、清理测试 |
| Create | `src/backup.ts` | 严格备份校验与整体恢复计划 |
| Create | `tests/unit/backup.test.mjs` | 恶意备份、账号归属、墓碑计划测试 |
| Create | `supabase/migrations/20260814120000_v02_sync_safety.sql` | 墓碑保护、文件清理任务和 RLS |
| Modify | `src/sync.ts` | 远端映射和清理任务 adapter |
| Create | `src/sync-coordinator.ts` | 同步单飞、revision 合并、文件阶段、轮询与重试 |
| Create | `tests/unit/sync-coordinator.test.mjs` | 同步状态机和双客户端行为测试 |
| Remove | `src/sync-engine.ts` | 被 SyncCoordinator 完整替代 |
| Modify | `src/auth.ts` | 暴露恢复事件和更新密码 |
| Create | `src/account-controller.ts` | 账号生命周期、退出顺序和恢复状态 |
| Create | `tests/unit/account-controller.test.mjs` | 密码恢复和退出隔离测试 |
| Create | `tests/helpers/*.mjs` | 内存 Storage、快照/远端 adapter 和可控测试时钟 |
| Modify | `src/main.ts` | 接入新模块、备份恢复、同步状态和移动端账号入口 |
| Modify | `src/style.css` | 恢复表单、重试状态和手机布局 |
| Modify | `README.md`、`CONTEXT.md`、`docs/*.md` | 同步契约与实际能力更新 |
| Create | `docs/v0.2/progress.md` | 每一步验证证据与最终验收记录 |

## T1: 建立 v0.2 测试运行基础

**Files:** `package.json`、`tests/unit/smoke.test.mjs`

**Depends on:** None

**Steps:**
1. 使用 Node 24 内置 test runner 和 `--experimental-transform-types` 直接加载项目 TypeScript。
2. 保留现有浏览器扩展 Node 测试，并增加单元/集成测试命令。
3. 创建一个最小冒烟测试，确认 `.mjs` 测试可以导入 TypeScript 模块；后续由真实行为测试替换。

**Verification:** 运行 `pnpm test`；现有 3 个扩展测试和 Node 冒烟测试均通过。运行 `pnpm build`；构建通过。

## T2: 固化显式账号范围

**Files:** `src/domain.ts`、`src/account-store.ts`、`tests/unit/account-store.test.mjs`、`tests/helpers/memory-store.mjs`、`src/main.ts`（仅为保持编译的调用迁移）

**Depends on:** T1

**Steps:**
1. 先写失败测试：账号 A、账号 B、本地暂存的记录和快照不能互相读取。
2. 先写失败测试：迁移跨越异步等待时，其他 scope 的保存不会改变迁移目标。
3. 把 `AccountStore` 改为每次调用显式传入 `DataScope`，删除 `setActiveAccount()` 和内部可变 scope。
4. 为旧记录补 `localRevision` 默认值，保持旧 key 和无前缀快照迁移。
5. 迁移主程序调用，保持当前行为可编译运行。

**Verification:** 运行 `pnpm test:unit -- account-store`；红灯测试转绿。运行完整 `pnpm test`、`pnpm build`。复查仓库中不再存在 `setActiveAccount`。

## T3: 封装并加固备份

**Files:** `src/backup.ts`、`tests/unit/backup.test.mjs`、`src/main.ts`

**Depends on:** T2

**Steps:**
1. 先写失败测试：包含引号、空白、控制字符或 HTML 属性字符的记录/快照 ID 被拒绝。
2. 先写失败测试：账号不匹配、重复引用、缺失快照和损坏附件不会改变现有数据。
3. 先写失败测试：整体恢复计划为当前存在但备份缺少的账号记录生成墓碑。
4. 将备份校验和恢复计划从 `main.ts` 移入 `BackupService`。
5. 所有 HTML 属性位置继续执行安全编码，形成双层防护。

**Verification:** 运行 `pnpm test:unit -- backup`；恶意夹具被拒绝，恢复计划符合字面预期。运行完整测试和构建，并用 `rg` 确认 `main.ts` 不再包含备份结构校验实现。

## T4: 增加服务器墓碑保护与持久文件清理任务

**Files:** `supabase/migrations/20260814120000_v02_sync_safety.sql`、`src/domain.ts`、`src/sync.ts`

**Depends on:** T2

**Steps:**
1. 新建 migration，不修改已经执行的 v0.1 migration。
2. 创建 `file_cleanup_jobs`、索引、唯一约束和账号 RLS。
3. 创建记录插入/更新触发器，为替换、移除或删除的文件生成延迟清理任务。
4. 创建墓碑保护触发器，阻止普通 upsert 清除既有 `deleted_at`。
5. 扩展 `SyncAdapter` 读取和确认清理任务；远端映射排除所有本地状态字段。

**Verification:** 本地执行 SQL 静态检查和 TypeScript 构建；在 Supabase SQL Editor 执行 migration 后，查询表、触发器和 RLS；使用两个账号验证无法读取对方任务。

## T5: 实现无丢更新的单飞同步核心

**Files:** `src/sync-coordinator.ts`、`tests/unit/sync-coordinator.test.mjs`、`tests/helpers/sync-fakes.mjs`、`src/sync-engine.ts`

**Depends on:** T2、T4

**Steps:**
1. 先写失败测试：两个同时触发的同步只运行一个远端 pass，并合并后续请求。
2. 先写失败测试：同步网络等待期间新增编辑，旧结果不能覆盖更高 `localRevision`。
3. 先写失败测试：`stop()` 后旧账号 pass 不能写本地或通知新界面。
4. 实现账号绑定的 `SyncCoordinator`、单飞队列、停止令牌和 revision 合并。
5. 删除被完整替代的 `sync-engine.ts`。

**Verification:** 运行 `pnpm test:unit -- sync-coordinator`，重复运行三次确保确定性；运行完整测试和构建。人工检查所有本地提交前都有停止令牌判断。

## T6: 分离元数据与文件传输

**Files:** `src/domain.ts`、`src/sync-coordinator.ts`、`tests/unit/sync-coordinator.test.mjs`、`src/sync.ts`

**Depends on:** T5

**Steps:**
1. 先写失败测试：一个远端附件下载失败时，新文字记录仍然保存并返回。
2. 先写失败测试：多个文件任务中一个失败不会取消其余成功任务。
3. 先写失败测试：删除墓碑先成功写入远端，再执行 Storage 文件删除。
4. 实现确定性且不主动复用的附件对象路径、传输状态和逐项文件处理。
5. 实现云端清理任务处理；仍被活跃记录引用的路径不得删除，失败任务留待重试。

**Verification:** 运行文件阶段相关测试；断言元数据保存发生在文件下载/删除之前。运行完整测试和构建。

## T7: 自动轮询与退避重试

**Files:** `src/sync-coordinator.ts`、`tests/unit/sync-coordinator.test.mjs`、`tests/helpers/test-clock.mjs`

**Depends on:** T5、T6

**Steps:**
1. 使用可控测试时钟先写失败测试：15 秒轮询会拉取远端变化且不会并行。
2. 先写失败测试：失败后按 2/5/15/30/60 秒退避，成功后重置。
3. 先写失败测试：`online` 或页面重新可见会立即触发一次合并同步。
4. 实现 start/notify/syncNow/stop 生命周期及状态通知。

**Verification:** 运行可控时钟测试，不使用真实等待；完整测试重复运行三次，无悬挂计时器或随机失败。

## T8: 完成密码恢复与账号生命周期

**Files:** `src/auth.ts`、`src/account-controller.ts`、`tests/unit/account-controller.test.mjs`

**Depends on:** T5

**Steps:**
1. 先写失败测试：`PASSWORD_RECOVERY` 进入恢复状态。
2. 先写失败测试：两次密码不一致、密码过短和更新失败都有明确反馈。
3. 先写失败测试：退出时先停止旧协调器，再清理旧账号缓存。
4. 扩展 Auth adapter 并实现 AccountController。

**Verification:** 运行 `pnpm test:unit -- account-controller`、完整测试和构建；检查测试通过公开 interface 观察行为。

## T9: 接入主界面与手机端账号入口

**Files:** `src/main.ts`、`src/style.css`

**Depends on:** T3、T5、T6、T7、T8

**Steps:**
1. 用 AccountController、BackupService 和 SyncCoordinator 替换 `main.ts` 中对应实现。
2. 增加密码恢复表单、文件传输失败/待重试状态和账号恢复提示。
3. 把备份入口同时放入账号窗口；在 320px 以上始终显示账号入口。
4. 账号备份导入执行在线预同步；失败时不更改本地数据。
5. 删除不再使用的全局同步 timer、可变账号 scope 和重复校验代码。

**Verification:** 运行完整测试和构建；在 320px、390px、820px 和桌面宽度检查账号入口、弹窗和记录布局；控制台无 error/warning。

## T10: 云端迁移与真实双客户端回归

**Files:** `supabase/migrations/20260814120000_v02_sync_safety.sql`、`.env.local`（只读使用，不提交）

**Depends on:** T4、T9

**Steps:**
1. 在用户现有 Supabase 项目执行 v0.2 migration。
2. 验证墓碑不能被旧客户端普通更新清除。
3. 验证附件替换/删除产生清理任务，处理成功后对象消失、任务归零。
4. 两个独立客户端保持打开，验证 30 秒内新增、编辑和删除同步。
5. 模拟一次网络失败，验证恢复后 60 秒内自动完成同步。

**Verification:** 保存 SQL 查询结果和双客户端观察结果到 `docs/v0.2/progress.md`，不记录任何密钥。

## T11: 文档、全量验收与最终复查

**Files:** `README.md`、`CONTEXT.md`、`docs/account-sync-contract.md`、`docs/backup-contract.md`、`docs/web-snapshot-contract.md`、`docs/v0.2/progress.md`

**Depends on:** T10

**Steps:**
1. 更新已实现能力、同步顺序、失败状态、恢复限制和下一版本方向。
2. 逐项执行 `checklist.md`，记录实际证据。
3. 运行 `pnpm test`、`pnpm build`、`git diff --check` 和密钥扫描。
4. 审查全部改动，确认没有调试日志、临时夹具、失效文档或未处理失败项。

**Verification:** checklist 全部勾选，测试和构建通过，Git 仅包含预期文件，`.env.local` 继续被忽略。

## Execution Order

```text
T1 -> T2 -> T3
          \-> T4 -> T5 -> T6 -> T7
                         \-> T8
T3 + T7 + T8 -> T9 -> T10 -> T11
```

每个任务严格执行“失败测试 → 最小实现 → 测试/构建 → diff 复查 → 记录结果”后才进入下一任务。
