
import { Client, GatewayIntentBits } from 'discord.js';
import { getSheetData, getEventDetailsFromSheet, updatePaymentStatusInSheet } from './googleSheetHandler.js';
import dotenv from 'dotenv';
import stripe from 'stripe';

dotenv.config();

const stripeClient = new stripe(process.env.STRIPE_SECRET_KEY);
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages,
  ],
});

export const checkUnsentPayments = async () => {
  console.log('🚀 Starting check for unsent payment links...');
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.DirectMessages,
    ],
  });

  let newPaymentLinksCount = 0; // Initialize counter

  try {
    console.log('Attempting to log in to Discord...');
    await client.login(process.env.DISCORD_BOT_TOKEN);



    const [events, rsvpData, paymentsData, usersData] = await Promise.all([
      getSheetData('Event Setting'),
      getSheetData('RSVP'),
      getSheetData('Payments'),
      getSheetData('Users'),
    ]);

    // 2. Create a map for userName -> userId
    const userMap = new Map(usersData.slice(1).map(row => [row[0], row[1]])); // userName -> userId

    // 3. Get header rows to find column indices
    const rsvpHeader = rsvpData[0];
    const paymentsHeader = paymentsData[0];
    const paymentsUserNameCol = paymentsData.map(row => row[0]); // Column A is User Name

    const eventsToProcess = events.slice(1).filter(eventRow => eventRow[0]); // Filter out empty event name rows

    // 4. Iterate through each event
    for (const eventRow of eventsToProcess) {
      const eventName = eventRow[0];
      const eventFee = parseFloat(eventRow[6]); // Corrected: Assuming fee is in column G (index 6)

      if (!eventName || isNaN(eventFee) || eventFee <= 0) {
        console.log(`[${eventName}] Skipping event with no name or zero/invalid fee.`);
        continue;
      }

      const rsvpEventCol = rsvpHeader.indexOf(eventName);
      const paymentEventCol = paymentsHeader.indexOf(eventName);

      if (rsvpEventCol === -1) {
        console.log(`[${eventName}] Event not found in RSVP sheet. Skipping.`);
        continue;
      }
      if (paymentEventCol === -1) {
        console.log(`[${eventName}] Event not found in Payments sheet. Skipping.`);
        continue;
      }

      console.log(`[${eventName}] Processing event...`);

      // 5. Find users who RSVP'd but have no payment status
      for (let i = 1; i < rsvpData.length; i++) {
        const rsvpRow = rsvpData[i];
        const userName = rsvpRow[0];
        const rsvpStatus = rsvpRow[rsvpEventCol];

        if (rsvpStatus) { // User has RSVP'd
          const userId = userMap.get(userName);
          if (!userId) {
            console.log(`[${eventName}] ⚠️ User '${userName}' from RSVP sheet not found in Users sheet. Cannot get userId.`);
            continue;
          }

          const paymentUserRowIndex = paymentsUserNameCol.indexOf(userName);
          let currentPaymentStatus = '';
          if (paymentUserRowIndex > -1) {
            currentPaymentStatus = paymentsData[paymentUserRowIndex][paymentEventCol];
          }

          console.log(`[DEBUG] User ID: ${userId}`);
          console.log(`[DEBUG] paymentUserRowIndex: ${paymentUserRowIndex}`);
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
                            metadata: { discord_id: user.discord_user_id, event_id: event.name },
                        });

                        await discordUser.send(
                            `Hello ${user.username}!\n\n` +
                            `We noticed you've RSVP'd for "${event.name}" but haven't received a payment link. Here it is:\n${session.url}\n\n` +
                            `This payment link expires in 24 hours.`
                        );
                        console.log(`[${event.name}] ✅ Successfully sent payment link to ${user.username}.`);
                        newPaymentLinksCount++;

                        await query(
                            `INSERT INTO payments (user_id, event_id, status, amount_jpy, payment_link_url, dm_sent_at)
                             VALUES ($1, $2, 'dm_sent', $3, $4, NOW())
                             ON CONFLICT (user_id, event_id)
                             DO UPDATE SET status = 'dm_sent', payment_link_url = $4, dm_sent_at = NOW(), updated_at = NOW()`,
                            [user.user_id, event.id, event.price_jpy, session.url]
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
            console.log(`[${eventName}] ❗️ Found user who needs payment link: ${userName} (ID: ${userId})`);

                            // 6. Send payment link
                        try {
                          const member = await client.users.fetch(userId);
                          if (member) {
                            const session = await stripeClient.checkout.sessions.create({
                              payment_method_types: ['card'],
                              line_items: [{
                                price_data: {
                                  currency: 'jpy',
                                  product_data: { name: eventName },
                                  unit_amount: eventFee,
                                },
                                quantity: 1,
                              }],
                              mode: 'payment',
                              success_url: `https://${process.env.RAILWAY_PUBLIC_DOMAIN}/success`,
                              cancel_url: `https://${process.env.RAILWAY_PUBLIC_DOMAIN}/cancel`,
                              metadata: { discord_id: userId, event_id: eventName },
                            });
            
                            await member.send(
                              `Hello ${userName}!\n\n` +
                              `We noticed you've RSVP'd for "${eventName}" but haven't received a payment link. Here it is:\n${session.url}\n\n` +
                              `This payment link expires in 24 hours. If the payment link expires, please RSVP again.\n\n` +
                              `Thank you for your understanding! 🙏`
                            );
                            console.log(`[${eventName}] ✅ Successfully sent payment link to ${userName}.`);
                            newPaymentLinksCount++; // Increment counter
                            
                            await updatePaymentStatusInSheet(userId, eventName, 'DM Sent');
                          }
                        } catch (error) {
                          if (error.code === 50007) {
                            console.error(`[${eventName}] ❌ Failed to send DM to ${userName} (ID: ${userId}). They may have DMs disabled.`, error.message);
                          } else {
                            console.error(`[${eventName}] ❌ An error occurred while creating Stripe session for ${userName} (ID: ${userId}):`, error);
                          }
                        }          }
        }
      }
    }
  } catch (error) {
    console.error('❌ An unexpected error occurred in checkUnsentPayments:', error);
  } finally {
    console.log('✅ Finished checking for unsent payment links.');
    console.log(`Total new payment links sent: ${newPaymentLinksCount}`);
    client.destroy();
  }
};
