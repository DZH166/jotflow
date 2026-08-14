# 小董随心录 v0.2 稳定核心 Plan

## Architecture Overview

v0.2 保留 Vite、原生 TypeScript 和 Supabase，不进行前端框架重写。调整重点是把当前集中在 `main.ts` 的账号范围、同步状态机、备份恢复和认证恢复逻辑收进可独立验证的深模块。

```text
App UI (`main.ts`)
  ├─ Account module ────────────── Supabase Auth adapter
  ├─ Backup module
  ├─ Account-scoped SyncCoordinator
  │    ├─ explicit-scope AccountStore ─ localStorage / IndexedDB
  │    └─ SyncAdapter ─────────────── Supabase Postgres / Storage
  └─ Snapshot reader

Windows / Android browser
  └─ 同一套 App UI；320px 以上始终保留账号入口
```

同步协调器在创建时绑定不可变的 `accountId`，界面不能在协调器运行期间改变其数据范围。退出或切换账号时先停止旧协调器、使进行中的提交失效，再清理旧账号缓存。

## Core Data Structures and Interfaces

### DataScope

继续使用现有领域词汇，但从 `AccountStore` 的内部可变状态改为每次调用显式传入：

```ts
type DataScope =
  | { kind: 'local' }
  | { kind: 'account'; accountId: string }
```

`DataScope` 是本地记录、附件和网页快照所有读写的必填参数。不存在隐式“当前 scope”。

### Local sync metadata

```ts
type FileTransferState = 'pending-upload' | 'pending-download' | 'available' | 'error'

type StorageObjectRef = {
  bucket: 'attachments' | 'snapshots'
  path: string
}

type RecallRecord = {
  // 现有业务字段保持不变
  localRevision: number
  syncState?: 'pending' | 'synced'
}
```

- `localRevision` 每次本地业务修改单调增加，用于判断同步开始后记录是否又被修改；它只保存在本地，不发送到 Supabase。
- 附件和快照增加本地 `transferState`；附件获得一次生成、不会主动复用的对象 ID。两者都不把本地传输状态写入远端 JSON 元数据。
- 旧文件清理由云端 `file_cleanup_jobs` 持久化，避免退出账号或更换设备后任务丢失。
- 旧版本记录缺少这些字段时，由 `AccountStore` 在读取时补默认值，保持现有数据兼容。

### AccountStore interface

```ts
interface ScopedAccountStore {
  loadRecords(scope: DataScope, fallback?: RecallRecord[]): RecallRecord[]
  saveRecords(scope: DataScope, records: RecallRecord[]): void
  storeSnapshot(scope: DataScope, id: string, file: Blob): Promise<void>
  getSnapshot(scope: DataScope, id: string): Promise<Blob | undefined>
  removeSnapshot(scope: DataScope, id: string): Promise<void>
  listSnapshots(scope: DataScope): Promise<StoredSnapshot[]>
  replaceSnapshots(scope: DataScope, snapshots: StoredSnapshot[]): Promise<void>
  copyLocalCollectionToAccount(accountId: string): Promise<number>
  clearLocalCollection(): Promise<void>
  clearAccountCache(accountId: string): Promise<void>
}
```

测试接缝一：只通过这个 interface 验证账号范围隔离、迁移和清理，不读取私有字段。

### SyncCoordinator interface

```ts
type SyncStatus = 'offline' | 'syncing' | 'synced' | 'retrying' | 'error'

interface AccountSyncCoordinator {
  start(): void
  notifyLocalChange(): void
  syncNow(): Promise<SyncReport>
  stop(): Promise<void>
}
```

构造时注入不可变账号范围、`ScopedAccountStore`、`SyncAdapter`、在线状态函数和状态监听器。内部负责：

- 单飞互斥：同一账号只有一个同步 pass，多次请求合并为一次后续 pass。
- 停止令牌：`stop()` 后未完成的旧 pass 不得再写本地或通知界面。
- 15 秒前台轮询，并监听本地变更、`online` 和页面重新可见事件。
- 失败重试采用 2、5、15、30、60 秒退避；新触发会提前执行但不会并行。
- 每次提交前后重新读取当前本地记录，用 `localRevision` 保留同步期间的新编辑。
- 元数据先提交并落入本地；二进制上传、下载和清理随后独立处理。

