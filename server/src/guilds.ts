import { PermissionFlagsBits } from "discord.js";
import type { GuildSettings, MeResponse } from "@soundboard/shared";
import { bot } from "./bot/client.ts";
import { db, unwrap } from "./db.ts";

interface SettingsRow {
  guild_id: string;
  max_file_size_bytes: number;
  max_duration_seconds: number;
  max_queue_size: number;
  max_requests_per_user: number;
  allow_member_upload: boolean;
  manager_role_id: string | null;
}

const settingsCache = new Map<string, GuildSettings>();

function toSettings(r: SettingsRow): GuildSettings {
  return {
    maxFileSizeBytes: Number(r.max_file_size_bytes),
    maxDurationSeconds: r.max_duration_seconds,
    maxQueueSize: r.max_queue_size,
    maxRequestsPerUser: r.max_requests_per_user,
    allowMemberUpload: r.allow_member_upload,
    managerRoleId: r.manager_role_id,
  };
}

/** 서버 설정 행이 없으면 기본값으로 만듭니다. 봇 입장(guildCreate)과 첫 요청 때 호출됩니다. */
export async function ensureGuildSettings(guildId: string): Promise<GuildSettings> {
  const cached = settingsCache.get(guildId);
  if (cached) return cached;

  unwrap(await db.from("guild_settings").upsert({ guild_id: guildId }, { onConflict: "guild_id", ignoreDuplicates: true }));
  const row = unwrap(await db.from("guild_settings").select("*").eq("guild_id", guildId).single()) as SettingsRow;
  const settings = toSettings(row);
  settingsCache.set(guildId, settings);
  return settings;
}

export async function updateGuildSettings(guildId: string, patch: Partial<GuildSettings>): Promise<GuildSettings> {
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.maxFileSizeBytes !== undefined) row.max_file_size_bytes = patch.maxFileSizeBytes;
  if (patch.maxDurationSeconds !== undefined) row.max_duration_seconds = patch.maxDurationSeconds;
  if (patch.maxQueueSize !== undefined) row.max_queue_size = patch.maxQueueSize;
  if (patch.maxRequestsPerUser !== undefined) row.max_requests_per_user = patch.maxRequestsPerUser;
  if (patch.allowMemberUpload !== undefined) row.allow_member_upload = patch.allowMemberUpload;
  if (patch.managerRoleId !== undefined) row.manager_role_id = patch.managerRoleId;

  const updated = unwrap(
    await db.from("guild_settings").update(row).eq("guild_id", guildId).select("*").single(),
  ) as SettingsRow;
  const settings = toSettings(updated);
  settingsCache.set(guildId, settings);
  return settings;
}

export interface MemberAccess {
  isMember: boolean;
  canManage: boolean;
  canUpload: boolean;
}

/**
 * 봇이 보는 Discord 정보로 권한을 판단합니다. 클라이언트가 보낸 권한 값은 쓰지 않습니다 (NFR-3).
 * 관리자 = 서버 관리(Manage Server) 권한 또는 설정의 지정 역할 (FR-20)
 */
// GuildMembers(Privileged) 인텐트 없이는 역할 변경 이벤트가 오지 않으므로, 멤버 정보를 60초마다 새로 받아 권한 변경을 반영합니다.
const MEMBER_REFRESH_MS = 60_000;
const memberFetchedAt = new Map<string, number>();

export async function getMemberAccess(guildId: string, userId: string): Promise<MemberAccess> {
  const guild = bot.guilds.cache.get(guildId);
  if (!guild) return { isMember: false, canManage: false, canUpload: false };

  const key = `${guildId}:${userId}`;
  const force = Date.now() - (memberFetchedAt.get(key) ?? 0) > MEMBER_REFRESH_MS;
  const member = await guild.members.fetch({ user: userId, force }).catch(() => null);
  if (member && force) memberFetchedAt.set(key, Date.now());
  if (!member) return { isMember: false, canManage: false, canUpload: false };

  const settings = await ensureGuildSettings(guildId);
  const canManage =
    member.permissions.has(PermissionFlagsBits.ManageGuild) ||
    (settings.managerRoleId !== null && member.roles.cache.has(settings.managerRoleId));

  return { isMember: true, canManage, canUpload: canManage || settings.allowMemberUpload };
}

export async function getMe(guildId: string, userId: string, channelId: string | undefined): Promise<MeResponse> {
  const guild = bot.guilds.cache.get(guildId);
  const access = await getMemberAccess(guildId, userId);
  const userChannel = guild?.voiceStates.cache.get(userId)?.channelId ?? null;
  return {
    canUpload: access.canUpload,
    canManage: access.canManage,
    inVoiceChannel: userChannel !== null && (channelId === undefined || userChannel === channelId),
    botInGuild: Boolean(guild),
  };
}
