-- User-chosen names for boards ("Kitchen ESP32") so people and AIs don't confuse them. Metadata only.
CREATE TABLE IF NOT EXISTS device_names (
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  name TEXT NOT NULL COLLATE NOCASE,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, device_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_device_names_unique ON device_names(user_id, name);
