import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AudioPlayer,
  AudioPlayerStatus,
  StreamType,
  createAudioResource,
} from "@discordjs/voice";
import type { VoiceBasedChannel } from "discord.js";
import type { ErrorCode, GuildSettings, PlaybackItem, PlaybackState, UserSummary } from "@soundboard/shared";
import { BUCKET, db } from "./db.ts";
import { connectTo, currentChannelId, disconnect, getPlayer } from "./bot/voice.ts";

const IDLE_LEAVE_MS = 5 * 60_000; // 대기열이 빈 뒤 5분 지나면 퇴장 (FR-18)
const CACHE_DIR = join(tmpdir(), "soundboard-cache");

export class QueueError extends Error {
  constructor(public code: ErrorCode, message: string) {
    super(message);
  }
}

interface QueueItem {
  requestId: string;
  historyId: string | null;
  sound: { id: string; name: string; durationSeconds: number; storagePath: string };
  requestedBy: UserSummary;
  requesterProfileId: string;
  requestedAt: string;
  channel: VoiceBasedChannel;
}

interface GuildQueue {
  current: (QueueItem & { startedAt: string }) | null;
  items: QueueItem[];
  starting: boolean;
  endReason: "completed" | "skipped" | "failed" | null;
  idleTimer: NodeJS.Timeout | null;
}

const queues = new Map<string, GuildQueue>();

/** 재생 상태가 바뀔 때마다 guildId와 함께 발생 (WebSocket 브로드캐스트용) */
export const queueEvents = new EventEmitter();

function q(guildId: string): GuildQueue {
  let queue = queues.get(guildId);
  if (!queue) {
    queue = { current: null, items: [], starting: false, endReason: null, idleTimer: null };
    queues.set(guildId, queue);
  }
  return queue;
}

function changed(guildId: string) {
  queueEvents.emit("change", guildId);
}

function toItem(item: QueueItem): PlaybackItem {
  return {
    requestId: item.requestId,
    sound: { id: item.sound.id, name: item.sound.name, durationSeconds: item.sound.durationSeconds },
    requestedBy: item.requestedBy,
    requestedAt: item.requestedAt,
  };
}

export function getState(guildId: string): PlaybackState {
  const queue = q(guildId);
  return {
    voiceChannelId: currentChannelId(guildId),
    current: queue.current ? { ...toItem(queue.current), startedAt: queue.current.startedAt } : null,
    queue: queue.items.map(toItem),
  };
}

// ── 이력 기록 (실패해도 재생은 계속) ──

type HistoryStatus = "queued" | "playing" | "completed" | "failed" | "cancelled" | "skipped";

async function recordQueued(guildId: string, item: QueueItem) {
  const { data, error } = await db
    .from("playback_requests")
    .insert({
      guild_id: guildId,
      sound_id: item.sound.id,
      requested_by: item.requesterProfileId,
      voice_channel_id: item.channel.id,
      status: "queued",
    })
    .select("id")
    .single();
  if (error) console.error("[queue] 이력 기록 실패", error.message);
  else item.historyId = data.id;
}

function recordStatus(item: QueueItem, status: HistoryStatus, errorCode?: string) {
  if (!item.historyId) return;
  const patch: Record<string, unknown> = { status };
  const now = new Date().toISOString();
  if (status === "playing") patch.started_at = now;
  else patch.finished_at = now;
  if (errorCode) patch.error_code = errorCode;
  void db.from("playback_requests").update(patch).eq("id", item.historyId).then(({ error }) => {
    if (error) console.error("[queue] 이력 갱신 실패", error.message);
  });
  if (status === "completed") {
    void db.rpc("increment_play_count", { p_sound_id: item.sound.id }).then(({ error }) => {
      if (error) console.error("[queue] 재생 횟수 갱신 실패", error.message);
    });
  }
}

// ── 오디오 파일 캐시 (같은 사운드를 매번 Storage에서 받지 않도록) ──

