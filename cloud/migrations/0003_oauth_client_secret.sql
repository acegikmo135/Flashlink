-- Confidential OAuth clients (e.g. Gemini/ChatGPT connectors that ask for a client secret).
ALTER TABLE oauth_clients ADD COLUMN secret_hash TEXT;
