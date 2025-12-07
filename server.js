
import express from 'express';
import bodyParser from 'body-parser';
import stripe from 'stripe';
import { query } from './db.js';
import { Client as DiscordClient, IntentsBitField } from 'discord.js';
import getSettings, { loadSettings } from './settings.js';

// --- Database Helper Functions ---

const getEventDetailsFromDb = async (eventName) => {
  try {
    const res = await query('SELECT name, price_jpy FROM events WHERE name = $1', [eventName]);
    if (res.rows.length === 0) return null;
    return { title: res.rows[0].name, fee: res.rows[0].price_jpy };
  } catch (error) {
    console.error('Error getting event details from DB:', error);
    return null;
  }
};

const updatePaymentStatusInDb = async (discordId, eventId, paymentStatus) => {
  try {
    const userRes = await query('SELECT id FROM users WHERE discord_user_id = $1', [discordId]);
    if (userRes.rows.length === 0) {
      console.error(`[DB Helper] User with Discord ID ${discordId} not found in DB.`);
      return { success: false, eventName: null };
    }
    const userId = userRes.rows[0].id;

    const eventExistsRes = await query('SELECT id, name FROM events WHERE id = $1', [eventId]);
    if (eventExistsRes.rows.length === 0) {
      console.error(`[DB Helper] Event with ID ${eventId} not found in DB.`);
      return { success: false, eventName: null };
    }
    const eventName = eventExistsRes.rows[0].name;

    const updatePaymentRes = await query(
      `UPDATE payments SET status = $1, paid_at = CASE WHEN $1::payment_status = 'paid'::payment_status THEN NOW() ELSE paid_at END WHERE user_id = $2 AND event_id = $3`,
      [paymentStatus, userId, eventId]
    );
    if (updatePaymentRes.rowCount === 0 && paymentStatus === 'paid') {
        console.error(`[DB Helper] WARNING: No existing payment record found to update for User ID: ${userId}, Event ID: ${eventId}.`);
    }


    if (paymentStatus === 'paid') {
      await query(
        `INSERT INTO rsvps (user_id, event_id, status, source)
         VALUES ($1, $2, 'going', 'payment')
         ON CONFLICT (user_id, event_id)
         DO UPDATE SET status = 'going', updated_at = NOW()`,
        [userId, eventId]
      );
    }
    console.log(`✅ [DB Helper] Payment status updated to '${paymentStatus}' for user ${discordId} for event ID ${eventId} (${eventName}).`);
    return { success: true, eventName: eventName };
  } catch (error) {
    console.error(`❌ [DB Helper] Error in updatePaymentStatusInDb:`, error);
    return { success: false, eventName: null };
  }
};


// --- Main Application ---