export async function localFile(sound: { id: string; storagePath: string }): Promise<string> {
  const path = join(CACHE_DIR, `${sound.id}.ogg`);
  if (existsSync(path)) return path;
  await mkdir(CACHE_DIR, { recursive: true });
  const { data, error } = await db.storage.from(BUCKET).download(sound.storagePath);
  if (error || !data) throw new Error(`Storage 다운로드 실패: ${error?.message}`);
  await writeFile(path, Buffer.from(await data.arrayBuffer()));
  return path;
}

export async function forgetCachedSound(soundId: string) {
  await rm(join(CACHE_DIR, `${soundId}.ogg`), { force: true });
}

// ── 재생 ──

function attachPlayer(guildId: string): AudioPlayer {
  return getPlayer(guildId, (player) => {
    player.on(AudioPlayerStatus.Idle, () => finishCurrent(guildId));
    player.on("error", (err) => {
      console.error(`[queue:${guildId}] 재생 오류`, err.message);
      q(guildId).endReason = "failed";
    });
  });
}

function finishCurrent(guildId: string) {
  const queue = q(guildId);
  const done = queue.current;
  if (!done) return;
  queue.current = null;
  recordStatus(done, queue.endReason ?? "completed", queue.endReason === "failed" ? "PLAYBACK_ERROR" : undefined);
  queue.endReason = null;
  changed(guildId);
  void playNext(guildId);
}

function scheduleIdleLeave(guildId: string) {
  const queue = q(guildId);
  if (queue.idleTimer) clearTimeout(queue.idleTimer);
  queue.idleTimer = setTimeout(() => {
    queue.idleTimer = null;
    if (!queue.current && queue.items.length === 0) {
      disconnect(guildId);
      console.log(`[queue:${guildId}] 유휴 상태로 퇴장`);
    }
  }, IDLE_LEAVE_MS);
}

async function playNext(guildId: string) {
  const queue = q(guildId);
  if (queue.current || queue.starting) return;

  const next = queue.items.shift();
  if (!next) {
    scheduleIdleLeave(guildId);
    return;
  }
  if (queue.idleTimer) clearTimeout(queue.idleTimer);

  queue.starting = true;
  try {
    const [file, connection] = await Promise.all([
      localFile(next.sound),
      connectTo(next.channel, () => resetGuild(guildId)),
    ]);
    const player = attachPlayer(guildId);
    connection.subscribe(player);
    queue.current = { ...next, startedAt: new Date().toISOString() };
    player.play(createAudioResource(createReadStream(file), { inputType: StreamType.OggOpus }));
    recordStatus(next, "playing");
    changed(guildId);
  } catch (err) {
    console.error(`[queue:${guildId}] 재생 시작 실패`, err);
    recordStatus(next, "failed", "START_FAILED");
    changed(guildId);
    queue.starting = false;
    void playNext(guildId);
    return;
  }
  queue.starting = false;
}

/** 봇 연결이 끊기면(추방·채널 삭제 등) 대기열을 비웁니다. */
function resetGuild(guildId: string) {
  const queue = q(guildId);
  for (const item of queue.items) recordStatus(item, "cancelled");
  if (queue.current) recordStatus(queue.current, "failed", "DISCONNECTED");
  queue.items = [];
  queue.current = null;
  queue.endReason = null;
  changed(guildId);
}

export interface EnqueueInput {
  channel: VoiceBasedChannel;
  sound: QueueItem["sound"];
  requestedBy: UserSummary;
  requesterProfileId: string;
}

/**
 * 재생 요청을 대기열에 넣습니다.
 * - 같은 서버에서 봇은 한 채널에만 있을 수 있으므로, 다른 채널에서 재생·대기 중이면 거절하고
 *   조용하면 요청자의 채널로 이동합니다.
 * - 대기열 최대 길이와 1인당 대기 수를 넘으면 거절합니다 (FR-15).
 */
