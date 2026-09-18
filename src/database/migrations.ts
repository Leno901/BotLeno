export const INIT_SQL = `
CREATE TABLE guilds (
  id TEXT PRIMARY KEY,
  timezone TEXT NOT NULL DEFAULT 'Asia/Manila',
  allow_multiple_queues INTEGER NOT NULL DEFAULT 0,
  staff_role_id TEXT,
  category_id TEXT,
  panel_channel_id TEXT,
  status_channel_id TEXT,
  admin_channel_id TEXT,
  panel_message_id TEXT,
  status_message_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE queues (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  emoji TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  min_hours REAL NOT NULL DEFAULT 0.5,
  max_hours REAL NOT NULL DEFAULT 24,
  max_size INTEGER,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'paused', 'closed')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  allow_leave INTEGER NOT NULL DEFAULT 1,
  entries_expire INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (guild_id, slug),
  FOREIGN KEY (guild_id) REFERENCES guilds(id) ON DELETE CASCADE
);

CREATE TABLE queue_entries (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  queue_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  sort_key INTEGER NOT NULL,
  duration_hours REAL NOT NULL CHECK (duration_hours > 0 AND duration_hours <= 24),
  available_until TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('waiting', 'active', 'completed', 'cancelled', 'expired', 'skipped')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (guild_id) REFERENCES guilds(id) ON DELETE CASCADE,
  FOREIGN KEY (queue_id) REFERENCES queues(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX idx_queue_entries_active_unique
  ON queue_entries(queue_id, user_id)
  WHERE status IN ('waiting', 'active');

CREATE INDEX idx_queue_entries_waiting_order
  ON queue_entries(queue_id, status, sort_key);

CREATE INDEX idx_queue_entries_guild_user
  ON queue_entries(guild_id, user_id, status);

CREATE INDEX idx_queue_entries_expiration
  ON queue_entries(status, available_until);

CREATE TABLE queue_history (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  queue_id TEXT,
  user_id TEXT,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  details TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (guild_id) REFERENCES guilds(id) ON DELETE CASCADE
);

CREATE INDEX idx_queue_history_guild_created
  ON queue_history(guild_id, created_at DESC);
`;

export const MIGRATIONS = [
  { id: "001_init", sql: INIT_SQL },
  {
    id: "002_duty_line_jobs",
    sql: `
ALTER TABLE queue_entries ADD COLUMN is_afk INTEGER NOT NULL DEFAULT 0;

CREATE TABLE queue_entry_jobs (
  entry_id TEXT NOT NULL,
  queue_id TEXT NOT NULL,
  PRIMARY KEY (entry_id, queue_id),
  FOREIGN KEY (entry_id) REFERENCES queue_entries(id) ON DELETE CASCADE,
  FOREIGN KEY (queue_id) REFERENCES queues(id) ON DELETE CASCADE
);

INSERT INTO queue_entry_jobs (entry_id, queue_id)
SELECT id, queue_id FROM queue_entries;

CREATE INDEX idx_queue_entry_jobs_queue ON queue_entry_jobs(queue_id);
`,
  },
  {
    id: "003_logs_channel",
    sql: `ALTER TABLE guilds ADD COLUMN logs_channel_id TEXT;`,
  },
  {
    id: "004_optional_hours",
    sql: `
PRAGMA foreign_keys = OFF;

CREATE TABLE queue_entries_new (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  queue_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  sort_key INTEGER NOT NULL,
  duration_hours REAL CHECK (duration_hours IS NULL OR (duration_hours > 0 AND duration_hours <= 24)),
  available_until TEXT,
  status TEXT NOT NULL CHECK (status IN ('waiting', 'active', 'completed', 'cancelled', 'expired', 'skipped')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  is_afk INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (guild_id) REFERENCES guilds(id) ON DELETE CASCADE,
  FOREIGN KEY (queue_id) REFERENCES queues(id) ON DELETE CASCADE
);

INSERT INTO queue_entries_new (
  id, guild_id, queue_id, user_id, sort_key, duration_hours,
  available_until, status, created_at, updated_at, is_afk
)
SELECT id, guild_id, queue_id, user_id, sort_key, duration_hours,
  available_until, status, created_at, updated_at, is_afk
FROM queue_entries;

DROP TABLE queue_entries;
ALTER TABLE queue_entries_new RENAME TO queue_entries;

CREATE UNIQUE INDEX idx_queue_entries_active_unique
  ON queue_entries(queue_id, user_id)
  WHERE status IN ('waiting', 'active');

CREATE INDEX idx_queue_entries_waiting_order
  ON queue_entries(queue_id, status, sort_key);

CREATE INDEX idx_queue_entries_guild_user
  ON queue_entries(guild_id, user_id, status);

CREATE INDEX idx_queue_entries_expiration
  ON queue_entries(status, available_until);

PRAGMA foreign_keys = ON;
`,
  },
  {
    // 004 rebuilt queue_entries inside a transaction, so PRAGMA foreign_keys=OFF
    // was a no-op and ON DELETE CASCADE wiped queue_entry_jobs.
    id: "005_restore_entry_jobs",
    sql: `
INSERT OR IGNORE INTO queue_entry_jobs (entry_id, queue_id)
SELECT id, queue_id FROM queue_entries;
`,
  },
  {
    id: "006_personal_status_channel",
    sql: `
ALTER TABLE queue_entries ADD COLUMN status_channel_id TEXT;
ALTER TABLE queue_entries ADD COLUMN status_message_id TEXT;
`,
  },
  {
    id: "007_status_category",
    sql: `ALTER TABLE guilds ADD COLUMN status_category_id TEXT;`,
  },
  {
    id: "008_offer_strikes",
    sql: `ALTER TABLE queue_entries ADD COLUMN offer_strikes INTEGER NOT NULL DEFAULT 0;`,
  },
  {
    id: "009_accepted_jobs",
    sql: `ALTER TABLE queue_entries ADD COLUMN accepted_job_ids TEXT;`,
  },
  {
    id: "010_job_hour_prefs",
    sql: `ALTER TABLE queue_entries ADD COLUMN job_hour_prefs TEXT;`,
  },
] as const;
