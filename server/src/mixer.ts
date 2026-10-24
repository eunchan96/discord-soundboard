import { Readable } from "node:stream";
import { PCM_CHANNELS, PCM_SAMPLE_RATE } from "./audio.ts";

/** Discord 음성은 20ms 단위 프레임으로 나갑니다. 48kHz × 2채널 × 20ms = 1920 샘플 */
export const FRAME_SAMPLES = (PCM_SAMPLE_RATE / 1000) * 20 * PCM_CHANNELS;
const FRAME_BYTES = FRAME_SAMPLES * 2;

export interface MixerVoice<T> {
  pcm: Int16Array;
  offset: number;
  meta: T;
}

/**
 * 여러 사운드를 겹쳐서 하나의 PCM 스트림으로 내보냅니다.
 * 봇은 채널에 오디오 스트림을 하나만 보낼 수 있으므로, 동시에 재생하려면 서버에서 직접 섞어야 합니다.
 *
 * - 재생 플레이어가 프레임을 당겨갈 때(_read)마다 살아 있는 사운드들의 다음 20ms를 더합니다.
 * - 더한 값이 16bit 범위를 넘으면 잘라냅니다(클리핑). 업로드 때 음량을 -16 LUFS로 맞춰 두어 여유가 있습니다.
 * - 버퍼를 작게(2프레임) 잡아서, 이미 재생 중일 때 새 소리가 끼어드는 지연을 줄입니다.
 * - 남은 사운드가 없으면 스트림을 끝냅니다. 다음 재생은 새 믹서로 시작합니다.
 */
export class Mixer<T> extends Readable {
  private voices: MixerVoice<T>[] = [];
  private acc = new Int32Array(FRAME_SAMPLES);
  ended = false;

  constructor(private onVoiceEnd: (meta: T) => void) {
    super({ highWaterMark: FRAME_BYTES * 2 });
  }

  add(pcm: Int16Array, meta: T) {
    if (this.ended) throw new Error("이미 끝난 믹서에는 추가할 수 없습니다.");
    this.voices.push({ pcm, offset: 0, meta });
  }

  /** 지금 섞이고 있는 사운드들 */
  get active(): readonly T[] {
    return this.voices.map((v) => v.meta);
  }

  /** 특정 조건의 사운드를 즉시 뺍니다 (삭제된 사운드, 전체 정지). 빠진 사운드의 meta를 돌려줍니다. */
  remove(predicate: (meta: T) => boolean): T[] {
    const removed = this.voices.filter((v) => predicate(v.meta)).map((v) => v.meta);
    this.voices = this.voices.filter((v) => !predicate(v.meta));
    return removed;
  }

  override _read() {
    if (this.voices.length === 0) {
      this.ended = true;
      this.push(null);
      return;
    }

    const acc = this.acc;
    acc.fill(0);
    const finished: MixerVoice<T>[] = [];

    for (const voice of this.voices) {
      const n = Math.min(FRAME_SAMPLES, voice.pcm.length - voice.offset);
      const { pcm, offset } = voice;
      for (let i = 0; i < n; i++) acc[i] += pcm[offset + i];
      voice.offset += n;
      if (voice.offset >= voice.pcm.length) finished.push(voice);
    }

    const out = Buffer.allocUnsafe(FRAME_BYTES);
    for (let i = 0; i < FRAME_SAMPLES; i++) {
      const s = acc[i];
      out.writeInt16LE(s > 32767 ? 32767 : s < -32768 ? -32768 : s, i * 2);
    }

    if (finished.length > 0) {
      this.voices = this.voices.filter((v) => !finished.includes(v));
      for (const v of finished) this.onVoiceEnd(v.meta);
    }
    this.push(out);
  }
}
