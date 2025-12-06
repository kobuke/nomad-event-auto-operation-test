import { Client, GatewayIntentBits } from 'discord.js';
import dotenv from 'dotenv';

dotenv.config();

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID;
const DISCORD_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID; // Assuming this is set in .env

if (!DISCORD_BOT_TOKEN) {
  console.error('❌ DISCORD_BOT_TOKEN is not set in your .env file.');
  process.exit(1);
}
if (!DISCORD_GUILD_ID) {
  console.error('❌ DISCORD_GUILD_ID is not set in your .env file.');
  process.exit(1);
}
if (!DISCORD_CHANNEL_ID) {
  console.error('❌ DISCORD_CHANNEL_ID is not set in your .env file.');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
  ],
});

const listChannelViewers = async () => {
  console.log('🚀 Starting to list channel viewers...');

  try {
    console.log('Attempting to log in to Discord...');
    await client.login(DISCORD_BOT_TOKEN);
    console.log(`Logged in as ${client.user.tag}!`);

    const guild = await client.guilds.fetch(DISCORD_GUILD_ID);
    if (!guild) {
      console.error(`❌ Guild with ID ${DISCORD_GUILD_ID} not found.`);
      return;
    }

    const channel = await guild.channels.fetch(DISCORD_CHANNEL_ID);
    if (!channel || !channel.isTextBased()) {
      console.error(`❌ Channel with ID ${DISCORD_CHANNEL_ID} not found or is not a text channel.`);
      return;
    }

    console.log(`✅ Fetched channel: ${channel.name} in guild: ${guild.name}`);

    const members = await guild.members.fetch();
    const viewers = [];

    members.forEach(member => {
      const permissions = channel.permissionsFor(member);
      if (permissions && permissions.has('ViewChannel')) {
        viewers.push({
          id: member.user.id,
          username: member.user.username,
          displayName: member.nickname || member.user.displayName || member.user.username,
        });
      }
    });

    console.log(`\n--- Viewers of #${channel.name} ---`);
    if (viewers.length > 0) {
      viewers.forEach(viewer => {
        console.log(`${viewer.id}, ${viewer.username}, ${viewer.displayName}`);
      });
    } else {
      console.log('No users found with access to this channel.');
    }
    console.log('--- List Complete ---');

  } catch (error) {
    console.error('❌ An error occurred during listing channel viewers:', error);
  } finally {
    client.destroy();
  }
};

listChannelViewers();
