import type { Sound } from "@soundboard/shared";
import { db, toUserSummary, unwrap, type ProfileRow } from "./db.ts";

const SOUND_COLUMNS =
  "id, guild_id, name, storage_path, duration_seconds, visibility, play_count, created_at, uploaded_by, deleted_at," +
  " category:sound_categories(id, name)," +
  " uploader:profiles(discord_user_id, username, avatar_hash)";

export interface SoundRow {
  id: string;
  guild_id: string;
  name: string;
  storage_path: string;
  duration_seconds: number | string;
  visibility: "private" | "guild";
  play_count: number;
  created_at: string;
  uploaded_by: string;
  deleted_at: string | null;
  category: { id: string; name: string } | null;
  uploader: Pick<ProfileRow, "discord_user_id" | "username" | "avatar_hash">;
}

export function toSound(row: SoundRow, viewerProfileId: string, canManage: boolean): Sound {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    durationSeconds: Number(row.duration_seconds),
    visibility: row.visibility,
    playCount: row.play_count,
    uploader: toUserSummary(row.uploader),
    createdAt: row.created_at,
    canEdit: canManage || row.uploaded_by === viewerProfileId,
  };
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export type SoundSort = "recent" | "popular" | "name";

export async function listSounds(
  guildId: string,
  viewerProfileId: string,
  opts: { q?: string; categoryId?: string; sort?: SoundSort },
): Promise<SoundRow[]> {
  let query = db
    .from("sounds")
    .select(SOUND_COLUMNS)
    .eq("guild_id", guildId)
    .is("deleted_at", null)
    // 서버 공개 사운드 + 내가 올린 비공개 사운드
    .or(`visibility.eq.guild,uploaded_by.eq.${viewerProfileId}`)
    .limit(300);

  if (opts.q) query = query.ilike("name", `%${escapeLike(opts.q)}%`);
  if (opts.categoryId) query = query.eq("category_id", opts.categoryId);

  if (opts.sort === "popular") query = query.order("play_count", { ascending: false });
  else if (opts.sort === "name") query = query.order("name", { ascending: true });
  else query = query.order("created_at", { ascending: false });

  return unwrap(await query) as unknown as SoundRow[];
}

/** 서버 범위 안의, 삭제되지 않았고 요청자가 볼 수 있는 사운드 하나. 없으면 null */
export async function getSound(guildId: string, soundId: string, viewerProfileId: string): Promise<SoundRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(soundId)) return null;
  const row = unwrap(
    await db
      .from("sounds")
      .select(SOUND_COLUMNS)
      .eq("guild_id", guildId)
      .eq("id", soundId)
      .is("deleted_at", null)
      .maybeSingle(),
  ) as unknown as SoundRow | null;
  if (!row) return null;
  if (row.visibility === "private" && row.uploaded_by !== viewerProfileId) return null;
  return row;
}
