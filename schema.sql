CREATE TABLE IF NOT EXISTS app_settings (
    key VARCHAR(255) PRIMARY KEY,
    value TEXT
);

CREATE TABLE IF NOT EXISTS users (
    discord_user_id VARCHAR(255) PRIMARY KEY,
    username VARCHAR(255) NOT NULL,
    display_name VARCHAR(255),
    role VARCHAR(255) -- e.g., 'Left', 'Admin', 'Member', can be NULL
);

CREATE TABLE IF NOT EXISTS events (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    start_at TIMESTAMP WITH TIME ZONE NOT NULL,
    price_jpy INTEGER,
    max_capacity INTEGER,
    reaction_emoji VARCHAR(255),
    discord_message_id VARCHAR(255),
    discord_thread_id VARCHAR(255),
    deadline_at TIMESTAMP WITH TIME ZONE,
    remind1_at TIMESTAMP WITH TIME ZONE,
    remind2_at TIMESTAMP WITH TIME ZONE
);

CREATE TABLE IF NOT EXISTS rsvps (
    event_id INTEGER NOT NULL REFERENCES events(id),
    user_id VARCHAR(255) NOT NULL REFERENCES users(discord_user_id),
    status VARCHAR(255) NOT NULL, -- e.g., 'going', 'not_going', 'maybe'
    PRIMARY KEY (event_id, user_id)
);

CREATE TABLE IF NOT EXISTS payments (
    event_id INTEGER NOT NULL REFERENCES events(id),
    user_id VARCHAR(255) NOT NULL REFERENCES users(discord_user_id),
    status VARCHAR(255) NOT NULL, -- e.g., 'paid', 'pending', 'failed'
    PRIMARY KEY (event_id, user_id)
);