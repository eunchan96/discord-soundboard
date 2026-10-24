import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AudioPlayerStatus, StreamType, createAudioResource, type AudioPlayer } from "@discordjs/voice";
import type { VoiceBasedChannel } from "discord.js";
import type { ErrorCode, GuildSettings, PlaybackState, PlayingItem, UserSummary } from "@soundboard/shared";
import { decodeToPcm } from "./audio.ts";
import { connectTo, currentChannelId, disconnect, getPlayer } from "./bot/voice.ts";
import { BUCKET, db } from "./db.ts";
import { Mixer } from "./mixer.ts";

const IDLE_LEAVE_MS = 5 * 60_000; // 마지막 소리가 끝나고 5분 동안 조용하면 퇴장 (FR-18)
const CACHE_DIR = join(tmpdir(), "soundboard-cache");
const PCM_CACHE_MAX = 40; // 디코딩한 사운드를 메모리에 최대 40개 보관 (15초짜리 하나 약 2.9MB)

export class PlaybackError extends Error {
  constructor(public code: ErrorCode, message: string) {
    super(message);
  }
}

interface Playing {
  playId: string;
  historyId: string | null;
  sound: { id: string; name: string; durationSeconds: number };
  requestedBy: UserSummary;
  requesterProfileId: string;
  startedAt: string;
}

interface GuildPlayback {
  mixer: Mixer<Playing> | null;
  channelId: string | null;
  idleTimer: NodeJS.Timeout | null;
}

const guilds = new Map<string, GuildPlayback>();

/** 재생 상태가 바뀔 때마다 guildId와 함께 발생 (WebSocket 브로드캐스트용) */
export const playbackEvents = new EventEmitter();

function g(guildId: string): GuildPlayback {
  let state = guilds.get(guildId);
  if (!state) {
    state = { mixer: null, channelId: null, idleTimer: null };
    guilds.set(guildId, state);
  }
  return state;
}

function changed(guildId: string) {
  playbackEvents.emit("change", guildId);
}

function active(guildId: string): readonly Playing[] {
  const mixer = g(guildId).mixer;
  return mixer && !mixer.ended ? mixer.active : [];
}

export function getState(guildId: string): PlaybackState {
  return {
    voiceChannelId: currentChannelId(guildId),
    playing: active(guildId).map(
      (p): PlayingItem => ({ playId: p.playId, sound: p.sound, requestedBy: p.requestedBy, startedAt: p.startedAt }),
    ),
  };
}

// ── 파일·PCM 캐시 ──

/** Storage의 Ogg 파일을 로컬에 한 번만 받아 둡니다 (미리듣기 스트리밍도 이 파일을 씀). */
export async function localFile(sound: { id: string; storagePath: string }): Promise<string> {
  const path = join(CACHE_DIR, `${sound.id}.ogg`);
  if (existsSync(path)) return path;
  await mkdir(CACHE_DIR, { recursive: true });
  const { data, error } = await db.storage.from(BUCKET).download(sound.storagePath);
  if (error || !data) throw new Error(`Storage 다운로드 실패: ${error?.message}`);
  await writeFile(path, Buffer.from(await data.arrayBuffer()));
  return path;
}

const pcmCache = new Map<string, Int16Array>();

async function getPcm(sound: { id: string; storagePath: string }): Promise<Int16Array> {
  const hit = pcmCache.get(sound.id);
  if (hit) {
    pcmCache.delete(sound.id); // 최근 사용 순서 갱신
    pcmCache.set(sound.id, hit);
    return hit;
  }
  const pcm = await decodeToPcm(await localFile(sound));
  pcmCache.set(sound.id, pcm);
  if (pcmCache.size > PCM_CACHE_MAX) pcmCache.delete(pcmCache.keys().next().value!);
  return pcm;
}

export async function forgetSound(soundId: string) {
  pcmCache.delete(soundId);
  await rm(join(CACHE_DIR, `${soundId}.ogg`), { force: true });
}

// ── 이력 기록 (실패해도 재생은 계속) ──

async function recordStarted(guildId: string, channelId: string, p: Playing) {
  const { data, error } = await db
    .from("playback_requests")
    .insert({
      guild_id: guildId,
      sound_id: p.sound.id,
      requested_by: p.requesterProfileId,
      voice_channel_id: channelId,
      status: "playing",
      started_at: p.startedAt,
    })
    .select("id")
    .single();
  if (error) console.error("[player] 이력 기록 실패", error.message);
  else p.historyId = data.id;
}

function recordFinished(p: Playing, status: "completed" | "cancelled" | "failed", errorCode?: string) {
  // 시작 기록이 아직 저장 중일 수 있어 잠깐 뒤에 갱신
  setTimeout(() => {
    if (!p.historyId) return;
    void db
      .from("playback_requests")
      .update({ status, finished_at: new Date().toISOString(), error_code: errorCode ?? null })
      .eq("id", p.historyId)
      .then(({ error }) => error && console.error("[player] 이력 갱신 실패", error.message));
  }, 500);
  if (status === "completed") {
    void db
      .rpc("increment_play_count", { p_sound_id: p.sound.id })
      .then(({ error }) => error && console.error("[player] 재생 횟수 갱신 실패", error.message));
  }
}

// ── 재생 ──

function scheduleIdleLeave(guildId: string) {
  const state = g(guildId);
  if (state.idleTimer) clearTimeout(state.idleTimer);
  state.idleTimer = setTimeout(() => {
    state.idleTimer = null;
    if (active(guildId).length === 0) {
      disconnect(guildId);
      console.log(`[player:${guildId}] 유휴 상태로 퇴장`);
    }
  }, IDLE_LEAVE_MS);
}

