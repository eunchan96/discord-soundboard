import { Router } from "express";
import type { TokenRequest, TokenResponse } from "@soundboard/shared";
import { upsertProfile } from "../db.ts";
import { env } from "../env.ts";
import { fetchDiscordUser, sendError } from "../http.ts";

export const authRouter = Router();

/**
 * Embedded App SDK의 authorize()로 받은 code를 access token으로 교환합니다.
 * client_secret이 필요해서 반드시 서버에서 처리합니다. (Activity는 redirect_uri 없이 교환)
 */
authRouter.post("/auth/token", async (req, res) => {
  const { code } = (req.body ?? {}) as Partial<TokenRequest>;
  if (!code) return sendError(res, "VALIDATION_ERROR", "code가 필요합니다.");

  const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.discordClientId,
      client_secret: env.discordClientSecret,
      grant_type: "authorization_code",
      code,
    }),
  });
  if (!tokenRes.ok) {
    console.error("[auth] 토큰 교환 실패", tokenRes.status, await tokenRes.text());
    return sendError(res, "UNAUTHENTICATED", "Discord 인증에 실패했습니다.");
  }

  const { access_token } = (await tokenRes.json()) as { access_token: string };
  const user = await fetchDiscordUser(access_token);
  if (!user) return sendError(res, "UNAUTHENTICATED", "사용자 정보를 가져오지 못했습니다.");

  // 최초 접속 시 프로필 생성, 이후엔 이름·아바타 갱신 (FR-3)
  await upsertProfile(user.id, user.global_name ?? user.username, user.avatar);

  const body: TokenResponse = {
    accessToken: access_token,
    user: {
      id: user.id,
      username: user.global_name ?? user.username,
      avatarUrl: user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png` : null,
    },
  };
  res.json(body);
});
