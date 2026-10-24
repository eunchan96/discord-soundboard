import { DiscordSDK } from "@discord/embedded-app-sdk";
import { API_BASE, type ApiError, type TokenResponse } from "@soundboard/shared";

const clientId = import.meta.env.VITE_DISCORD_CLIENT_ID;
if (!clientId) throw new Error("VITE_DISCORD_CLIENT_ID가 비어 있습니다. 루트 .env를 확인하세요.");

export const discordSdk = new DiscordSDK(clientId);

export interface Session {
  accessToken: string;
  user: TokenResponse["user"];
  guildId: string | null;
  channelId: string | null;
}

let sessionPromise: Promise<Session> | null = null;

/** 인증은 한 번만. React StrictMode가 effect를 두 번 실행해도 authorize()가 중복 호출되지 않게 Promise를 공유합니다. */
export function getSession(): Promise<Session> {
  sessionPromise ??= startSession();
  return sessionPromise;
}

/** ready → authorize(code) → 서버에서 토큰 교환 → authenticate (기능 정의서 1.1) */
async function startSession(): Promise<Session> {
  await discordSdk.ready();

  const { code } = await discordSdk.commands.authorize({
    client_id: clientId,
    response_type: "code",
    state: "",
    prompt: "none",
    scope: ["identify", "guilds"],
  });

  const res = await fetch(`${API_BASE}/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  if (!res.ok) {
    const err = (await res.json()) as ApiError;
    throw new Error(err.error.message);
  }
  const { accessToken, user } = (await res.json()) as TokenResponse;

  await discordSdk.commands.authenticate({ access_token: accessToken });

  return { accessToken, user, guildId: discordSdk.guildId, channelId: discordSdk.channelId };
}

/** 상대 경로 + Bearer 토큰으로 API 호출. 실패 시 서버 오류 메시지를 그대로 던집니다. */
export async function api<T>(session: Session, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${session.accessToken}` },
  });
  if (!res.ok) {
    const err = (await res.json()) as ApiError;
    throw new Error(err.error.message);
  }
  return (await res.json()) as T;
}
