-- OAuth 2.1 (authorization code + PKCE, dynamic client registration) for MCP connectors.
ALTER TABLE mcp_tokens ADD COLUMN expires_at INTEGER;   -- NULL = non-expiring (manually created tokens)
ALTER TABLE mcp_tokens ADD COLUMN client_id TEXT;       -- set for OAuth-issued access tokens

CREATE TABLE IF NOT EXISTS oauth_clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  redirect_uris TEXT NOT NULL,        -- JSON array
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS oauth_codes (
  code_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  resource TEXT,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS oauth_refresh (
  token_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  family TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_oauth_refresh_user ON oauth_refresh(user_id, client_id);
