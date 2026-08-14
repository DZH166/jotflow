# 小董随心录 v0.2 稳定核心 Checklist

## Implementation Completeness

- [ ] AC1：同步进行时产生的新编辑最终保留在本地和云端，没有被旧结果覆盖。（Verification：自动化并发同步场景比较最终记录内容与最后一次用户编辑。）
- [ ] AC2：账号 A 同步途中退出并进入账号 B 后，A 的任何记录、附件或快照都不出现在 B 或本地暂存。（Verification：自动化范围切换测试分别读取三个数据范围。）
- [ ] AC3：网络失败后待同步内容仍保留；恢复网络后 60 秒内自动同步成功，无需再次编辑。（Verification：可控测试时钟加真实浏览器断网/恢复观察。）
- [ ] AC4：附件下载失败不会阻止同批文字记录出现，附件显示失败或待重试状态。（Verification：自动化文件失败场景和页面状态观察。）
- [ ] AC5：设备 A 删除记录后，持有旧副本的设备 B 不能使记录重新可见；文件清理失败可在后续重试。（Verification：自动化墓碑场景加真实 Supabase 双客户端回归。）
- [ ] AC6：移除或替换附件后，旧对象最终清理，新附件可在另一客户端下载。（Verification：真实 Storage 对象和清理任务查询。）
- [ ] AC7：恢复只包含部分记录的账号备份后，多次同步结果仍与备份一致，旧云端记录不再出现。（Verification：自动化恢复计划测试加真实账号恢复回归。）
- [ ] AC8：恶意备份不能注入 HTML 属性、事件处理器或脚本；拒绝后原数据不变。（Verification：自动化恶意夹具和浏览器控制台观察。）
- [ ] AC9：找回邮件返回应用后可以设置新密码，并使用新密码重新登录。（Verification：真实邮箱恢复链路。）
- [ ] AC10：320px、390px 和桌面宽度均可找到账号入口并完成登录、注册或退出。（Verification：浏览器响应式检查。）
- [ ] AC11：两个在线客户端保持打开时，一端的新增、编辑和删除在 30 秒内出现在另一端。（Verification：计时的双客户端回归。）
- [ ] AC12：AC1 至 AC8 的核心逻辑都有自动化测试，真实双账号/双客户端回归通过。（Verification：测试清单和实际命令输出。）
- [ ] AC13：README、领域词汇、账号同步、备份、网页快照和 v0.2 进度文档与最终行为一致。（Verification：逐文件审阅并搜索过期说法。）

## Data Safety and Isolation

- [ ] 本地暂存、账号 A、账号 B 使用互不重叠的记录和快照命名空间。（Verification：范围隔离自动化测试。）
- [ ] 所有异步存储调用都有固定的数据范围，不依赖运行中可变化的当前账号。（Verification：代码审查和 `rg` 搜索旧 scope setter。）
- [ ] 退出账号后旧账号协调器不再写本地或更新界面，旧账号缓存被清理。（Verification：退出顺序自动化测试。）
- [ ] 原有 v0.1 本地记录、旧 key 和无前缀快照仍能读取并迁移。（Verification：兼容 fixture 测试。）
- [ ] `.env.local` 继续被 Git 忽略，前端和仓库中不存在 `service_role` 或管理员密钥。（Verification：`git check-ignore -v .env.local` 与密钥扫描。）

## Sync and Files

- [ ] 同一账号不会并行执行两个写入同步过程，多次触发会合并。（Verification：可控 adapter 的并发计数测试。）
- [ ] 记录元数据先保存并通知界面，二进制任务随后执行。（Verification：事件顺序断言。）
- [ ] 单个文件上传、下载或删除失败不会取消其他记录和文件任务。（Verification：混合成功/失败自动化测试。）
- [ ] 同步失败使用有限退避，成功后重置；停止后没有遗留计时器。（Verification：可控测试时钟。）
- [ ] 已删除记录不能被普通旧 upsert 清除墓碑。（Verification：Supabase SQL/双客户端测试。）
- [ ] 文件清理任务按账号隔离，失败时保留，成功后归零。（Verification：两个账号的 RLS 与清理回归。）

## Backup and Recovery

- [ ] 备份格式、版本、账号归属、ID、时间、附件、快照和引用均被校验。（Verification：有效与无效 fixture 参数化测试。）
- [ ] 备份恢复失败不会部分替换记录或快照。（Verification：注入存储失败并比较恢复前后数据。）
- [ ] 账号恢复预同步失败时不修改本地数据，并给出可理解提示。（Verification：远端失败场景。）
- [ ] 纯本地备份仍可在离线状态恢复。（Verification：离线本地范围测试。）

## Account and Responsive Experience

- [ ] 注册、邮箱确认、登录、持久会话、退出当前设备和退出所有设备保持可用。（Verification：真实账号回归。）
- [ ] 密码恢复状态只在有效恢复事件中出现，两次密码不一致或过短时不能提交。（Verification：账号控制器测试和浏览器表单检查。）
- [ ] 手机宽度下账号入口不被备份按钮或品牌区域挤出；账号窗口可滚动且操作按钮可点击。（Verification：320px、390px 截图和交互。）
- [ ] 同步状态能区分离线、同步中、已同步、等待重试和错误。（Verification：状态机测试和界面观察。）

## Integration

- [ ] 本地保存触发账号专属同步，远端结果只更新同一账号页面。（Verification：两账号集成测试。）
- [ ] 本地暂存迁移先完成云端同步，再清理本地原数据；失败时原数据保留。（Verification：成功和失败两条迁移路径。）
- [ ] 备份整体恢复、墓碑同步和文件清理可以连续完成，不需要手工修改数据库。（Verification：端到端恢复场景。）
- [ ] 网页快照在另一客户端先显示记录，文件完成后可离线打开；下载失败可重试。（Verification：双客户端快照场景。）

## Build and Test

- [ ] 所有 Node 行为测试通过。（Verification：运行 `pnpm test:unit`。）
- [ ] 浏览器扩展原有测试继续通过。（Verification：运行 `pnpm test:extension`。）
- [ ] 完整测试入口通过。（Verification：运行 `pnpm test`。）
- [ ] TypeScript 类型检查和生产构建通过。（Verification：运行 `pnpm build`。）
- [ ] 补丁没有空白错误。（Verification：运行 `git diff --check`。）
- [ ] 没有 `.only`、跳过的关键测试、调试日志或临时文件。（Verification：代码搜索和 Git 状态审查。）

## End-to-End Scenarios

- [ ] 场景一：账号 A 在客户端 1 新增带附件记录，客户端 2 在 30 秒内看到文字并随后下载附件；断网编辑后恢复网络，最终两端一致。（Verification：两个独立浏览器上下文计时执行。）
- [ ] 场景二：客户端 1 同步过程中退出账号 A 并登录账号 B；B 页面、本地暂存和导出备份都不包含 A 的内容。（Verification：实际 UI 操作并检查三个范围。）
- [ ] 场景三：客户端 1 删除记录，客户端 2 使用删除前旧状态同步；两端都保持删除，Storage 文件和清理任务最终归零。（Verification：UI、records 表、Storage 和清理表联合检查。）
- [ ] 场景四：账号中已有三条记录，恢复只含一条记录的同账号备份；重复刷新和同步后仍只显示备份中的一条。（Verification：账号备份恢复流程。）
- [ ] 场景五：用户请求密码重置、点击邮件链接、设置新密码并重新登录；手机宽度下整个过程可完成。（Verification：真实邮件和 390px 浏览器。）
