import {
  type AudioPlayer,
  type VoiceConnection,
  NoSubscriberBehavior,
  VoiceConnectionStatus,
  createAudioPlayer,
  entersState,
  getVoiceConnection,
  joinVoiceChannel,
} from "@discordjs/voice";
import type { VoiceBasedChannel } from "discord.js";

const players = new Map<string, AudioPlayer>();

/** 서버당 플레이어 하나. 처음 만들 때 onCreate로 이벤트 핸들러를 붙입니다. */
export function getPlayer(guildId: string, onCreate: (player: AudioPlayer) => void): AudioPlayer {
  let player = players.get(guildId);
  if (!player) {
    player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } });
    onCreate(player);
    players.set(guildId, player);
  }
  return player;
}

/** 봇이 지금 접속해 있는 음성 채널 ID */
export function currentChannelId(guildId: string): string | null {
  const conn = getVoiceConnection(guildId);
  if (!conn || conn.state.status === VoiceConnectionStatus.Destroyed) return null;
  return conn.joinConfig.channelId;
}

/**
 * 해당 채널에 접속(다른 채널에 있으면 이동)하고 Ready까지 기다립니다.
 * Discord는 봇 계정 하나가 서버당 한 음성 채널에만 있을 수 있어서, 이동하면 이전 채널에서는 나갑니다.
 */
export async function connectTo(channel: VoiceBasedChannel, onDestroyed: () => void): Promise<VoiceConnection> {
  const guildId = channel.guild.id;
  let conn = getVoiceConnection(guildId);

  if (!conn || conn.state.status === VoiceConnectionStatus.Destroyed || conn.joinConfig.channelId !== channel.id) {
    const isNew = !conn || conn.state.status === VoiceConnectionStatus.Destroyed;
    conn = joinVoiceChannel({
      guildId,
      channelId: channel.id,
      adapterCreator: channel.guild.voiceAdapterCreator,
      selfDeaf: true,
    });
    if (isNew) {
      conn.on(VoiceConnectionStatus.Disconnected, async () => {
        // 잠깐 끊긴 경우(채널 이동, 네트워크)는 5초 안에 재연결을 기다리고, 아니면 정리합니다.
        try {
          await Promise.race([
            entersState(conn!, VoiceConnectionStatus.Signalling, 5_000),
            entersState(conn!, VoiceConnectionStatus.Connecting, 5_000),
          ]);
        } catch {
          conn!.destroy();
        }
      });
      conn.on(VoiceConnectionStatus.Destroyed, () => {
        players.get(guildId)?.stop(true);
        onDestroyed();
      });
    }
  }

  await entersState(conn, VoiceConnectionStatus.Ready, 15_000);
  return conn;
}

export function disconnect(guildId: string) {
  const conn = getVoiceConnection(guildId);
  if (conn && conn.state.status !== VoiceConnectionStatus.Destroyed) conn.destroy();
}
