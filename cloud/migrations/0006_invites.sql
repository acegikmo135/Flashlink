-- Invite codes (multiple, single- or multi-use, revocable) and public invite requests.
CREATE TABLE IF NOT EXISTS invite_codes (
  id TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL UNIQUE,   -- SHA-256 of the canonical code; the code itself is shown once at creation
  code_hint TEXT NOT NULL,          -- last 4 characters, for the admin list
  label TEXT,
  email TEXT,                       -- who it was issued to, if known
  max_uses INTEGER NOT NULL DEFAULT 1,
  uses INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER,
  request_id TEXT
);

CREATE TABLE IF NOT EXISTS invite_requests (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  name TEXT,
  message TEXT,
  status TEXT NOT NULL DEFAULT 'pending',   -- pending | approved | rejected
  ip_hash TEXT,
  created_at INTEGER NOT NULL,
  handled_at INTEGER,
  invite_id TEXT,
  mail_status TEXT                          -- result of the admin notification mail
);
CREATE INDEX IF NOT EXISTS idx_invite_requests_status ON invite_requests(status, created_at);
CREATE INDEX IF NOT EXISTS idx_invite_requests_email ON invite_requests(email);

ALTER TABLE users ADD COLUMN invite_id TEXT;