export function enqueue(guildId: string, settings: GuildSettings, input: EnqueueInput): { requestId: string; position: number } {
  const queue = q(guildId);
  const busy = queue.current !== null || queue.items.length > 0 || queue.starting;
  const botChannel = currentChannelId(guildId);
  const activeChannel = queue.current?.channel.id ?? queue.items[0]?.channel.id ?? botChannel;

  if (busy && activeChannel && activeChannel !== input.channel.id) {
    throw new QueueError("BOT_BUSY_ELSEWHERE", "봇이 다른 음성 채널에서 재생 중이에요. 끝난 뒤 다시 시도해 주세요.");
  }
  if (queue.items.length >= settings.maxQueueSize) {
    throw new QueueError("QUEUE_FULL", `대기열이 가득 찼어요 (최대 ${settings.maxQueueSize}개).`);
  }
  const mine = queue.items.filter((i) => i.requestedBy.id === input.requestedBy.id).length;
  if (mine >= settings.maxRequestsPerUser) {
    throw new QueueError("QUEUE_FULL", `한 사람당 대기는 ${settings.maxRequestsPerUser}개까지예요.`);
  }

  const item: QueueItem = {
    requestId: randomUUID(),
    historyId: null,
    sound: input.sound,
    requestedBy: input.requestedBy,
    requesterProfileId: input.requesterProfileId,
    requestedAt: new Date().toISOString(),
    channel: input.channel,
  };
  queue.items.push(item);
  void recordQueued(guildId, item);

  const position = busy ? queue.items.length : 0;
  changed(guildId);
  void playNext(guildId);
  return { requestId: item.requestId, position };
}

/** 대기 중인 요청 취소. 본인 요청이거나 관리자여야 합니다. 재생 중인 요청이면 건너뜁니다. */
export function cancel(guildId: string, requestId: string, userId: string, canManage: boolean) {
  const queue = q(guildId);

  if (queue.current?.requestId === requestId) {
    if (!canManage && queue.current.requestedBy.id !== userId) {
      throw new QueueError("FORBIDDEN", "다른 사람의 요청은 취소할 수 없어요.");
    }
    skip(guildId);
    return;
  }

  const index = queue.items.findIndex((i) => i.requestId === requestId);
  if (index === -1) throw new QueueError("NOT_FOUND", "이미 재생됐거나 없는 요청이에요.");
  const item = queue.items[index];
  if (!canManage && item.requestedBy.id !== userId) {
    throw new QueueError("FORBIDDEN", "다른 사람의 요청은 취소할 수 없어요.");
  }
  queue.items.splice(index, 1);
  recordStatus(item, "cancelled");
  changed(guildId);
}

export function skip(guildId: string) {
  const queue = q(guildId);
  if (!queue.current) return;
  queue.endReason = "skipped";
  attachPlayer(guildId).stop(); // → Idle 이벤트 → finishCurrent → 다음 재생
}

/** 대기열을 비우고 현재 재생을 멈춘 뒤 채널에서 나갑니다. */
export function stopAll(guildId: string) {
  const queue = q(guildId);
  for (const item of queue.items) recordStatus(item, "cancelled");
  queue.items = [];
  if (queue.current) skip(guildId);
  disconnect(guildId);
  changed(guildId);
}

/** 사운드가 삭제되면 대기열에서 해당 요청을 뺍니다. */
export function removeSoundFromQueue(guildId: string, soundId: string) {
  const queue = q(guildId);
  const removed = queue.items.filter((i) => i.sound.id === soundId);
  if (removed.length === 0) return;
  queue.items = queue.items.filter((i) => i.sound.id !== soundId);
  for (const item of removed) recordStatus(item, "cancelled");
  changed(guildId);
}

/** 봇 혼자 남은 채널이면 정리 (FR 4.5) */
export function leaveIfAlone(guildId: string, channel: VoiceBasedChannel | null) {
  if (!channel || channel.id !== currentChannelId(guildId)) return;
  const humans = channel.members.filter((m) => !m.user.bot).size;
  if (humans === 0) {
    console.log(`[queue:${guildId}] 채널에 사람이 없어 퇴장`);
    stopAll(guildId);
  }
}
