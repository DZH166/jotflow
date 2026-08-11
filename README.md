# 小董随心录

一个安静的个人信息捕捉与找回工具。

小董随心录用于保存随想、链接、图片和资料。第一版只专注一件事：现在记下，以后找回。

## Current vertical slice

- Create a thought, link, image, or file record.
- Browse records in a chronological inbox.
- Search using imperfect clues.
- Edit records, manage attachments, pin records, and confirm before deletion.
- Persist records locally in the browser.
- Import MHTML web archives, read saved pages in a sandboxed offline reader, and keep archive files in IndexedDB.
- Export and restore a complete local backup containing records, attachments, and web snapshots.
- Keep a local draft collection until an account is connected.
- Provide Supabase-ready email authentication, account-scoped storage, private file paths, and offline-first sync.

## Run

```bash
pnpm install
pnpm dev
```

The app keeps working as a local draft collection until Supabase is configured. Follow `docs/supabase-setup.md` to enable real email accounts and cross-device sync. See `docs/backup-contract.md` for backup behavior and `docs/account-sync-contract.md` for the account data contract.
