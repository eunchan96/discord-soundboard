function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`환경변수 ${name}가 비어 있습니다. 루트의 .env를 확인하세요.`);
  }
  return value;
}

export const env = {
  discordClientId: required("DISCORD_CLIENT_ID"),
  discordClientSecret: required("DISCORD_CLIENT_SECRET"),
  discordBotToken: required("DISCORD_BOT_TOKEN"),
  devGuildId: process.env.DEV_GUILD_ID || undefined,
  port: Number(process.env.PORT ?? 3001),
};
