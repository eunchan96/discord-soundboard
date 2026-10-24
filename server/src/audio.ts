import { spawn } from "node:child_process";
import ffmpegStatic from "ffmpeg-static";

// ffmpeg-static이 OS에 맞는 FFmpeg 바이너리를 내려받아 두므로 따로 설치할 필요가 없습니다.
const FFMPEG = (ffmpegStatic as unknown as string | null) ?? "ffmpeg";

function runFfmpeg(args: string[]): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG, ["-hide_banner", "-nostdin", ...args]);
    let stderr = "";
    proc.stderr.on("data", (chunk) => (stderr += chunk));
    proc.on("error", reject);
    proc.on("close", (code) => resolve({ code: code ?? -1, stderr }));
  });
}

function parseTime(value: string): number {
  const [h, m, s] = value.split(":");
  return Number(h) * 3600 + Number(m) * 60 + Number(s);
}

export class AudioError extends Error {}

/** 믹서가 쓰는 형식: 48kHz, 스테레오, 16bit little-endian PCM */
export const PCM_SAMPLE_RATE = 48_000;
export const PCM_CHANNELS = 2;

/** 오디오 파일을 PCM 샘플 배열로 디코딩합니다 (겹쳐 재생용 믹싱 입력). */
export function decodeToPcm(inputPath: string): Promise<Int16Array> {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG, [
      "-hide_banner", "-nostdin", "-loglevel", "error",
      "-i", inputPath,
      "-f", "s16le", "-ac", String(PCM_CHANNELS), "-ar", String(PCM_SAMPLE_RATE),
      "pipe:1",
    ]);
    const chunks: Buffer[] = [];
    let stderr = "";
    proc.stdout.on("data", (c: Buffer) => chunks.push(c));
    proc.stderr.on("data", (c) => (stderr += c));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code !== 0) return reject(new AudioError(`디코딩 실패: ${stderr.slice(-300)}`));
      const buf = Buffer.concat(chunks);
      // 정렬된 새 버퍼로 복사해야 Int16Array로 안전하게 볼 수 있음
      const aligned = new ArrayBuffer(buf.length - (buf.length % 2));
      new Uint8Array(aligned).set(buf.subarray(0, aligned.byteLength));
      resolve(new Int16Array(aligned));
    });
  });
}

/** 파일 길이(초). 헤더에 길이가 없으면 끝까지 디코딩해서 잽니다. */
export async function probeDuration(inputPath: string): Promise<number> {
  const header = await runFfmpeg(["-i", inputPath]);
  if (!/Stream #.*Audio:/.test(header.stderr)) {
    throw new AudioError("오디오 스트림이 없는 파일입니다.");
  }
  const fromHeader = header.stderr.match(/Duration: (\d+:\d+:\d+(?:\.\d+)?)/);
  if (fromHeader) return parseTime(fromHeader[1]);

  const decoded = await runFfmpeg(["-i", inputPath, "-f", "null", "-"]);
  const times = [...decoded.stderr.matchAll(/time=(\d+:\d+:\d+(?:\.\d+)?)/g)];
  if (times.length === 0) throw new AudioError("파일 길이를 확인하지 못했습니다.");
  return parseTime(times[times.length - 1][1]);
}

/**
 * 재생용 포맷으로 변환합니다 (FR-10).
 * Ogg Opus 48kHz 스테레오로 저장하면 봇이 재생할 때 다시 인코딩할 필요가 없고,
 * loudnorm으로 사운드마다 제각각인 음량을 비슷하게 맞춥니다.
 */
export async function transcodeToOggOpus(inputPath: string, outputPath: string): Promise<void> {
  const result = await runFfmpeg([
    "-y",
    "-i", inputPath,
    "-vn",
    "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
    "-ac", "2",
    "-ar", "48000",
    "-c:a", "libopus",
    "-b:a", "96k",
    outputPath,
  ]);
  if (result.code !== 0) {
    console.error("[audio] 변환 실패\n", result.stderr.slice(-800));
    throw new AudioError("오디오 변환에 실패했습니다. 손상된 파일인지 확인해 주세요.");
  }
}
