
import { Client, GatewayIntentBits } from 'discord.js';
import { query } from './db.js';
import getSettings, { loadSettings } from './settings.js';

const main = async () => {
    await loadSettings();
    const settings = getSettings();

    const client = new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.GuildMembers,
        ],
    });

    await client.login(settings.DISCORD_BOT_TOKEN);
    console.log(`Logged in as ${client.user.tag}!`);

    try {
        const usersResult = await query('SELECT discord_user_id FROM users');
        const allUserMentions = usersResult.rows
            .map(user => `<@${user.discord_user_id}>`)
            .join(' ');
        console.log(`[DB] All user mentions prepared.`);

        const eventsResult = await query(`
            SELECT id, name, discord_thread_id, deadline_at, remind1_at, remind2_at, deadline_notice_sent, remind1_sent, remind2_sent
            FROM events
            WHERE
              (deadline_at IS NOT NULL AND deadline_at < (NOW() AT TIME ZONE 'Asia/Tokyo') AND (deadline_notice_sent IS NULL OR deadline_notice_sent = FALSE)) OR
              (remind1_at IS NOT NULL AND remind1_at < (NOW() AT TIME ZONE 'Asia/Tokyo') AND (remind1_sent IS NULL OR remind1_sent = FALSE)) OR
              (remind2_at IS NOT NULL AND remind2_at < (NOW() AT TIME ZONE 'Asia/Tokyo') AND (remind2_sent IS NULL OR remind2_sent = FALSE));
        `);

        const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));

        for (const event of eventsResult.rows) {
            console.log(`[DB] Processing event: ${event.name}`);
            const channel = await client.channels.fetch(event.discord_thread_id).catch(() => null);
            if (!channel) continue;

            if (event.deadline_at && now > new Date(event.deadline_at) && !event.deadline_notice_sent) {
                await channel.send(
                    `${allUserMentions}\n📢 **Recruitment for ${event.name} has officially closed!** 📢\n`
                );
                console.log(`✅ Sent deadline message for event: ${event.name}`);
                await query('UPDATE events SET deadline_notice_sent = TRUE WHERE id = $1', [event.id]);
            }

            if (event.remind1_at && now > new Date(event.remind1_at) && !event.remind1_sent) {
                await channel.send(
                    `${allUserMentions}\n🔔 **Friendly Reminder** 🔔\n` +
                    `Just a quick heads-up about ${event.name}.`
                );
                console.log(`✅ Sent Reminder 1 message for event: ${event.name}`);
                await query('UPDATE events SET remind1_sent = TRUE WHERE id = $1', [event.id]);
            }

            if (event.remind2_at && now > new Date(event.remind2_at) && !event.remind2_sent) {
                await channel.send(
                    `${allUserMentions}\n⏰ **Last Chance Reminder** ⏰\n` +
                    `This is your final reminder for ${event.name}.`
                );
                console.log(`✅ Sent Reminder 2 message for event: ${event.name}`);
                await query('UPDATE events SET remind2_sent = TRUE WHERE id = $1', [event.id]);
            }
        }
    } catch (error) {
        console.error('❌ Failed to check deadlines:', error);
    } finally {
        client.destroy();
    }
};

// Original function export is no longer needed as this is a standalone script
export const checkDeadlines = main;
