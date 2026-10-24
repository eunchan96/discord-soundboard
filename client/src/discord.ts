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

/**
 * 실패 응답을 사람이 읽을 수 있는 메시지로 바꿉니다.
 * 우리 서버는 항상 ApiError JSON을 주지만, 개발 중 Vite 프록시가 서버에 닿지 못하면
 * 빈 본문 500을 주므로 JSON이 아닐 때는 HTTP 상태와 경로를 그대로 보여줍니다.
 */
function toApiError(status: number, text: string, path: string): Error {
  try {
    const body = JSON.parse(text) as ApiError;
    if (body?.error?.message) return new Error(body.error.message);
  } catch {
    // JSON이 아님 → 아래 일반 메시지
  }
  const hint = text ? ` · ${text.slice(0, 120)}` : " · 응답 본문 없음 (서버에 닿지 못했을 수 있음)";
  return new Error(`요청 실패: HTTP ${status} ${path}${hint}`);
}

async function readApiError(res: Response, path: string): Promise<Error> {
  return toApiError(res.status, await res.text().catch(() => ""), path);
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
  if (!res.ok) throw await readApiError(res, "/auth/token");
  const { accessToken, user } = (await res.json()) as TokenResponse;

  await discordSdk.commands.authenticate({ access_token: accessToken });

  return { accessToken, user, guildId: discordSdk.guildId, channelId: discordSdk.channelId };
}

/** 상대 경로 + Bearer 토큰으로 API 호출. body가 객체면 JSON으로 보냅니다. 204면 undefined를 돌려줍니다. */
export async function api<T>(
  session: Session,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const headers: Record<string, string> = { Authorization: `Bearer ${session.accessToken}` };
  if (init.body !== undefined) headers["Content-Type"] = "application/json";

  const res = await fetch(`${API_BASE}${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  if (!res.ok) throw await readApiError(res, path);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** 오디오 파일을 인증 헤더와 함께 받아 재생 가능한 blob URL로 만듭니다 (<audio>는 헤더를 못 붙이므로). */
export async function fetchAudioUrl(session: Session, path: string): Promise<string> {
  const res = await fetch(`${API_BASE}${path}`, { headers: { Authorization: `Bearer ${session.accessToken}` } });
  if (!res.ok) throw await readApiError(res, path);
  return URL.createObjectURL(await res.blob());
}

/** multipart 업로드. fetch는 업로드 진행률을 못 주므로 XHR을 씁니다. */
export function uploadWithProgress<T>(
  session: Session,
  path: string,
  form: FormData,
  onProgress: (ratio: number) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE}${path}`);
    xhr.setRequestHeader("Authorization", `Bearer ${session.accessToken}`);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(JSON.parse(xhr.responseText) as T);
      else reject(toApiError(xhr.status, xhr.responseText, path));
    };
    xhr.onerror = () => reject(new Error("네트워크 오류로 업로드하지 못했어요."));
    xhr.send(form);
  });
}