测试接缝二：通过 `AccountSyncCoordinator` 的四个公开行为，配合内存 `SyncAdapter` 和可控测试时钟验证 AC1 至 AC6 及 AC11；不测试私有合并函数。

### SyncAdapter additions

保留现有记录和 Storage 方法，增加持久化文件清理任务：

```ts
type FileCleanupJob = StorageObjectRef & {
  id: string
  recordId: string
}

interface SyncAdapter {
  pullRecords(accountId: string): Promise<RecallRecord[]>
  pushRecords(accountId: string, records: RecallRecord[]): Promise<RecallRecord[]>
  uploadFile(...): Promise<void>
  downloadFile(...): Promise<Blob>
  removeFile(...): Promise<void>
  pullCleanupJobs(accountId: string): Promise<FileCleanupJob[]>
  completeCleanupJob(accountId: string, jobId: string): Promise<void>
}
```

生产 adapter 使用 Supabase；测试 adapter 使用内存实现，因此这个 seam 同时有真实和测试两个 adapter。

### Backup module interface

```ts
interface BackupService {
  validate(value: unknown): RecallBackup
  createRestorePlan(input: RestoreInput): RestorePlan
}
```

- `validate` 严格验证记录和快照 ID、字段、URL、附件 data URL、重复引用和大小。
- ID 允许现有演示记录格式和 UUID，但禁止引号、空白、控制字符及 HTML 属性字符。
- `createRestorePlan` 返回目标记录、快照以及需要生成墓碑的旧记录，不直接操作 DOM。
- 账号备份恢复前先执行一次远端同步；若离线或预同步失败，恢复不会修改当前数据，并显示可理解提示。这样可以准确知道哪些云端旧记录需要墓碑。纯本地备份仍可离线恢复。

测试接缝三：通过 `validate` 和 `createRestorePlan` 验证恶意备份、完整替换和同账号限制。

### Auth event interface

```ts
type AuthEvent = 'session-changed' | 'password-recovery'

interface AuthAdapter {
  // 保留现有方法
  updatePassword(password: string): Promise<void>
  onAuthEvent(listener: (event: AuthEvent, session: AuthSession | null) => void): () => void
}
```

Supabase 的 `PASSWORD_RECOVERY` 事件进入独立恢复模式。页面显示新密码和确认密码，成功后退出恢复模式并允许重新登录。

账号编排使用以下页面级 interface：

```ts
interface AccountController {
  initialize(): Promise<void>
  getState(): AccountViewState
  requestPasswordReset(email: string): Promise<void>
  updateRecoveredPassword(password: string, confirmation: string): Promise<void>
  signOut(scope: 'current-device' | 'all-devices'): Promise<void>
  subscribe(listener: (state: AccountViewState) => void): () => void
}
```

测试接缝四：使用内存 Auth adapter，通过公开账号控制器行为验证恢复事件、密码一致性和错误反馈；真实邮件链接在最终集成验收中验证。

## Module Design

### AccountStore

**Responsibility:** 保存不同账号范围的记录和快照，迁移旧格式，提供事务化快照替换与缓存清理。

**Public interface:** `ScopedAccountStore`。

**Dependencies:** Web Storage、IndexedDB。生产环境使用浏览器实现；测试通过注入的内存 Storage 和内存快照 adapter 观察相同公开 interface。

### SyncCoordinator

**Responsibility:** 串行化同步、合并并发本地编辑、调度轮询与退避重试、先提交元数据、独立处理文件传输和清理任务。

**Public interface:** `AccountSyncCoordinator`。

**Dependencies:** `ScopedAccountStore`、`SyncAdapter`、计时器、在线状态和状态监听器。

同步 pass 固定为以下顺序：

1. 读取当前账号范围和待同步记录，记录各自 `localRevision`。
2. 为待上传二进制生成确定性 Storage 路径，但不阻塞元数据提交。
3. 推送待同步记录并拉取远端记录。
4. 重新读取最新本地状态：远端墓碑优先；同步期间产生的新 revision 保持 pending；其余使用服务端结果。
5. 保存记录并立即通知界面，使文字先可见。
6. 对附件和快照逐项执行上传或下载；使用独立错误状态，一个失败不终止其他任务。
7. 拉取并执行文件清理任务；失败任务留在云端供下一轮重试。
8. 若同步期间出现新 revision 或新触发，立即再运行一次串行 pass。

