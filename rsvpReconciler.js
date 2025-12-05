


import { Client, GatewayIntentBits } from 'discord.js';

import { query } from './db.js';

import getSettings, { loadSettings } from './settings.js';



const main = async () => {

    await loadSettings();

    const settings = getSettings();



    console.log('🚀 Starting RSVP reconciliation with database...');

    const client = new Client({

        intents: [

            GatewayIntentBits.Guilds,

            GatewayIntentBits.GuildMessages,

            GatewayIntentBits.GuildMessageReactions,

        ],

    });

    await client.login(settings.DISCORD_BOT_TOKEN);



    try {

        const eventsResult = await query(`

            SELECT id, name, discord_thread_id, discord_message_id, reaction_emoji 

            FROM events 

            WHERE discord_message_id IS NOT NULL AND reaction_emoji IS NOT NULL

        `);

        const eventsToProcess = eventsResult.rows;

        console.log(`[DB] Found ${eventsToProcess.length} events to process.`);

        let totalUpdates = 0;



        for (const event of eventsToProcess) {

            console.log(`\n[${event.name}] Processing event...`);

            try {

                const channel = await client.channels.fetch(event.discord_thread_id);

                if (!channel || !channel.isTextBased()) {

                    console.log(`[${event.name}] ⚠️ Channel ${event.discord_thread_id} not found or not text-based. Skipping.`);

                    continue;

                }

                const message = await channel.messages.fetch(event.discord_message_id);

                const reaction = message.reactions.cache.get(event.reaction_emoji);

                if (!reaction) {

                    console.log(`[${event.name}] ⚠️ No one has reacted with ${event.reaction_emoji}. Skipping.`);

                    continue;

                }

                const reactionUsers = await reaction.users.fetch();

                const reactionUserIds = new Set(reactionUsers.filter(u => !u.bot).map(u => u.id));

                console.log(`[${event.name}] Found ${reactionUserIds.size} user(s) who reacted.`);



                const rsvpResult = await query(

                    `SELECT u.discord_user_id FROM rsvps r 

                     JOIN users u ON r.user_id = u.id 

                     WHERE r.event_id = 
 AND r.status = 'going'`,

                    [event.id]

                );

                const rsvpUserIds = new Set(rsvpResult.rows.map(r => r.discord_user_id));

                console.log(`[${event.name}] Found ${rsvpUserIds.size} user(s) with 'going' status in DB.`);

                

                let updatesMadeForEvent = 0;

                for (const discordUserId of reactionUserIds) {

                    if (!rsvpUserIds.has(discordUserId)) {

                        console.log(`[${event.name}] -- ❗️ Found missing RSVP for Discord user ${discordUserId}.`);

                        const userResult = await query('SELECT id FROM users WHERE discord_user_id = 
', [discordUserId]);

                        if (userResult.rows.length > 0) {

                            const internalUserId = userResult.rows[0].id;

                            await query(

                                `INSERT INTO rsvps (user_id, event_id, status, source, rsvp_at) 

                                 VALUES (
, $2, 'going', 'reconciler', NOW()) 

                                 ON CONFLICT (user_id, event_id) DO UPDATE SET status = 'going'`,

                                [internalUserId, event.id]

                            );

                            console.log(`[${event.name}] -- ✅ Synced RSVP for ${discordUserId}.`);

                            updatesMadeForEvent++;

                        } else {

                            console.log(`[${event.name}] -- ⚠️ User with Discord ID ${discordUserId} who reacted is not in the users table.`);

                        }

                    }

                }



                if(updatesMadeForEvent > 0) {

                    console.log(`[${event.name}] Synced ${updatesMadeForEvent} missing RSVP(s).`);

                    totalUpdates += updatesMadeForEvent;

                } else {

                    console.log(`[${event.name}] All RSVPs are in sync.`);

                }

            } catch (error) {

                console.error(`[${event.name}] ❌ An error occurred:`, error.message);

            }

        }



        if (totalUpdates > 0) {

            console.log(`\n✅ Finished reconciliation. Synced a total of ${totalUpdates} missing RSVP(s).`);

        } else {

            console.log('\n✅ Finished reconciliation. All events are in sync.');

        }

    } catch (error) {

        console.error('❌ An unexpected error occurred during reconciliation:', error);

    } finally {

        client.destroy();

    }

};



main().catch(console.error);


