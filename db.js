import pkg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false, // Required for some cloud providers like Heroku/Railway
  },
});

export const query = async (text, params) => {
  try {
    const res = await pool.query(text, params);
    return res;
  } catch (error) {
    console.error('DB: Error executing query:', text, params, error);
    throw error; // Re-throw the error so it can be caught by the caller
  }
};

export const getClient = () => pool.connect();
