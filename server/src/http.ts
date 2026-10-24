import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import type { ApiError, ErrorCode } from "@soundboard/shared";

const STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_IN_VOICE_CHANNEL: 403,
  NOT_FOUND: 404,
  VALIDATION_ERROR: 400,
  FILE_TOO_LARGE: 413,
  UNSUPPORTED_FORMAT: 415,
  TOO_MANY_SOUNDS: 429,
  BOT_BUSY_ELSEWHERE: 409,
  BOT_NOT_AVAILABLE: 503,
  INTERNAL_ERROR: 500,
};

export function sendError(res: Response, code: ErrorCode, message: string) {
  const body: ApiError = { error: { code, message }, requestId: randomUUID() };
  res.status(STATUS[code]).json(body);
}

export interface DiscordUser {
  id: string;
  username: string;
  global_name: string | null;
  avatar: string | null;
}

declare global {
  namespace Express {
    interface Request {
      user?: DiscordUser;
    }
  }
}

// access token → Discord 사용자. 매 요청마다 Discord API를 부르지 않도록 짧게 캐시합니다.
const userCache = new Map<string, { user: DiscordUser; expiresAt: number }>();
const USER_CACHE_MS = 5 * 60_000;

export async function fetchDiscordUser(accessToken: string): Promise<DiscordUser | null> {
  const cached = userCache.get(accessToken);
  if (cached && cached.expiresAt > Date.now()) return cached.user;

  const res = await fetch("https://discord.com/api/v10/users/@me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const user = (await res.json()) as DiscordUser;
  userCache.set(accessToken, { user, expiresAt: Date.now() + USER_CACHE_MS });
  return user;
}

/** Authorization: Bearer {accessToken} 검증. 사용자 ID는 클라이언트 값이 아니라 여기서 결정합니다 (NFR-3). */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.header("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return sendError(res, "UNAUTHENTICATED", "로그인이 필요합니다.");

  const user = await fetchDiscordUser(token);
  if (!user) return sendError(res, "UNAUTHENTICATED", "인증이 만료되었습니다. Activity를 다시 열어 주세요.");

  req.user = user;
  next();
}
