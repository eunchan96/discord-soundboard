import { Client, Events, GatewayIntentBits } from "discord.js";
import { env } from "../env.ts";
import { ensureGuildSettings } from "../guilds.ts";
import { leaveIfAlone } from "../player.ts";

// Guilds: 서버·채널·역할 정보, GuildVoiceStates: 누가 어느 음성 채널에 있는지 (둘 다 Privileged 아님)
export const bot = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

bot.once(Events.ClientReady, async (client) => {
  console.log(`[bot] ${client.user.tag} 로그인 완료, 서버 ${client.guilds.cache.size}개`);
  for (const guild of client.guilds.cache.values()) {
    await ensureGuildSettings(guild.id).catch((e) => console.error(`[bot] ${guild.name} 설정 생성 실패`, e));
  }
  // PoC 때 등록한 /sound-test 정리 (이제 재생은 Activity에서)
  if (env.devGuildId) {
    const guild = await client.guilds.fetch(env.devGuildId).catch(() => null);
    await guild?.commands.set([]).catch(() => undefined);
  }
});

bot.on(Events.GuildCreate, async (guild) => {
  console.log(`[bot] 새 서버 입장: ${guild.name}`);
  await ensureGuildSettings(guild.id).catch((e) => console.error("[bot] 설정 생성 실패", e));
});

bot.on(Events.VoiceStateUpdate, (oldState) => {
  // 누군가 채널을 나가서 봇만 남으면 퇴장
  if (oldState.channelId && oldState.channelId !== oldState.guild.members.me?.voice.channelId) return;
  leaveIfAlone(oldState.guild.id, oldState.channel);
});

/** 봇 Gateway 캐시 기준으로 사용자가 지금 접속한 음성 채널 ID (없으면 null) */
export function getUserVoiceChannelId(guildId: string, userId: string): string | null {
  const guild = bot.guilds.cache.get(guildId);
  return guild?.voiceStates.cache.get(userId)?.channelId ?? null;
}
