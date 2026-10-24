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
  | "TOO_MANY_SOUNDS"
  | "BOT_BUSY_ELSEWHERE"
  | "BOT_NOT_AVAILABLE"
  | "INTERNAL_ERROR";

export interface ApiError {
  error: { code: ErrorCode; message: string };
  requestId: string;
}

export interface UserSummary {
  id: string; // Discord 사용자 ID
  username: string;
  avatarUrl: string | null;
}

// ── 인증 ──
export interface TokenRequest {
  code: string;
}
export interface TokenResponse {
  accessToken: string;
  user: UserSummary;
}

// GET /guilds/{guildId}/me?channelId=
export interface MeResponse {
  canUpload: boolean;
  canManage: boolean;
  inVoiceChannel: boolean;
  botInGuild: boolean;
}

// ── 사운드 ──
export type Visibility = "private" | "guild";

export interface Sound {
  id: string;
  name: string;
  category: { id: string; name: string } | null;
  durationSeconds: number;
  visibility: Visibility;
  playCount: number;
  uploader: UserSummary;
  createdAt: string;
  /** 요청자가 수정·삭제할 수 있는지 (업로더 본인 또는 관리자) */
  canEdit: boolean;
}

export interface SoundListResponse {
  items: Sound[];
}

export interface SoundPatch {
  name?: string;
  categoryId?: string | null;
  visibility?: Visibility;
}

// ── 카테고리 ──
export interface Category {
  id: string;
  name: string;
  soundCount: number;
}
export interface CategoryListResponse {
  items: Category[];
}

// ── 재생 (겹쳐 재생: 누를 때마다 바로 섞여서 나옴) ──
export interface PlayingItem {
  playId: string;
  sound: { id: string; name: string; durationSeconds: number };
  requestedBy: UserSummary;
  startedAt: string;
}

export interface PlaybackState {
  /** 봇이 접속해 있는 음성 채널 (없으면 null) */
  voiceChannelId: string | null;
  /** 지금 동시에 나오고 있는 사운드들 (먼저 시작한 순) */
  playing: PlayingItem[];
}

export interface PlaybackRequestBody {
  soundId: string;
}
export interface PlaybackRequestResponse {
  playId: string;
  /** 이 소리를 포함해 지금 동시에 나오는 개수 */
  playingCount: number;
}

// ── 서버 설정 ──
export interface GuildSettings {
  maxFileSizeBytes: number;
  maxDurationSeconds: number;
  /** 서버 전체에서 동시에 나올 수 있는 사운드 수 */
  maxConcurrentSounds: number;
  /** 한 사람이 동시에 틀 수 있는 사운드 수 */
  maxConcurrentPerUser: number;
  allowMemberUpload: boolean;
  managerRoleId: string | null;
}

export const ALLOWED_UPLOAD_EXTENSIONS = ["mp3", "ogg", "wav", "m4a"] as const;
