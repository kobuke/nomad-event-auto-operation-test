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

        const secrets = {
            DISCORD_BOT_TOKEN: process.env.DISCORD_BOT_TOKEN,
            STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
            STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
            DATABASE_URL: process.env.DATABASE_URL,
            GOOGLE_PRIVATE_KEY: process.env.GOOGLE_PRIVATE_KEY,
            GOOGLE_SERVICE_ACCOUNT_EMAIL: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        };

        settings = { ...dbSettings, ...secrets };
        console.log('✅ Settings loaded successfully.');

    } catch (error) {
        console.error('❌ FATAL: Could not load settings from database. Please check DB connection.', error);
        // In a real app, you might want to exit if settings can't be loaded.
        // For now, we'll proceed with env vars only as a fallback.
        settings = { ...process.env };
    }
};

// Export a getter function to ensure settings are accessed after they are loaded.
const getSettings = () => {
    return settings;
};

export default getSettings;
