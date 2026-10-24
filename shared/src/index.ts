// 클라이언트와 서버가 함께 쓰는 API 타입. Notion "API 명세서와 Mock Server"와 맞춰 유지합니다.

export const API_BASE = "/api/v1";

export type ErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_IN_VOICE_CHANNEL"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "FILE_TOO_LARGE"
  | "UNSUPPORTED_FORMAT"
  | "QUEUE_FULL"
  | "BOT_NOT_AVAILABLE"
  | "INTERNAL_ERROR";

export interface ApiError {
  error: { code: ErrorCode; message: string };
  requestId: string;
}

// POST /auth/token
export interface TokenRequest {
  code: string;
}
export interface TokenResponse {
  accessToken: string;
  user: { id: string; username: string; avatarUrl: string | null };
}

// POST /guilds/{guildId}/playback-requests/test  (M3 PoC 전용)
export interface PlaybackTestResponse {
  /** 요청 수신부터 봇 플레이어가 Playing 상태가 될 때까지(ms) */
  serverLatencyMs: number;
  joinedNewConnection: boolean;
}