function attachPlayer(guildId: string): AudioPlayer {
  return getPlayer(guildId, (player) => {
    player.on(AudioPlayerStatus.Idle, () => {
      if (active(guildId).length === 0) scheduleIdleLeave(guildId);
    });
    player.on("error", (err) => {
      console.error(`[player:${guildId}] 재생 오류`, err.message);
      const mixer = g(guildId).mixer;
      for (const p of mixer?.remove(() => true) ?? []) recordFinished(p, "failed", "PLAYBACK_ERROR");
      g(guildId).mixer = null;
      changed(guildId);
    });
  });
}

/** 연결이 끊기면(추방·채널 삭제 등) 섞이던 소리를 정리합니다. */
function resetGuild(guildId: string) {
  const state = g(guildId);
  for (const p of state.mixer?.remove(() => true) ?? []) recordFinished(p, "failed", "DISCONNECTED");
  state.mixer = null;
  state.channelId = null;
  changed(guildId);
}

function checkLimits(guildId: string, settings: GuildSettings, channelId: string, userId: string) {
  const playing = active(guildId);
  if (playing.length > 0 && g(guildId).channelId !== channelId) {
    throw new PlaybackError("BOT_BUSY_ELSEWHERE", "봇이 다른 음성 채널에서 재생 중이에요. 끝난 뒤 다시 시도해 주세요.");
  }
  if (playing.length >= settings.maxConcurrentSounds) {
    throw new PlaybackError("TOO_MANY_SOUNDS", `동시에 ${settings.maxConcurrentSounds}개까지 재생할 수 있어요.`);
  }
  if (playing.filter((p) => p.requestedBy.id === userId).length >= settings.maxConcurrentPerUser) {
    throw new PlaybackError("TOO_MANY_SOUNDS", `한 사람당 동시에 ${settings.maxConcurrentPerUser}개까지 틀 수 있어요.`);
  }
}

export interface PlayInput {
  channel: VoiceBasedChannel;
  sound: { id: string; name: string; durationSeconds: number; storagePath: string };
  requestedBy: UserSummary;
  requesterProfileId: string;
}

/**
 * 누르는 즉시 재생합니다. 이미 다른 소리가 나오고 있으면 그 위에 겹쳐서 섞습니다 (FR-15).
 * - 같은 서버에서 봇은 한 채널에만 있을 수 있어, 다른 채널에서 재생 중이면 거절하고 조용하면 이동합니다 (FR-21).
 * - 서버 전체 동시 재생 수와 1인 동시 재생 수를 넘으면 거절합니다.
 */
export async function play(guildId: string, settings: GuildSettings, input: PlayInput) {
  checkLimits(guildId, settings, input.channel.id, input.requestedBy.id);

  const [pcm, connection] = await Promise.all([
    getPcm(input.sound),
    connectTo(input.channel, () => resetGuild(guildId)),
  ]);

  // 기다리는 동안 다른 요청이 먼저 들어왔을 수 있으니 한 번 더 확인
  checkLimits(guildId, settings, input.channel.id, input.requestedBy.id);

  const state = g(guildId);
  const playing: Playing = {
    playId: randomUUID(),
    historyId: null,
    sound: { id: input.sound.id, name: input.sound.name, durationSeconds: input.sound.durationSeconds },
    requestedBy: input.requestedBy,
    requesterProfileId: input.requesterProfileId,
    startedAt: new Date().toISOString(),
  };

  if (!state.mixer || state.mixer.ended) {
    const mixer = new Mixer<Playing>((p) => {
      recordFinished(p, "completed");
      changed(guildId);
    });
    mixer.add(pcm, playing);
    state.mixer = mixer;
    const player = attachPlayer(guildId);
    connection.subscribe(player);
    player.play(createAudioResource(mixer, { inputType: StreamType.Raw }));
  } else {
    state.mixer.add(pcm, playing);
  }

  state.channelId = input.channel.id;
  if (state.idleTimer) {
    clearTimeout(state.idleTimer);
    state.idleTimer = null;
  }
  void recordStarted(guildId, input.channel.id, playing);
  changed(guildId);
  return { playId: playing.playId, playingCount: active(guildId).length };
}

/** 나오고 있는 소리를 모두 멈추고 채널에서 나갑니다. */
export function stopAll(guildId: string) {
  const state = g(guildId);
  for (const p of state.mixer?.remove(() => true) ?? []) recordFinished(p, "cancelled");
  state.mixer = null;
  getPlayer(guildId, () => undefined).stop(true);
  disconnect(guildId);
  changed(guildId);
}

/** 사운드가 삭제되면 섞이던 것도 바로 뺍니다. */
export function removeSoundFromPlayback(guildId: string, soundId: string) {
  const removed = g(guildId).mixer?.remove((p) => p.sound.id === soundId) ?? [];
  for (const p of removed) recordFinished(p, "cancelled");
  if (removed.length > 0) changed(guildId);
}

/** 봇 혼자 남은 채널이면 정리 (FR 4.5) */
export function leaveIfAlone(guildId: string, channel: VoiceBasedChannel | null) {
  if (!channel || channel.id !== currentChannelId(guildId)) return;
  const humans = channel.members.filter((m) => !m.user.bot).size;
  if (humans === 0) {
    console.log(`[player:${guildId}] 채널에 사람이 없어 퇴장`);
    stopAll(guildId);
  }
}
