import { createReadStream } from "node:fs";
import {
  AudioPlayer,
  AudioPlayerStatus,
  NoSubscriberBehavior,
  StreamType,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  getVoiceConnection,
  joinVoiceChannel,
} from "@discordjs/voice";
import type { VoiceBasedChannel } from "discord.js";

const IDLE_LEAVE_MS = 5 * 60_000; // 마지막 재생 후 5분 동안 조용하면 퇴장 (FR-18)

const players = new Map<string, AudioPlayer>();
const idleTimers = new Map<string, NodeJS.Timeout>();

function getPlayer(guildId: string): AudioPlayer {
  let player = players.get(guildId);
  if (!player) {
    player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } });
    player.on("error", (err) => console.error(`[voice:${guildId}] 재생 오류`, err.message));
    players.set(guildId, player);
  }
  return player;
}

function scheduleIdleLeave(guildId: string) {
  clearTimeout(idleTimers.get(guildId));
  idleTimers.set(
    guildId,
    setTimeout(() => {
      getVoiceConnection(guildId)?.destroy();
      players.delete(guildId);
      idleTimers.delete(guildId);
      console.log(`[voice:${guildId}] 유휴 상태로 퇴장`);
    }, IDLE_LEAVE_MS),
  );
}

export interface PlayResult {
  latencyMs: number;
  joinedNewConnection: boolean;
}

/**
 * 음성 채널에 접속(필요하면 이동)해서 Ogg Opus 파일을 재생합니다.
 * Ogg Opus는 그대로 전달되므로 재생 시점에 FFmpeg·Opus 인코더가 필요 없습니다.
 * 업로드 시 서버에서 Ogg Opus로 변환해 두는 이유가 이것입니다 (FR-10).
 */
export async function playFile(channel: VoiceBasedChannel, filePath: string): Promise<PlayResult> {
  const started = performance.now();
  const guildId = channel.guild.id;

  let connection = getVoiceConnection(guildId);
  const joinedNewConnection = !connection || connection.joinConfig.channelId !== channel.id;
  if (joinedNewConnection) {
    connection = joinVoiceChannel({
      guildId,
      channelId: channel.id,
      adapterCreator: channel.guild.voiceAdapterCreator,
      selfDeaf: true,
    });
  }
  await entersState(connection!, VoiceConnectionStatus.Ready, 15_000);

  const player = getPlayer(guildId);
  connection!.subscribe(player);

  const resource = createAudioResource(createReadStream(filePath), { inputType: StreamType.OggOpus });
  player.play(resource);
  await entersState(player, AudioPlayerStatus.Playing, 5_000);

  scheduleIdleLeave(guildId);
  return { latencyMs: Math.round(performance.now() - started), joinedNewConnection };
}
