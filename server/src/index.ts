import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import express from "express";
import { API_BASE } from "@soundboard/shared";
import { bot } from "./bot/client.ts";
import { env } from "./env.ts";
import { authRouter } from "./routes/auth.ts";
import { playbackRouter } from "./routes/playback.ts";

const app = express();
app.use(express.json());

app.use(API_BASE, authRouter);
app.use(API_BASE, playbackRouter);

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
