import type { NextFunction, Request, Response } from "express";
import { getProfileId } from "./db.ts";
import { getMemberAccess, type MemberAccess } from "./guilds.ts";
import { requireAuth, sendError } from "./http.ts";
import { bot } from "./bot/client.ts";

export interface GuildContext {
  guildId: string;
  profileId: string; // profiles.id (uuid)
  access: MemberAccess;
}

declare global {
  namespace Express {
    interface Request {
      ctx?: GuildContext;
    }
  }
}

/**
 * /guilds/:guildId/* 공통: 토큰 검증 → 봇이 있는 서버인지 → 요청자가 그 서버 멤버인지 → 권한 계산.
 * guildId는 URL에서 오지만 멤버십은 봇이 직접 확인하므로 다른 서버 데이터에 접근할 수 없습니다.
 */
async function loadGuildContext(req: Request, res: Response, next: NextFunction) {
  const guildId = String(req.params.guildId);
  if (!bot.guilds.cache.has(guildId)) {
    return sendError(res, "BOT_NOT_AVAILABLE", "이 서버에 봇이 초대되어 있지 않습니다.");
  }

  const access = await getMemberAccess(guildId, req.user!.id);
  if (!access.isMember) return sendError(res, "FORBIDDEN", "이 서버의 멤버가 아닙니다.");

  const user = req.user!;
  const profileId = await getProfileId(user.id, user.global_name ?? user.username, user.avatar);
  req.ctx = { guildId, profileId, access };
  next();
}

export const requireGuild = [requireAuth, loadGuildContext];

export function requireManage(req: Request, res: Response, next: NextFunction) {
  if (!req.ctx?.access.canManage) return sendError(res, "FORBIDDEN", "관리 권한이 필요합니다.");
  next();
}
