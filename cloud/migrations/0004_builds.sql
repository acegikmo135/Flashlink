-- Build history / cache. Firmware binaries are NEVER stored: only the build's metadata (hashes, sizes, stats)
-- plus the user's own source text, which lets a build be re-flashed by recompiling and checking the hash.
CREATE TABLE IF NOT EXISTS builds (
  user_id TEXT NOT NULL,
  id TEXT NOT NULL,                  -- bld_<first 12 hex of cache_key>
  cache_key TEXT NOT NULL,           -- sha256(board | sketch | extra files | libraries)
  board TEXT NOT NULL,
  sha256 TEXT NOT NULL,              -- of the compiled application image / hex
  size_bytes INTEGER NOT NULL,
  stats TEXT,
  libraries TEXT,                    -- JSON array
  sketch TEXT NOT NULL,
  files TEXT,                        -- JSON array of extra source files
  title TEXT,
  created_at INTEGER NOT NULL,
  last_built_at INTEGER NOT NULL,
  build_count INTEGER NOT NULL DEFAULT 1,
  flash_count INTEGER NOT NULL DEFAULT 0,
  last_job_id TEXT,
  last_flashed_at INTEGER,
  PRIMARY KEY (user_id, id)
);
CREATE INDEX IF NOT EXISTS idx_builds_user_built ON builds(user_id, last_built_at DESC);
