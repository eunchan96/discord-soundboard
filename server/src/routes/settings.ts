import { Router } from "express";
import type { GuildSettings } from "@soundboard/shared";
import { bot } from "../bot/client.ts";
import { requireGuild, requireManage } from "../context.ts";
import { ensureGuildSettings, getMe, updateGuildSettings } from "../guilds.ts";
import { sendError } from "../http.ts";

export const settingsRouter = Router({ mergeParams: true });
settingsRouter.use(requireGuild);

// GET /guilds/:guildId/me?channelId=
settingsRouter.get("/me", async (req, res) => {
  const channelId = typeof req.query.channelId === "string" ? req.query.channelId : undefined;
  res.json(await getMe(req.ctx!.guildId, req.user!.id, channelId));
});

// GET /guilds/:guildId/settings
settingsRouter.get("/settings", async (req, res) => {
  res.json(await ensureGuildSettings(req.ctx!.guildId));
});

const LIMITS = {
  maxFileSizeBytes: [64 * 1024, 10 * 1024 * 1024],
  maxDurationSeconds: [1, 60],
  maxConcurrentSounds: [1, 16],
  maxConcurrentPerUser: [1, 8],
} as const;

// PATCH /guilds/:guildId/settings
settingsRouter.patch("/settings", requireManage, async (req, res) => {
  const { guildId } = req.ctx!;
  const body = (req.body ?? {}) as Partial<GuildSettings>;
  const patch: Partial<GuildSettings> = {};

  for (const key of Object.keys(LIMITS) as (keyof typeof LIMITS)[]) {
    const value = body[key];
    if (value === undefined) continue;
    const [min, max] = LIMITS[key];
    if (!Number.isInteger(value) || value < min || value > max) {
      return sendError(res, "VALIDATION_ERROR", `${key}는 ${min}~${max} 사이 정수여야 해요.`);
    }
    patch[key] = value;
  }
  if (body.allowMemberUpload !== undefined) {
    if (typeof body.allowMemberUpload !== "boolean") return sendError(res, "VALIDATION_ERROR", "allowMemberUpload는 true/false예요.");
    patch.allowMemberUpload = body.allowMemberUpload;
  }
  if (body.managerRoleId !== undefined) {
    if (body.managerRoleId !== null && !bot.guilds.cache.get(guildId)?.roles.cache.has(body.managerRoleId)) {
      return sendError(res, "VALIDATION_ERROR", "이 서버에 없는 역할이에요.");
    }
    patch.managerRoleId = body.managerRoleId;
  }

  res.json(await updateGuildSettings(guildId, patch));
});
