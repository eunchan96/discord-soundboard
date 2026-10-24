import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import express, { type NextFunction, type Request, type Response } from "express";
import { API_BASE } from "@soundboard/shared";
import { bot } from "./bot/client.ts";
import { env } from "./env.ts";
import { sendError } from "./http.ts";
import { authRouter } from "./routes/auth.ts";
import { categoriesRouter } from "./routes/categories.ts";
import { playbackRouter } from "./routes/playback.ts";
import { settingsRouter } from "./routes/settings.ts";
import { soundsRouter } from "./routes/sounds.ts";

const app = express();
app.use(express.json());

// 컨테이너 헬스체크: 봇이 Discord에 붙어 있어야 정상
app.get("/healthz", (_req, res) => {
  res.status(bot.isReady() ? 200 : 503).json({ bot: bot.isReady() });
});

// 요청 로그: 어떤 기기에서 어떤 요청이 몇 ms 걸려 어떤 상태로 끝났는지 (디버깅용)
app.use(API_BASE, (req, res, next) => {
  const started = performance.now();
  const ua = req.header("user-agent") ?? "";
  const device = /android|iphone|ipad|mobile/i.test(ua) ? "모바일" : "PC";
  res.on("finish", () => {
    console.log(`[api] ${device} ${req.method} ${req.originalUrl} → ${res.statusCode} (${Math.round(performance.now() - started)}ms)`);
  });
  next();
});

const GUILD = `${API_BASE}/guilds/:guildId`;
app.use(API_BASE, authRouter);
app.use(GUILD, settingsRouter);
app.use(GUILD, soundsRouter);
app.use(GUILD, categoriesRouter);
app.use(GUILD, playbackRouter);

app.use(API_BASE, (_req, res) => sendError(res, "NOT_FOUND", "없는 API 경로입니다."));

// 처리되지 않은 오류도 ApiError JSON으로 응답 (HTML 오류 페이지 대신)
app.use(API_BASE, (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error("[api] 처리되지 않은 오류", err);
  if (!res.headersSent) sendError(res, "INTERNAL_ERROR", "서버 내부 오류가 발생했습니다.");
});

// 배포 시: 서버 하나가 Activity 빌드 결과까지 서빙 → URL Mapping은 Root(/) 하나면 충분
const clientDist = fileURLToPath(new URL("../../client/dist", import.meta.url));
if (existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(`${clientDist}/index.html`));
}

app.listen(env.port, () => {
  console.log(`[server] http://localhost:${env.port} 에서 대기 중`);
});

await bot.login(env.discordBotToken);
