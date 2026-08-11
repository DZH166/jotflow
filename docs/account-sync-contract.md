# 账号与同步契约

## 前端认证接口

```ts
type AuthSession = {
  userId: string
  email: string
  accessToken: string
  expiresAt: string
}

interface AuthAdapter {
  getSession(): Promise<AuthSession | null>
  signUp(email: string, password: string): Promise<'verification-required' | 'signed-in'>
  signIn(email: string, password: string): Promise<AuthSession>
  signOut(scope: 'current-device' | 'all-devices'): Promise<void>
  requestPasswordReset(email: string): Promise<void>
  onSessionChanged(listener: (session: AuthSession | null) => void): () => void
}
```

页面只能依赖这些行为，不直接依赖 Supabase SDK。

## 本地隔离

- 未登录数据使用独立的本地暂存命名空间。
- 登录账号的数据使用 `account:<userId>` 命名空间。
- 退出账号时清理该账号的本地缓存和待上传队列，不清理其他账号或本地暂存。
- 当前设备同时只允许一个 active account。

## 云端最小数据模型

```sql
records(
  id uuid primary key,
  owner_id uuid not null references auth.users(id),
  type text not null,
  content text not null,
  title text,
  source text,
  attachment jsonb,
  snapshot jsonb,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz
)
```

`owner_id` 是所有查询、写入和删除策略的第一条件。`updated_at` 由服务端确认，用于当前版本的 latest-write-wins 规则。

## 文件对象

普通附件和 MHTML 快照存储在 Storage，路径必须包含 `owner_id`。记录元数据先同步，文件对象异步同步；文件未完成下载时，界面显示“仅在线可用”，不能伪装成离线可读。
