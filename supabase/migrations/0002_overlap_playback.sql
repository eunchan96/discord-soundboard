-- 대기열 방식 → 겹쳐 재생 방식으로 변경 (2026-10-25)
-- max_queue_size(대기열 길이)  → max_concurrent_sounds(서버 전체 동시 재생 수, 기본 8)
-- max_requests_per_user(1인 대기 수) → max_concurrent_per_user(1인 동시 재생 수, 기본 3)

alter table public.guild_settings rename column max_queue_size to max_concurrent_sounds;
alter table public.guild_settings rename column max_requests_per_user to max_concurrent_per_user;
alter table public.guild_settings alter column max_concurrent_sounds set default 8;

-- 기본값 그대로 쓰던 서버만 새 기본값으로
update public.guild_settings set max_concurrent_sounds = 8 where max_concurrent_sounds = 10;
