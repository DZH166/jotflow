# Supabase 账号服务配置

## 项目归属

Supabase 项目应由“小董随心录”拥有者自己的 Supabase 账号创建和管理。前端只使用项目的 URL 与 anon key；`service_role` key 只能保留在受信任的服务端或定时任务中。

## 配置步骤

1. 创建 Supabase 项目，并在 Authentication 中启用 Email 登录与确认邮件。
2. 在 SQL Editor 执行 `supabase/migrations/20260811220000_account_sync.sql`。
3. 将 `.env.example` 复制为 `.env.local`，填入项目 URL 和匿名公钥。
4. 将本地地址与未来正式域名加入 Authentication 的 Redirect URLs。
5. 启动 `pnpm dev`，使用账号窗口注册并完成邮箱验证。

## 数据安全

- 所有记录表查询均受 `auth.uid() = owner_id` 的 RLS 策略限制。
- 附件和快照桶均为私有桶，文件路径第一层必须等于当前账号 ID。
- 前端不能持有 service role key，也不能绕过 RLS。

## 注销任务

迁移文件只记录注销请求和 30 天到期时间。正式上线前需要在 Supabase Edge Function 或其他受信任定时任务中执行到期账号的物理删除；该任务必须使用 service role key，不能放在浏览器端。
