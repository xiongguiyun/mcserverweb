CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  minecraft_name TEXT,
  minecraft_uuid TEXT,
  skin_image TEXT,
  username_updated_at TEXT,
  totp_secret TEXT,
  totp_enabled INTEGER NOT NULL DEFAULT 0,
  last_seen_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  content_html TEXT NOT NULL,
  author_id INTEGER NOT NULL REFERENCES users(id),
  pinned INTEGER NOT NULL DEFAULT 0,
  views INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  excerpt TEXT NOT NULL,
  content_html TEXT NOT NULL,
  author_id INTEGER NOT NULL REFERENCES users(id),
  pinned INTEGER NOT NULL DEFAULT 0,
  views INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT,
  deleted_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content_html TEXT NOT NULL,
  quote_comment_id INTEGER REFERENCES comments(id) ON DELETE SET NULL,
  quote_author TEXT,
  quote_excerpt TEXT,
  deleted_at TEXT,
  deleted_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS post_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS comment_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  comment_id INTEGER NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS player_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reported_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS site_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS captcha_challenges (
  id TEXT PRIMARY KEY,
  target_x INTEGER NOT NULL,
  target_y INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL,
  verified_at TEXT,
  used_at TEXT
);

CREATE TABLE IF NOT EXISTS invite_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  used_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_announcements_created_at ON announcements(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_pinned_created_at ON posts(pinned DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_posts_deleted_at ON posts(deleted_at);
CREATE INDEX IF NOT EXISTS idx_announcements_deleted_at ON announcements(deleted_at);
CREATE INDEX IF NOT EXISTS idx_captcha_challenges_expires_at ON captcha_challenges(expires_at);
CREATE INDEX IF NOT EXISTS idx_comments_post_created_at ON comments(post_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comments_deleted_at ON comments(deleted_at);
CREATE INDEX IF NOT EXISTS idx_post_reports_status ON post_reports(status, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_post_reports_unique_open ON post_reports(post_id, reporter_id) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_comment_reports_status ON comment_reports(status, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_comment_reports_unique_open ON comment_reports(comment_id, reporter_id) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_player_reports_status ON player_reports(status, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_player_reports_unique_open ON player_reports(reported_user_id, reporter_id) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_invite_codes_used_by ON invite_codes(used_by);
CREATE UNIQUE INDEX IF NOT EXISTS idx_invite_codes_one_active_per_owner ON invite_codes(owner_id) WHERE used_at IS NULL;
