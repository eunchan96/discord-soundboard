import { fileURLToPath } from "node:url";
import {
  type Client,
  type Interaction,
  GuildMember,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";
import { env } from "../env.ts";
import { playFile } from "./voice.ts";

export const TEST_SOUND_PATH = fileURLToPath(new URL("../../assets/test.ogg", import.meta.url));

const soundTest = new SlashCommandBuilder()
  .setName("sound-test")
  .setDescription("PoC: 내가 있는 음성 채널에서 테스트 사운드를 재생합니다");

export async function registerCommands(client: Client<true>) {
  if (!env.devGuildId) {
    console.warn("[bot] DEV_GUILD_ID가 없어 슬래시 명령어 등록을 건너뜁니다");
    return;
  }
  const guild = await client.guilds.fetch(env.devGuildId);
  await guild.commands.set([soundTest.toJSON()]);
  console.log(`[bot] ${guild.name}에 /sound-test 등록`);
}

export async function handleInteraction(interaction: Interaction) {
  if (!interaction.isChatInputCommand() || interaction.commandName !== "sound-test") return;

  const member = interaction.member;
  const channel = member instanceof GuildMember ? member.voice.channel : null;
  if (!channel) {
    await interaction.reply({ content: "먼저 음성 채널에 들어가 주세요.", flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const result = await playFile(channel, TEST_SOUND_PATH);
    await interaction.editReply(
      `재생 시작까지 ${result.latencyMs}ms ${result.joinedNewConnection ? "(채널 새로 접속 포함)" : "(이미 접속 중)"}`,
    );
  } catch (err) {
    console.error("[bot] /sound-test 실패", err);
    await interaction.editReply("재생에 실패했어요. 봇에 연결·말하기 권한이 있는지 확인해 주세요.");
  }
}
