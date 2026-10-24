-- Discord 사운드보드 — 초기 스키마
-- 기준 문서: Notion 업무 보드 > ERD
-- 접근 방식: 서버만 service_role 키로 접근. 모든 테이블 RLS 활성화 + 정책 없음 = anon/authenticated 기본 거부.

create extension if not exists "pgcrypto";

-- Discord 사용자 (Supabase Auth 미사용)
create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  discord_user_id text not null unique,
  username text not null,
  avatar_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 서버별 정책 (봇이 서버에 추가될 때 기본값으로 생성)
create table public.guild_settings (
  guild_id text primary key,
  max_file_size_bytes bigint not null default 1048576,   -- 1MB
  max_duration_seconds integer not null default 15,
  max_queue_size integer not null default 10,
  max_requests_per_user integer not null default 3,
  allow_member_upload boolean not null default true,
  manager_role_id text,                                  -- null이면 Manage Server 권한자만 관리
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (max_file_size_bytes > 0),
  check (max_duration_seconds > 0),
  check (max_queue_size > 0),
  check (max_requests_per_user > 0)
);

create table public.sound_categories (
  id uuid primary key default gen_random_uuid(),
  guild_id text not null references public.guild_settings(guild_id) on delete cascade,
  name text not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (guild_id, name)
);

create table public.sounds (
  id uuid primary key default gen_random_uuid(),
  guild_id text not null references public.guild_settings(guild_id) on delete cascade,
  category_id uuid references public.sound_categories(id) on delete set null,
  name text not null check (char_length(name) between 1 and 50),
  storage_path text not null unique,                     -- {guild_id}/{id}.ogg
  mime_type text not null default 'audio/ogg',
  duration_seconds numeric(6,2) not null,
  file_size_bytes bigint not null,
  visibility text not null default 'guild' check (visibility in ('private', 'guild')),
  play_count integer not null default 0,
  uploaded_by uuid not null references public.profiles(id),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index sounds_guild_created_idx on public.sounds (guild_id, created_at desc) where deleted_at is null;
create index sounds_guild_category_idx on public.sounds (guild_id, category_id) where deleted_at is null;
create index sounds_guild_name_idx on public.sounds (guild_id, name) where deleted_at is null;

-- 재생 이력 (실시간 큐는 봇 메모리, 이 테이블은 기록용)
create table public.playback_requests (
  id uuid primary key default gen_random_uuid(),
  guild_id text not null,
  sound_id uuid not null references public.sounds(id),
  requested_by uuid not null references public.profiles(id),
  voice_channel_id text,
  status text not null check (status in ('queued', 'playing', 'completed', 'failed', 'cancelled', 'skipped')),
  error_code text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create index playback_requests_guild_created_idx on public.playback_requests (guild_id, created_at desc);

-- 재생 완료 시 play_count를 원자적으로 증가 (서버에서 rpc로 호출)
create or replace function public.increment_play_count(p_sound_id uuid)
returns void
language sql
security invoker
set search_path = public
as $$
  update public.sounds set play_count = play_count + 1 where id = p_sound_id;
$$;
revoke execute on function public.increment_play_count(uuid) from public, anon, authenticated;
grant execute on function public.increment_play_count(uuid) to service_role;

-- RLS: 켜기만 하고 정책은 만들지 않음 (기본 거부)
alter table public.profiles enable row level security;
alter table public.guild_settings enable row level security;
alter table public.sound_categories enable row level security;
alter table public.sounds enable row level security;
alter table public.playback_requests enable row level security;

-- Storage 버킷: 비공개
insert into storage.buckets (id, name, public)
values ('sounds', 'sounds', false)
on conflict (id) do nothing;