### SupabaseSyncAdapter

**Responsibility:** 映射本地领域对象与 Postgres 行、访问私有 Storage、读取和确认清理任务。

**Public interface:** `SyncAdapter`。

**Dependencies:** Supabase JavaScript client。

远端映射明确排除 `dataUrl`、`localRevision` 和 `transferState`，避免把本地缓存状态写入云端。

### BackupService

**Responsibility:** 备份校验、同账号限制和整体恢复计划计算。

**Public interface:** `validate`、`createRestorePlan`。

**Dependencies:** 领域类型；不依赖 DOM、Supabase 或浏览器下载。

### AccountController

**Responsibility:** 把认证事件转换成登录、退出、密码恢复等页面状态；退出时先停止旧账号同步，再清理缓存。

**Public interface:** 页面所需的账号动作和状态订阅。

**Dependencies:** `AuthAdapter`、`AccountSyncCoordinator`、`ScopedAccountStore`。

### App UI

**Responsibility:** 渲染、收集用户输入、展示同步和错误状态。

**Public interface:** DOM 事件。

**Dependencies:** 上述模块。`main.ts` 不再自行实现同步合并、备份解析或认证事件解释。所有进入 HTML 文本和属性位置的动态值仍分别执行上下文安全编码，即使数据已经通过备份校验，也保留第二层防护。

## Supabase Migration Design

新增一份只向前迁移的 SQL 文件，不修改已执行的 v0.1 migration：

- 创建私有 `file_cleanup_jobs` 表，字段包括 `id`、`owner_id`、`record_id`、`bucket`、`path`、`created_at`、`not_before`，并建立 owner/path 唯一约束和 RLS。任务至少延迟一段安全窗口后才可执行。
- 创建 records 插入/更新触发器：当附件或快照路径被替换、移除，或记录首次以墓碑状态写入/进入删除状态时，自动写入清理任务；任务与记录写入位于同一数据库事务。
- 创建墓碑保护触发器：已有 `deleted_at` 的记录不能被普通非删除 upsert 清空删除状态。
- 清理任务只允许所属账号读取和确认；Storage 仍由现有私有 bucket 策略保护。
- 客户端删除文件前重新检查当前非删除记录是否仍引用相同路径；仍被引用时只确认过期任务，不删除文件。新附件路径包含一次性对象 ID，正常替换不会复用旧路径。

## Module Interactions

### Local edit and sync

```text
UI edit
  -> AccountStore.saveRecords(explicit account scope)
  -> localRevision + 1, syncState = pending
  -> SyncCoordinator.notifyLocalChange()
  -> serialized sync pass
  -> metadata visible
  -> binary transfers continue independently
```

### Account switch or sign-out

```text
Auth event
  -> old SyncCoordinator.stop()
  -> invalidate old writes/listeners
  -> clear old account cache
  -> create coordinator bound to the new account scope (if any)
```

### Account backup restore

```text
Validate file
  -> syncNow() preflight
  -> createRestorePlan(current cloud-aligned state, backup)
  -> transactional local snapshot replacement
  -> save backup records + tombstones for excluded records
  -> notifyLocalChange()
```

### Password recovery

```text
Reset email link
  -> Supabase PASSWORD_RECOVERY event
  -> AccountController recovery state
  -> user enters and confirms new password
  -> AuthAdapter.updatePassword()
  -> success feedback and normal signed-in state
```

## File Organization

