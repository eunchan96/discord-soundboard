import { Client, Events, GatewayIntentBits } from "discord.js";
import { registerCommands, handleInteraction } from "./commands.ts";

// Guilds: 서버·채널 정보, GuildVoiceStates: 누가 어느 음성 채널에 있는지 (둘 다 Privileged 아님)
export const bot = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

bot.once(Events.ClientReady, async (client) => {
  console.log(`[bot] ${client.user.tag} 로그인 완료, 서버 ${client.guilds.cache.size}개`);
  await registerCommands(client);
});

bot.on(Events.InteractionCreate, handleInteraction);

/** 봇 Gateway 캐시 기준으로 사용자가 지금 접속한 음성 채널 ID (없으면 null) */
export function getUserVoiceChannelId(guildId: string, userId: string): string | null {
  const guild = bot.guilds.cache.get(guildId);
  return guild?.voiceStates.cache.get(userId)?.channelId ?? null;
}
