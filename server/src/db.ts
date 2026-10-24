import { createClient } from "@supabase/supabase-js";
import type { UserSummary } from "@soundboard/shared";
import { env } from "./env.ts";

// service_role 키: RLS를 우회하므로 서버에서만 사용합니다 (NFR-2, NFR-4)
export const db = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export const BUCKET = "sounds";

export class DbError extends Error {}

/** supabase-js의 { data, error }를 값 또는 예외로 바꿉니다. */
export function unwrap<T>(result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) throw new DbError(result.error.message);
  return result.data as T;
}

// ── profiles ──

export interface ProfileRow {
  id: string;
  discord_user_id: string;
  username: string;
  avatar_hash: string | null;
}

const profileIdCache = new Map<string, string>(); // discord_user_id → profiles.id

export async function upsertProfile(discordUserId: string, username: string, avatarHash: string | null) {
  const row = unwrap(
    await db
      .from("profiles")
      .upsert(
        { discord_user_id: discordUserId, username, avatar_hash: avatarHash, updated_at: new Date().toISOString() },
        { onConflict: "discord_user_id" },
      )
      .select("id")
      .single(),
  ) as { id: string };
  profileIdCache.set(discordUserId, row.id);
  return row.id;
}

export async function getProfileId(discordUserId: string, username: string, avatarHash: string | null) {
  return profileIdCache.get(discordUserId) ?? upsertProfile(discordUserId, username, avatarHash);
}

export function toUserSummary(p: Pick<ProfileRow, "discord_user_id" | "username" | "avatar_hash">): UserSummary {
  return {
    id: p.discord_user_id,
    username: p.username,
    avatarUrl: p.avatar_hash ? `https://cdn.discordapp.com/avatars/${p.discord_user_id}/${p.avatar_hash}.png` : null,
  };
}
