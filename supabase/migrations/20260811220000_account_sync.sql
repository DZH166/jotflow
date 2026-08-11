create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.records (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('thought', 'link', 'image', 'file')),
  content text not null,
  title text,
  source text,
  attachment jsonb,
  snapshot jsonb,
  pinned boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  deleted_at timestamptz
);

create index if not exists records_owner_updated_at_idx on public.records (owner_id, updated_at);

create or replace function public.set_record_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists records_set_updated_at on public.records;
create trigger records_set_updated_at
before insert or update on public.records
for each row execute procedure public.set_record_updated_at();

alter table public.profiles enable row level security;
alter table public.records enable row level security;

drop policy if exists "profiles are private" on public.profiles;
create policy "profiles are private" on public.profiles
for all using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "records are private" on public.records;
create policy "records are private" on public.records
for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', false), ('snapshots', 'snapshots', false)
on conflict (id) do update set public = false;

drop policy if exists "account owns attachment objects" on storage.objects;
create policy "account owns attachment objects" on storage.objects
for all to authenticated
using (bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text)
with check (bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "account owns snapshot objects" on storage.objects;
create policy "account owns snapshot objects" on storage.objects
for all to authenticated
using (bucket_id = 'snapshots' and (storage.foldername(name))[1] = auth.uid()::text)
with check (bucket_id = 'snapshots' and (storage.foldername(name))[1] = auth.uid()::text);

create table if not exists public.account_deletion_requests (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  requested_at timestamptz not null default timezone('utc', now()),
  purge_after timestamptz not null default timezone('utc', now()) + interval '30 days'
);

alter table public.account_deletion_requests enable row level security;

drop policy if exists "account manages its deletion request" on public.account_deletion_requests;
create policy "account manages its deletion request" on public.account_deletion_requests
for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
