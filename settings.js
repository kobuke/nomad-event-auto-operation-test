import { query } from './db.js';
import dotenv from 'dotenv';

dotenv.config();

let settings = {};

/**
 * Loads settings from the app_settings table and merges them with secrets from process.env.
 * This should be called once on application startup.
 */
export const loadSettings = async () => {
    console.log('⚙️  Loading settings from database...');
    try {
        const { rows } = await query('SELECT key, value FROM app_settings');
        const dbSettings = rows.reduce((acc, row) => {
            acc[row.key] = row.value;
            return acc;
        }, {});

        // Define default settings and merge with DB settings
        const defaultAppSettings = {
            SEND_DM_FOR_ZERO_PAYMENT_TEST: false, // New test setting, default to false
            // Add other default app settings here if any
        };

        const mergedAppSettings = { ...defaultAppSettings, ...dbSettings };

        const secrets = {
            DISCORD_BOT_TOKEN: process.env.DISCORD_BOT_TOKEN,
            STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
            STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
            DATABASE_URL: process.env.DATABASE_URL,
            GOOGLE_PRIVATE_KEY: process.env.GOOGLE_PRIVATE_KEY,
            GOOGLE_SERVICE_ACCOUNT_EMAIL: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        };

        // Final settings are merged app settings and secrets
        settings = { ...mergedAppSettings, ...secrets };
        console.log('✅ Settings loaded successfully.');

    } catch (error) {
        console.error('❌ FATAL: Could not load settings from database. Please check DB connection.', error);
        // Fallback to process.env if DB connection fails, ensure our new setting is also there as default
        settings = { ...process.env, SEND_DM_FOR_ZERO_PAYMENT_TEST: false }; // Fallback with default
    }
};

// Export a getter function to ensure settings are accessed after they are loaded.
const getSettings = () => {
    return settings;
};

export default getSettings;
