import { query } from './db.js';
import dotenv from 'dotenv';

dotenv.config();

let settings = {};

/**
 * Loads settings from the app_settings table and merges them with secrets from process.env.
 * This should be called once on application startup.
 */
export const loadSettings = async () => {
    console.log('⚙️  Loading settings...');
    let dbSettings = {};
    try {
        const { rows } = await query('SELECT key, value FROM app_settings');
        for (const row of rows) {
            dbSettings[row.key] = row.value;
        }
        console.log('✅ Settings loaded from database.');
    } catch (error) {
        console.error('DB: Error loading settings from database:', error);
        console.warn('⚠️ Could not load settings from database. Continuing with environment variables only.');
    }

    // Merge database settings with environment variables.
    // Environment variables take precedence.
    settings = { ...dbSettings, ...process.env };

    console.log('✅ All settings loaded and merged.');

    // Post-load checks for essential settings
    if (!settings.DISCORD_GUILD_ID) {
        console.error('❌ CRITICAL: DISCORD_GUILD_ID is not set in settings (DB or ENV).');
    }
};

// Export a getter function to ensure settings are accessed after they are loaded.
const getSettings = () => {
    return settings;
};

export default getSettings;
