import { Router } from "express";
import { PermissionFlagsBits } from "discord.js";
import type { PlaybackRequestBody, PlaybackRequestResponse } from "@soundboard/shared";
import { bot, getUserVoiceChannelId } from "../bot/client.ts";
import { requireGuild, requireManage } from "../context.ts";
import { ensureGuildSettings } from "../guilds.ts";
import { sendError } from "../http.ts";
import { PlaybackError, getState, play, stopAll } from "../player.ts";
import { getSound } from "../sounds.ts";

export const playbackRouter = Router({ mergeParams: true });
playbackRouter.use(requireGuild);

// POST /guilds/:guildId/playback-requests { soundId } — 누르는 즉시 재생, 다른 소리와 겹쳐 섞임
playbackRouter.post("/playback-requests", async (req, res) => {
  const { guildId, profileId } = req.ctx!;
  const user = req.user!;
  const { soundId } = (req.body ?? {}) as Partial<PlaybackRequestBody>;
  if (!soundId) return sendError(res, "VALIDATION_ERROR", "soundId가 필요합니다.");

  // 요청자의 실제 음성 채널은 봇이 보는 voice state로 확인 (FR-14)
  const channelId = getUserVoiceChannelId(guildId, user.id);
  const guild = bot.guilds.cache.get(guildId)!;
  const channel = channelId ? guild.channels.cache.get(channelId) : undefined;
  if (!channel?.isVoiceBased()) {
    return sendError(res, "NOT_IN_VOICE_CHANNEL", "음성 채널에 들어온 뒤 다시 시도해 주세요.");
  }

  const me = guild.members.me;
  const perms = me ? channel.permissionsFor(me) : null;
  if (!perms?.has([PermissionFlagsBits.Connect, PermissionFlagsBits.Speak])) {
    return sendError(res, "BOT_NOT_AVAILABLE", "봇에게 이 채널의 연결·말하기 권한이 없어요.");
  }

  const sound = await getSound(guildId, soundId, profileId);
  if (!sound) return sendError(res, "NOT_FOUND", "사운드를 찾을 수 없어요.");

  const settings = await ensureGuildSettings(guildId);
  try {
    const result = await play(guildId, settings, {
      channel,
      sound: {
        id: sound.id,
        name: sound.name,
        durationSeconds: Number(sound.duration_seconds),
        storagePath: sound.storage_path,
      },
      requestedBy: {
        id: user.id,
        username: user.global_name ?? user.username,
        avatarUrl: user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png` : null,
      },
      requesterProfileId: profileId,
    });
    res.status(202).json(result satisfies PlaybackRequestResponse);
  } catch (err) {
    if (err instanceof PlaybackError) return sendError(res, err.code, err.message);
    throw err;
  }
});

// GET /guilds/:guildId/playback-requests/state
playbackRouter.get("/playback-requests/state", (req, res) => {
  res.json(getState(req.ctx!.guildId));
});

// POST /guilds/:guildId/playback-requests/stop — 관리자: 전부 멈추고 퇴장
playbackRouter.post("/playback-requests/stop", requireManage, (req, res) => {
  stopAll(req.ctx!.guildId);
  res.status(204).end();
});