const main = async () => {
    // Catch unhandled promise rejections globally
    process.on('unhandledRejection', (reason, promise) => {
        console.error('Server: Unhandled Rejection at:', promise, 'reason:', reason);
        // Application specific error logging, cleanup, or exit
        // process.exit(1); // Uncomment to exit on unhandled rejection
    });

    await loadSettings();
    const settings = getSettings();

    const stripeClient = new stripe(settings.STRIPE_SECRET_KEY);
    const discordClient = new DiscordClient({
        intents: [
            IntentsBitField.Flags.Guilds,
            IntentsBitField.Flags.GuildMessages,
            IntentsBitField.Flags.MessageContent,
            IntentsBitField.Flags.DirectMessages,
        ],
    });

    discordClient.login(settings.DISCORD_BOT_TOKEN);
    discordClient.on('ready', () => {
        console.log(`Logged in to Discord as ${discordClient.user.tag}`);
    });

    const app = express();
    const PORT = process.env.PORT || 8080;

    app.use(express.static('public'));
        app.use(bodyParser.json());
        app.use(bodyParser.raw({ type: 'application/json' }));
    
        // Test route for debugging logging
        app.get('/test', (req, res) => {
            console.log('Server: /test route hit successfully.');
            res.send('Test route OK');
        });
    
        // --- Stripe Endpoints ---
        // Apply raw body parser ONLY to the Stripe webhook endpoint to preserve the raw body for signature verification.
        app.post('/stripe-webhook', async (req, res) => {
            const sig = req.headers['stripe-signature'];
            let event;
            try {
                event = stripeClient.webhooks.constructEvent(req.body, sig, settings.STRIPE_WEBHOOK_SECRET);
                console.log(`[Stripe Webhook] Webhook received: ${event.type}`); // Keep this high-level log
            } catch (err) {
                console.log(`⚠️ [Stripe Webhook] Webhook signature verification failed:`, err.message);
                return res.sendStatus(400);
            }
            if (event.type === 'checkout.session.completed') {
                const session = event.data.object;
                const discordId = session.metadata?.discord_id;
                const eventId = session.metadata?.event_id;

                if (!discordId || !eventId) {
                    console.error(`❌ [Stripe Webhook] Missing discordId or eventId in metadata. Discord ID: ${discordId}, Event ID: ${eventId}`);
                    return res.json({ status: 'missing data' });
                }

                const { success, eventName } = await updatePaymentStatusInDb(discordId, eventId, 'paid');

                if (success) {
                    try {
                        const user = await discordClient.users.fetch(discordId);
                        if (user && eventName) {
                            await user.send(`Your payment for ${eventName} has been completed! Thank you for participating.`);
                            console.log(`✅ [Stripe Webhook] Sent payment confirmation DM to ${user.username} for event ${eventName}.`);
                        } else if (!user) {
                            console.error(`❌ [Stripe Webhook] Failed to fetch Discord user object for Discord ID: ${discordId}. User object is null. DM not sent.`);
                        } else { // !eventName
                            console.error(`❌ [Stripe Webhook] Event name is null, cannot send DM. Discord ID: ${discordId}`);
                        }
                    } catch (dmError) {
                        console.error(`❌ [Stripe Webhook] Failed to send payment confirmation DM to ${discordId}:`, dmError);
                    }
                } else {
                    console.error(`❌ [Stripe Webhook] Payment status update failed in DB for Discord ID: ${discordId}, Event ID: ${eventId}. DM not sent.`);
                }
                res.json({ status: success ? 'success' : 'db update failed' });
            } else {
                console.log(`[Stripe Webhook] Event type ${event.type} ignored.`); // Keep this high-level log
                res.json({ status: 'ignored' });
            }
        });

        // Apply JSON body parser for all other API routes that expect JSON

    
        // --- API Endpoints ---
        const V_TABLES = ['events', 'users', 'rsvps', 'payments']; // Valid tables for security

        // Settings API (Specific routes, must be defined before generic ones)
        app.get('/api/settings', async (req, res) => {
            try {
                console.log('Server: /api/settings route hit.');
                // 1. Fetch existing settings from DB
                const dbSettingsRes = await query('SELECT key, value, description FROM app_settings');
                const dbSettingsMap = new Map(dbSettingsRes.rows.map(s => [s.key, s]));

                // 2. Define our specific default setting
                const zeroPaymentTestSetting = {
                    key: 'SEND_DM_FOR_ZERO_PAYMENT_TEST',
                    value: 'false', // Default as string for DB consistency
                    description: 'イベント参加費が0円の場合でもStripeのPaymentリンクがDMで届くようにします (テスト用途)',
                };

                // 3. Add/override with default if not present in DB
                if (!dbSettingsMap.has(zeroPaymentTestSetting.key)) {
                    dbSettingsMap.set(zeroPaymentTestSetting.key, zeroPaymentTestSetting);
                } else {
                    // Ensure the description is consistent even if key exists in DB without it
                    if (!dbSettingsMap.get(zeroPaymentTestSetting.key).description) {
                        dbSettingsMap.get(zeroPaymentTestSetting.key).description = zeroPaymentTestSetting.description;
                    }
                }
                
                // 4. Convert map values to array for response
                res.json(Array.from(dbSettingsMap.values()));

            } catch (error) {
                console.error('Server API: Error fetching settings (from specific route):', error);
                res.status(500).json({ error: 'Failed to fetch settings' });
            }
        });
    
        app.put('/api/settings', async (req, res) => {
            const { key, value } = req.body;
            if (!key || typeof value === 'undefined') {
                return res.status(400).json({ error: 'Missing key or value' });
            }

            // Get the description for the setting if it's our test setting
            const description = key === 'SEND_DM_FOR_ZERO_PAYMENT_TEST' ? 'イベント参加費が0円の場合でもStripeのPaymentリンクがDMで届くようにします (テスト用途)' : '';

            try {
                await query(
                    `INSERT INTO app_settings (key, value, description, updated_at)
                     VALUES ($1, $2, $3, NOW())
                     ON CONFLICT (key) DO UPDATE SET value = $2, description = $3, updated_at = NOW()`,
                    [key, value, description]
                );
                await loadSettings(); // Reload settings in memory
                res.json({ success: true, message: `Setting '${key}' updated.` });
            } catch (error) {
                console.error(`Server API: Error updating/inserting setting ${key}:`, error);
                res.status(500).json({ error: `Failed to update setting ${key}`});
            }
        });

        app.delete('/api/settings/:key', async (req, res) => {
            const { key } = req.params;
            if (!key) {
                return res.status(400).json({ error: 'Missing key' });
            }
            try {
                const result = await query('DELETE FROM app_settings WHERE key = $1', [key]);
                if (result.rowCount === 0) {
                    return res.status(404).json({ error: `Setting with key '${key}' not found.` });
                }
                await loadSettings(); // Reload settings in memory
                res.status(204).send(); // No Content
            } catch (error) {
                console.error(`Server API: Error deleting setting ${key}:`, error);
                res.status(500).json({ error: `Failed to delete setting ${key}`});
            }
        });

        // Dashboard Events API
        app.get('/api/dashboard/events', async (req, res) => {
            try {
                console.log('Server: /api/dashboard/events route hit.');
                const { rows } = await query(`
                    SELECT
                        e.id,
                        e.name AS title,
                        TO_CHAR(e.start_at, 'YYYY-MM-DD"T"HH24:MI:SS') || '+09:00' AS start_at,
                        e.price_jpy AS fee,
                        e.max_capacity,
                        e.reaction_emoji AS emoji,
                        e.discord_message_id,
                        e.discord_thread_id,
                        TO_CHAR(e.deadline_at, 'YYYY-MM-DD"T"HH24:MI:SS') || '+09:00' AS deadline_at,
                        TO_CHAR(e.remind1_at, 'YYYY-MM-DD"T"HH24:MI:SS') || '+09:00' AS remind1_at,
                        TO_CHAR(e.remind2_at, 'YYYY-MM-DD"T"HH24:MI:SS') || '+09:00' AS remind2_at,
                        COUNT(DISTINCT CASE WHEN r.status = 'going' THEN r.user_id ELSE NULL END) AS "currentParticipants",
                        COUNT(DISTINCT CASE WHEN p.status = 'paid' THEN p.user_id ELSE NULL END) AS "paidCount"
                    FROM
                        events e
                    LEFT JOIN
                        rsvps r ON e.id = r.event_id
                    LEFT JOIN
                        payments p ON e.id = p.event_id
                    GROUP BY
                        e.id
                    ORDER BY
                        e.start_at DESC;
                `);
                res.json(rows);
            } catch (error) {
                console.error('Server API: Error fetching dashboard events:', error);
                res.status(500).json({ error: 'Failed to fetch dashboard events' });
            }
        });

        // Event-specific APIs
        app.get('/api/events/:id/rsvps', async (req, res) => {
            const { id } = req.params;
            try {
                const { rows } = await query(`
                    SELECT
                        u.username,
                        u.display_name,
                        r.status,
                        r.rsvp_at
                    FROM
                        rsvps r
                    JOIN
                        users u ON r.user_id = u.id
                    WHERE
                        r.event_id = $1 AND r.status = 'going'
                    ORDER BY
                        r.rsvp_at ASC;
                `, [id]);
                res.json(rows);
            } catch (error) {
                console.error(`Server API: Error fetching RSVPs for event ${id}:`, error);
                res.status(500).json({ error: 'Failed to fetch RSVPs' });
            }
        });

        app.get('/api/events/:id/payments', async (req, res) => {
            const { id } = req.params;
            try {
                const { rows } = await query(`
                    SELECT
                        u.username,
                        u.display_name,
                        p.status,
                        p.amount_jpy,
                        p.paid_at,
                        p.dm_sent_at
                    FROM
                        payments p
                    JOIN
                        users u ON p.user_id = u.id
                    WHERE
                        p.event_id = $1 AND p.status IN ('paid', 'dm_sent')
                    ORDER BY
                        p.status DESC, p.paid_at ASC, p.dm_sent_at ASC;
                `, [id]);
                res.json(rows);
            } catch (error) {
                console.error(`Server API: Error fetching payments for event ${id}:`, error);
                res.status(500).json({ error: 'Failed to fetch payments' });
            }
        });
        
        
    // Generic GET all
    app.get('/api/:table', async (req, res) => {
        const { table } = req.params;
        if (!V_TABLES.includes(table)) return res.status(400).json({ error: 'Invalid table' });
        // Simplified queries for overview
            const queries = {
                events: 'SELECT * FROM events ORDER BY start_at DESC',
                users: 'SELECT id, discord_user_id, username, display_name, role FROM users ORDER BY created_at DESC',
                rsvps: `SELECT r.id, u.username, e.name as event_name, r.status, r.rsvp_at FROM rsvps r JOIN users u ON r.user_id = u.id JOIN events e ON r.event_id = e.id ORDER BY r.created_at DESC`,
                payments: `SELECT p.id, u.username, e.name as event_name, p.status, p.amount_jpy FROM payments p JOIN users u ON p.user_id = u.id JOIN events e ON p.event_id = e.id ORDER BY p.created_at DESC`,
            };
            try {
                const { rows } = await query(queries[table]);
                res.json(rows);
            }
            catch (e) { res.status(500).json({ error: e.message });}
    });
    // Get table schema for dynamic form generation
    app.get('/api/:table/schema', async (req, res) => {
        const { table } = req.params;
        if (!V_TABLES.includes(table)) return res.status(400).json({ error: 'Invalid table' });
        try {
            console.log(`Server API: Fetching schema for table: ${table}`);
            const schemaQuery = `
                SELECT 
                    column_name, 
                    data_type, 
                    is_nullable, 
                    udt_name 
                FROM information_schema.columns 
                WHERE table_schema = 'public' AND table_name = $1
                ORDER BY ordinal_position`;
            console.log(`Server API: Executing schema query: "${schemaQuery}" with param: "${table}"`);
            let { rows: columns } = await query(schemaQuery, [table]);

            // For ENUM types, fetch their allowed values
            for (let i = 0; i < columns.length; i++) {
                const col = columns[i];
                if (col.udt_name.startsWith('enum_')) {
                    const enumValuesQuery = `
                        SELECT e.enumlabel AS value
                        FROM pg_type t
                        JOIN pg_enum e ON t.oid = e.enumtypid
                        WHERE t.typname = $1
                        ORDER BY e.enumsortorder;
                    `;
                    const { rows: enumValues } = await query(enumValuesQuery, [col.udt_name]);
                    col.enumValues = enumValues.map(ev => ev.value);
                }
            }
            
            console.log(`Server API: Fetched schema for ${table}:`, columns);
            res.json(columns);
        } catch (e) { 
            console.error(`Server API: Error fetching schema for ${table}:`, e);
            res.status(500).json({ error: e.message }); 
        }
    });

    // Generic GET one
    app.get('/api/:table/:id', async (req, res) => {
        const { table, id } = req.params;
        if (!V_TABLES.includes(table)) return res.status(400).json({ error: 'Invalid table' });
        try {
            const { rows } = await query(`SELECT * FROM ${table} WHERE id = $1`, [id]);
            if (rows.length === 0) return res.status(404).json({ error: 'Record not found' });
            res.json(rows[0]);
        } catch (e) { 
            console.error(`Server API: Error fetching ${table} ID ${id}:`, e);
            res.status(500).json({ error: e.message }); 
        }
    });

    // Generic UPDATE one
    app.put('/api/:table/:id', async (req, res) => {
        const { table, id } = req.params;
        if (!V_TABLES.includes(table)) return res.status(400).json({ error: 'Invalid table' });
        
        const updates = req.body;
        delete updates.id; // cannot update id
        delete updates.created_at; // cannot update created_at
        updates.updated_at = new Date();

        // Convert boolean strings to actual booleans (from frontend forms)
        // Convert empty strings to null for optional fields
        for (const key in updates) {
            if (updates[key] === 'true') updates[key] = true;
            else if (updates[key] === 'false') updates[key] = false;
            // Assuming numeric fields that are optional might send empty string
            if (updates[key] === '') updates[key] = null; 
        }

        const setClause = Object.keys(updates).map((key, i) => `"${key}" = $${i + 1}`).join(', ');
        const values = Object.values(updates);

        if (setClause.length === 0) {
            console.warn(`Server API: No fields to update for ${table} ID ${id}`);
            return res.status(400).json({ error: 'No fields to update' });
        }
        
        try {
            console.log(`Server API: Attempting UPDATE on ${table} ID ${id}`);
            console.log(`Server API: SET clause: ${setClause}`);
            console.log(`Server API: Values: ${JSON.stringify(values)}`);
            const { rows } = await query(`UPDATE ${table} SET ${setClause} WHERE id = $${values.length + 1} RETURNING *`, [...values, id]);
            console.log(`Server API: Successfully updated ${table} ID ${id}.`);
            res.json(rows[0]);
        } catch (e) { 
            console.error(`Server API: Error updating ${table} ID ${id}:`, e);
            res.status(500).json({ error: e.message }); 
        }
    });

    // Generic DELETE one
    app.delete('/api/:table/:id', async (req, res) => {
        const { table, id } = req.params;
        if (!V_TABLES.includes(table)) return res.status(400).json({ error: 'Invalid table' });
        try {
            await query(`DELETE FROM ${table} WHERE id = $1`, [id]);
            res.status(204).send(); // No Content
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // Generic CREATE one
    app.post('/api/:table', async (req, res) => {
        const { table } = req.params;
        if (!V_TABLES.includes(table)) return res.status(400).json({ error: 'Invalid table' });
        
        const fields = req.body;

        // Convert boolean strings and, crucially, empty strings to null
        for (const key in fields) {
            if (fields[key] === 'true') fields[key] = true;
            else if (fields[key] === 'false') fields[key] = false;
            else if (fields[key] === '') fields[key] = null; 
        }

        // Basic validation
        if (table === 'events' && !fields.name) {
            return res.status(400).json({ error: 'Event name is required' });
        }

        const columns = Object.keys(fields).map(f => `"${f}"`).join(', ');
        const placeholders = Object.keys(fields).map((_, i) => `$${i + 1}`).join(', ');
        const values = Object.values(fields);

        if (columns.length === 0) return res.status(400).json({ error: 'No fields to insert' });

        try {
            const { rows } = await query(`INSERT INTO ${table} (${columns}) VALUES (${placeholders}) RETURNING *`, values);
            res.status(201).json(rows[0]);
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // --- Stripe Endpoints ---
    
    app.post('/create-checkout-session', async (req, res) => {
        const { eventId, userId } = req.body;
        if (!eventId || !userId) {
            return res.status(400).json({ error: 'Missing eventId or userId' });
        }
        try {
            const eventDetails = await getEventDetailsFromDb(eventId);
            if (!eventDetails) {
                return res.status(404).json({ error: 'Event not found or details missing' });
            }
            const session = await stripeClient.checkout.sessions.create({
                payment_method_types: ['card'],
                line_items: [{
                    price_data: { currency: 'jpy', product_data: { name: eventDetails.title }, unit_amount: eventDetails.fee },
                    quantity: 1,
                }],
                mode: 'payment',
                success_url: `https://${process.env.RAILWAY_PUBLIC_DOMAIN}/success`,
                cancel_url: `https://${process.env.RAILWAY_PUBLIC_DOMAIN}/cancel`,
                metadata: { discord_id: userId, event_id: eventId },
            });
            res.json({ url: session.url });
        } catch (error) {
            console.error('Error creating checkout session:', error);
            res.status(500).json({ error: error.message });
        }
    });

    app.post('/stripe-webhook', async (req, res) => {
        const sig = req.headers['stripe-signature'];
        let event;
        try {
            event = stripeClient.webhooks.constructEvent(req.body, sig, settings.STRIPE_WEBHOOK_SECRET);
            console.log(`[Stripe Webhook] Webhook received: ${event.type}`); // Keep this high-level log
        } catch (err) {
            console.log(`⚠️ [Stripe Webhook] Webhook signature verification failed:`, err.message);
            return res.sendStatus(400);
        }
        if (event.type === 'checkout.session.completed') {
            const session = event.data.object;
            const discordId = session.metadata?.discord_id;
            const eventId = session.metadata?.event_id;

            if (!discordId || !eventId) {
                console.error(`❌ [Stripe Webhook] Missing discordId or eventId in metadata. Discord ID: ${discordId}, Event ID: ${eventId}`);
                return res.json({ status: 'missing data' });
            }

            const { success, eventName } = await updatePaymentStatusInDb(discordId, eventId, 'paid');

            if (success) {
                try {
                    const user = await discordClient.users.fetch(discordId);
                    if (user && eventName) {
                        await user.send(`Your payment for ${eventName} has been completed! Thank you for participating.`);
                        console.log(`✅ [Stripe Webhook] Sent payment confirmation DM to ${user.username} for event ${eventName}.`);
                    } else if (!user) {
                        console.error(`❌ [Stripe Webhook] Failed to fetch Discord user object for Discord ID: ${discordId}. User object is null. DM not sent.`);
                    } else { // !eventName
                        console.error(`❌ [Stripe Webhook] Event name is null, cannot send DM. Discord ID: ${discordId}`);
                    }
                } catch (dmError) {
                    console.error(`❌ [Stripe Webhook] Failed to send payment confirmation DM to ${discordId}:`, dmError);
                }
            } else {
                console.error(`❌ [Stripe Webhook] Payment status update failed in DB for Discord ID: ${discordId}, Event ID: ${eventId}. DM not sent.`);
            }
            res.json({ status: success ? 'success' : 'db update failed' });
        } else {
            console.log(`[Stripe Webhook] Event type ${event.type} ignored.`); // Keep this high-level log
            res.json({ status: 'ignored' });
        }
    });

    // --- Static Pages ---
    app.get('/dashboard', (req, res) => res.sendFile('index.html', { root: 'public' }));
    app.get('/success', (req, res) => res.send('<h1>Payment Successful!</h1><p>Thank you!</p>'));
    app.get('/cancel', (req, res) => res.send('<h1>決済がキャンセルされました。</h1>'));

    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
};

main().catch(console.error);