| Operation | File | Responsibility |
|---|---|---|
| Modify | `src/domain.ts` | 本地 revision、文件传输和清理任务领域类型 |
| Modify | `src/account-store.ts` | 改为显式 DataScope，保持旧数据迁移 |
| Create | `src/sync-coordinator.ts` | 同步互斥、合并、重试、轮询、文件阶段 |
| Modify | `src/sync.ts` | Supabase 映射及清理任务 adapter |
| Remove after replacement | `src/sync-engine.ts` | 由深层 SyncCoordinator 完整替代 |
| Create | `src/backup.ts` | 不可信备份校验与恢复计划 |
| Modify | `src/auth.ts` | 密码恢复事件和更新密码 |
| Create | `src/account-controller.ts` | 账号生命周期与恢复状态编排 |
| Modify | `src/main.ts` | 使用新模块、简化全局同步和备份逻辑 |
| Modify | `src/style.css` | 手机端账号入口及恢复表单布局 |
| Create | `supabase/migrations/20260814120000_v02_sync_safety.sql` | 墓碑保护和持久文件清理任务 |
| Modify | `package.json` | Node 24 内置测试脚本 |
| Create | `tests/unit/*.test.mjs` | 按批准的四个测试接缝建立行为测试 |
| Create | `tests/helpers/*.mjs` | 内存 Storage、快照 adapter、远端 adapter 和测试时钟 |
| Modify | `README.md`、`docs/*.md` | 更新实际能力和限制 |
| Create | `docs/v0.2/progress.md` | 逐步审查和最终验收记录 |

## Requirement Traceability

| Requirement | Architectural home |
|---|---|
| F1 | 显式 `DataScope` + `AccountStore` |
| F2、F3、F11 | `SyncCoordinator` 单飞、轮询和退避 |
| F4 | `SyncCoordinator` 元数据阶段与独立文件阶段 |
| F5 | 墓碑保护 SQL + 合并规则 |
| F6 | `file_cleanup_jobs` + Storage 清理流程 |
| F7 | `BackupService.createRestorePlan` + 预同步 |
| F8 | `BackupService.validate` + 安全属性编码 |
| F9 | Auth event + `AccountController` |
| F10 | App UI + 响应式 CSS |
| F12 | README、契约和 `progress.md` |

## Technical Decisions

| Decision | Choice | Rationale |
|---|---|---|
| 数据范围 | 每次调用显式传入，并为每个账号创建独立协调器 | 从结构上消除跨 `await` 的 scope 串写 |
| 同步并发 | 单飞协调器 + revision 合并 | 防止重叠同步旧结果覆盖新编辑 |
| 自动拉取 | 前台每 15 秒轮询，并结合 local/online/visibility 事件 | 简单、可测试，能满足 30 秒验收；代价是有少量周期请求 |
| 暂不采用 Supabase Realtime | 留作用户规模扩大后的优化 | 当前单用户轮询更易验证，避免新增订阅生命周期和断线状态 |
| 失败恢复 | 2/5/15/30/60 秒退避 | 瞬时故障快速恢复，同时限制持续请求 |
| 文件顺序 | 元数据先保存，文件逐项后台处理 | 单个文件失败不阻断文字记录 |
| 文件清理 | 数据库触发器生成持久清理任务 | 任务不会因退出或设备更换丢失 |
| 墓碑 | 数据库触发器阻止普通更新清除删除状态 | 服务器原子保证，避免客户端竞态复活记录 |
| 账号备份恢复 | 在线预同步后生成差异墓碑 | 保证整体替换；代价是账号恢复需要网络，纯本地恢复仍可离线 |
| 测试 | Node 24 内置 test runner + 内存 adapters + 可控测试时钟 | 当前包源不可访问；无需新增依赖或真实密钥，仍通过公开 interface 覆盖完整状态机 |
| 前端技术栈 | 继续原生 TypeScript | 本版本风险来自状态和数据模型，框架重写不会直接解决问题 |

## Rejected Alternatives

- **Supabase Realtime 立即替代轮询：** 更新更快，但增加订阅重连、标签页生命周期和测试复杂度；v0.2 先采用 15 秒轮询。
- **继续保留 `AccountStore.setActiveAccount()`：** 改动更少，但无法从结构上证明异步操作不会串账号，因此拒绝。
- **只在客户端合并墓碑：** 无法覆盖两台设备同时 upsert 的数据库竞态，因此必须增加服务端保护。
- **离线执行账号备份整体恢复：** 需要持久恢复清单和跨多轮同步协议，超出本周期；v0.2 对账号恢复执行在线预同步。
- **立刻迁移 Vue/React：** 会扩大改动面，却不能自动解决同步、数据隔离和备份安全问题。
