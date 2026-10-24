import { Router } from "express";
import type { PlaybackTestResponse } from "@soundboard/shared";
import { bot, getUserVoiceChannelId } from "../bot/client.ts";
import { TEST_SOUND_PATH } from "../bot/commands.ts";
import { playFile } from "../bot/voice.ts";
import { requireAuth, sendError } from "../http.ts";

export const playbackRouter = Router();

/**
 * M3 PoC 전용: Activity 버튼 → 서버 → 봇 재생까지의 지연을 잽니다.
 * M4에서 POST /guilds/{guildId}/playback-requests (큐 등록)로 대체합니다.
 */
playbackRouter.post("/guilds/:guildId/playback-requests/test", requireAuth, async (req, res) => {
  const guildId = String(req.params.guildId);
  const guild = bot.guilds.cache.get(guildId);
  if (!guild) return sendError(res, "BOT_NOT_AVAILABLE", "이 서버에 봇이 초대되어 있지 않습니다.");

  // 클라이언트가 보낸 채널 ID 대신, 봇이 보는 voice state로 요청자의 실제 채널을 확인합니다 (FR-14)
  const channelId = getUserVoiceChannelId(guildId, req.user!.id);
  if (!channelId) return sendError(res, "NOT_IN_VOICE_CHANNEL", "음성 채널에 들어온 뒤 다시 시도해 주세요.");

  const channel = guild.channels.cache.get(channelId);
  if (!channel?.isVoiceBased()) return sendError(res, "NOT_IN_VOICE_CHANNEL", "음성 채널을 찾지 못했습니다.");

  try {
    const result = await playFile(channel, TEST_SOUND_PATH);
    const body: PlaybackTestResponse = {
      serverLatencyMs: result.latencyMs,
      joinedNewConnection: result.joinedNewConnection,
    };
    res.json(body);
  } catch (err) {
    console.error("[playback] 재생 실패", err);
    sendError(res, "BOT_NOT_AVAILABLE", "봇이 음성 채널에서 재생하지 못했습니다. 연결·말하기 권한을 확인해 주세요.");
  }
});
