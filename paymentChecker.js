import { Client, GatewayIntentBits } from 'discord.js';
import { query } from './db.js';
import getSettings, { loadSettings } from './settings.js';
import stripe from 'stripe';

const main = async () => {
    await loadSettings();
    const settings = getSettings();

    const stripeClient = new stripe(settings.STRIPE_SECRET_KEY);
    const discordClient = new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMembers,
            GatewayIntentBits.DirectMessages,
        ],
    });

    console.log('🚀 Starting check for unsent payment links with database...');
    let newPaymentLinksCount = 0;

    try {
        await discordClient.login(settings.DISCORD_BOT_TOKEN);
        console.log(`Logged in to Discord as ${discordClient.user.tag}`);

        const eventsResult = await query('SELECT id, name, price_jpy FROM events WHERE price_jpy > 0');
        const paidEvents = eventsResult.rows;

        if (paidEvents.length === 0) {
            console.log('🗓️ No paid events found. Exiting.');
            return;
        }

        for (const event of paidEvents) {
            console.log(`[${event.name}] Processing event...`);

            const usersToPayResult = await query(
                `SELECT u.id AS user_id, u.discord_user_id, u.username
                 FROM rsvps r
                 JOIN users u ON r.user_id = u.id
                 LEFT JOIN payments p ON u.id = p.user_id AND r.event_id = p.event_id
                 WHERE r.event_id = $1 AND r.status = 'going'
                   AND (p.status IS NULL OR (p.status != 'dm_sent' AND p.status != 'paid'))`,
                [event.id]
            );
            const usersToPay = usersToPayResult.rows;

            if (usersToPay.length === 0) {
                console.log(`[${event.name}] No users found needing payment links.`);
                continue;
            }

            console.log(`[${event.name}] Found ${usersToPay.length} users who need payment links.`);

            for (const user of usersToPay) {
                try {
                    const discordUser = await discordClient.users.fetch(user.discord_user_id);
                    if (discordUser) {
                        const session = await stripeClient.checkout.sessions.create({
                            payment_method_types: ['card'],
                            line_items: [{
                                price_data: { currency: 'jpy', product_data: { name: event.name }, unit_amount: event.price_jpy },
                                quantity: 1,
                            }],
                            mode: 'payment',
                            success_url: `https://${settings.RAILWAY_PUBLIC_DOMAIN}/success`,
                            cancel_url: `https://${settings.RAILWAY_PUBLIC_DOMAIN}/cancel`,
                            metadata: { discord_id: user.discord_user_id, event_id: event.id },
                        });

                        await discordUser.send(
                            `Hello ${user.username}!

` +
                            `We noticed you've RSVP'd for "${event.name}" but haven't received a payment link. Here it is:
${session.url}

` +
                            `This payment link expires in 24 hours.`
                        );
                        console.log(`[${event.name}] ✅ Successfully sent payment link to ${user.username}.`);
                        newPaymentLinksCount++;

                        await query(
                            `INSERT INTO payments (user_id, event_id, status, amount_jpy, payment_link_url, stripe_session_id, dm_sent_at)
                             VALUES ($1, $2, 'dm_sent', $3, $4, $5, NOW())
                             ON CONFLICT (user_id, event_id)
                             DO UPDATE SET status = 'dm_sent', payment_link_url = $4, stripe_session_id = $5, dm_sent_at = NOW(), updated_at = NOW()`,
                            [user.user_id, event.id, event.price_jpy, session.url, session.id]
                        );
                    }
                } catch (error) {
                    if (error.code === 50007) {
                        console.error(`[${event.name}] ❌ Failed to send DM to ${user.username}. They may have DMs disabled.`);
                    } else {
                        console.error(`[${event.name}] ❌ An error occurred for ${user.username}:`, error);
                    }
                }
            }
        }
    } catch (error) {
        console.error('❌ An unexpected error occurred in checkUnsentPayments:', error);
    } finally {
        console.log('✅ Finished checking for unsent payment links.');
        console.log(`Total new payment links sent: ${newPaymentLinksCount}`);
        discordClient.destroy();
    }
};

main().catch(console.error);