
import { Client, GatewayIntentBits, Partials } from 'discord.js';
import { query } from './db.js';
import getSettings, { loadSettings } from './settings.js';
import stripe from 'stripe';

const main = async () => {
    await loadSettings();
    const settings = getSettings();

    const stripeClient = new stripe(settings.STRIPE_SECRET_KEY);
    const GUILD_ID = settings.DISCORD_GUILD_ID;

    if (!GUILD_ID) {
      console.error('❌ DISCORD_GUILD_ID is not set in settings.');
    }

    const client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.DirectMessages,
      ],
      partials: [Partials.Message, Partials.Channel, Partials.Reaction],
    });

    /**
     * Handles database operations for a reaction add/remove.
     */
    const handleRsvpReaction = async (reaction, user, add) => {
      try {
        const eventRes = await query('SELECT * FROM events WHERE discord_message_id = $1', [reaction.message.id]);
        if (eventRes.rows.length === 0) return;
        const event = eventRes.rows[0];

        // Strip skin tone modifiers from emojis for comparison
        const skinToneRegex = /[\u{1F3FB}-\u{1F3FF}]/gu;
        const baseReactionEmoji = reaction.emoji.name.replace(skinToneRegex, '');
        const baseEventEmoji = event.reaction_emoji.replace(skinToneRegex, '');

        if (baseReactionEmoji !== baseEventEmoji) return;

        let userRes = await query('SELECT id FROM users WHERE discord_user_id = $1', [user.id]);
        let dbUserId;
        if (userRes.rows.length === 0) {
          const newUserRes = await query(
            'INSERT INTO users (discord_user_id, username, display_name) VALUES ($1, $2, $3) RETURNING id',
            [user.id, user.username, user.displayName]
          );
          dbUserId = newUserRes.rows[0].id;
        } else {
          dbUserId = userRes.rows[0].id;
        }

        if (add) {
          await query(
            `INSERT INTO rsvps (user_id, event_id, status, source, rsvp_at) 
             VALUES ($1, $2, 'going', 'reaction', NOW()) 
             ON CONFLICT (user_id, event_id) 
             DO UPDATE SET status = 'going', rsvp_at = NOW(), updated_at = NOW()`,
            [dbUserId, event.id]
          );
          
          const settingRes = await query("SELECT value FROM app_settings WHERE key = 'SEND_DM_FOR_ZERO_PAYMENT_TEST'");
          const sendDmForZeroPayment = settingRes.rows.length > 0 && settingRes.rows[0].value === 'true';

          if (event.price_jpy > 0 || sendDmForZeroPayment) {
            const session = await stripeClient.checkout.sessions.create({
              payment_method_types: ['card'],
              line_items: [{
                price_data: {
                  currency: 'jpy',
                  product_data: { name: event.name },
                  unit_amount: event.price_jpy,
                },
                quantity: 1,
              }],
              mode: 'payment',
              success_url: `https://${settings.RAILWAY_PUBLIC_DOMAIN}/success`,
              cancel_url: `https://${settings.RAILWAY_PUBLIC_DOMAIN}/cancel`,
              metadata: { discord_id: user.id, event_id: event.id, event_name: event.name },
            });

            await query(
              `INSERT INTO payments (user_id, event_id, status, amount_jpy, payment_link_url, stripe_session_id, dm_sent_at) 
               VALUES ($1, $2, 'dm_sent', $3, $4, $5, NOW()) 
               ON CONFLICT (user_id, event_id) 
               DO UPDATE SET status = 'dm_sent', payment_link_url = $4, stripe_session_id = $5, dm_sent_at = NOW(), updated_at = NOW()`,
              [dbUserId, event.id, event.price_jpy, session.url, session.id]
            );

            await user.send(
              `Hello ${user.username}!\n\n` +
              `Here is the payment page for the event "${event.name}":\n${session.url}\n\n` +
              `This payment link expires in 24 hours.`
            );
            console.log(`✅ Sent Stripe checkout link to ${user.username} for ${event.name}`);
          }
        } else { // Reaction Remove
          await query("UPDATE rsvps SET status = 'cancelled', cancelled_at = NOW() WHERE user_id = $1 AND event_id = $2", [dbUserId, event.id]);
          await query("UPDATE payments SET status = 'cancelled', cancelled_at = NOW() WHERE user_id = $1 AND event_id = $2", [dbUserId, event.id]);
          console.log(`✅ Cancelled RSVP for ${user.username} for event ${event.name}`);
        }

        await checkCapacity(reaction.message.channel, event);
      } catch (error) {
        console.error('❌ Failed to handle RSVP reaction:', error);
      }
    };

    /**
     * Checks event capacity and sends notifications if needed.
     */
    const checkCapacity = async (channel, event) => {
        if (!event.max_capacity || event.max_capacity <= 0) return;
        const rsvpCountRes = await query("SELECT COUNT(*) FROM rsvps WHERE event_id = $1 AND status = 'going'", [event.id]);
        const currentParticipants = parseInt(rsvpCountRes.rows[0].count, 10);
        const noticeSent = event.mc_required; 

        if (currentParticipants >= event.max_capacity && !noticeSent) {
          await channel.send(
            `🎉 **Heads up! ${event.name} has reached its maximum capacity of ${event.max_capacity} participants!** 🎉\n` +
            `We're so excited by the overwhelming interest! If a spot opens up, we'll let you know! ✨`
          );
          await query("UPDATE events SET mc_required = TRUE WHERE id = $1", [event.id]);
          console.log(`✅ Sent capacity reached message for event: ${event.name}`);
        } else if (currentParticipants < event.max_capacity && noticeSent) {
          await channel.send(
            `🔔 **Good news! A spot has opened up for ${event.name}!** 🔔\n` +
            `There's still a chance to join! Don't miss out! 🚀`
          );
          await query("UPDATE events SET mc_required = FALSE WHERE id = $1", [event.id]);
          console.log(`✅ Sent capacity available message for event: ${event.name}`);
        }
    }

    /**
     * Syncs all members of the guild with the users table.
     */
    const syncAllUsers = async () => {
      if (!GUILD_ID) {
        console.warn('⚠️ DISCORD_GUILD_ID not set. Skipping user sync.');
        return;
      }
      try {
        const guild = await client.guilds.fetch(GUILD_ID);
        const members = await guild.members.fetch();
        console.log(`Syncing ${members.size} members to the database...`);
        for (const member of members.values()) {
            if (member.user.bot) continue;
            await query(
                `INSERT INTO users (discord_user_id, username, display_name) 
                 VALUES ($1, $2, $3) 
                 ON CONFLICT (discord_user_id) 
                 DO UPDATE SET username = $2, display_name = $3, role = CASE WHEN users.role = 'Left' THEN NULL ELSE users.role END`,
[member.id, member.user.username, member.user.displayName]
            );
        }
        console.log('✅ User sync complete.');
      } catch(error) {
        console.error('❌ Failed to sync users:', error);
      }
    }

    client.on('ready', async () => {
      console.log(`Logged in as ${client.user.tag}!`);
      await syncAllUsers();
    });

    client.on('guildMemberAdd', async (member) => {
      if (member.user.bot) return;
      console.log(`New user "${member.user.username}" has joined the server.`);
      await query(
        `INSERT INTO users (discord_user_id, username, display_name) 
                  VALUES ($1, $2, $3)
                  ON CONFLICT (discord_user_id)
                  DO UPDATE SET username = $2, display_name = $3, role = NULL`,
                 [member.id, member.user.username, member.user.displayName]      );
    });

    client.on('guildMemberRemove', async (member) => {
      if (member.user.bot) return;
      console.log(`User "${member.user.username}" has left the server.`);
      await query("UPDATE users SET role = 'Left' WHERE discord_user_id = $1", [member.id]);
    });

    client.on('messageReactionAdd', async (reaction, user) => {
      if (user.bot) return;
      if (reaction.partial) await reaction.fetch();
      if (user.partial) await user.fetch();
      
      console.log(`[DB] Reaction added: ${reaction.emoji.name} by ${user.tag}`);
      await handleRsvpReaction(reaction, user, true);
    });

    client.on('messageReactionRemove', async (reaction, user) => {
      if (user.bot) return;
      if (reaction.partial) await reaction.fetch();
      if (user.partial) await user.fetch();

      console.log(`[DB] Reaction removed: ${reaction.emoji.name} by ${user.tag}`);
      await handleRsvpReaction(reaction, user, false);
    });

    client.login(settings.DISCORD_BOT_TOKEN);
};

main().catch(console.error);
