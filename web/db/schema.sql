-- Database schema (Postgres / Neon). Safe to run repeatedly.

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,                -- sha256 of the cookie token
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  ip TEXT, user_agent TEXT
);

CREATE TABLE IF NOT EXISTS password_resets (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS attempts (
  id SERIAL PRIMARY KEY,
  key TEXT NOT NULL,
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS attempts_key ON attempts(key, at);

CREATE TABLE IF NOT EXISTS leads (
  id SERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  name TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', message TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'contact',
  product TEXT,
  page TEXT NOT NULL DEFAULT '',
  ip_hash TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'new',
  notes TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS leads_created ON leads(created_at DESC);

-- Pages keep their exact HTML (the <main> element) from the migration;
-- lists inside them (<!--yk:...-->) are filled in live when rendering.
CREATE TABLE IF NOT EXISTS pages (
  path TEXT PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'page',
  title TEXT NOT NULL DEFAULT '',
  seo_title TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  og_type TEXT NOT NULL DEFAULT 'website',
  og_image TEXT NOT NULL DEFAULT '',
  canonical TEXT,
  noindex BOOLEAN NOT NULL DEFAULT false,
  ld JSONB,
  main TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS posts (
  id SERIAL PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  format TEXT NOT NULL DEFAULT 'legacy',  -- legacy: final HTML from the migration; rich: editor HTML
  excerpt TEXT NOT NULL DEFAULT '',
  seo_title TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  og_image TEXT NOT NULL DEFAULT '',
  noindex BOOLEAN NOT NULL DEFAULT false,
  categories JSONB NOT NULL DEFAULT '[]',
  tags JSONB NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'published',
  is_video BOOLEAN NOT NULL DEFAULT false,
  duplicate_of TEXT,
  wp_id INTEGER,
  date TIMESTAMP NOT NULL,
  modified TIMESTAMP NOT NULL
);
CREATE INDEX IF NOT EXISTS posts_date ON posts(date DESC);

CREATE TABLE IF NOT EXISTS terms (
  kind TEXT NOT NULL,          -- category | tag
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  PRIMARY KEY (kind, slug)
);

CREATE TABLE IF NOT EXISTS testimonials (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  show_on_home BOOLEAN NOT NULL DEFAULT false,
  published BOOLEAN NOT NULL DEFAULT true,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS redirects (
  id SERIAL PRIMARY KEY,
  source TEXT NOT NULL UNIQUE,
  target TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  hits INTEGER NOT NULL DEFAULT 0,
  last_hit TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notfound (
  path TEXT PRIMARY KEY,
  hits INTEGER NOT NULL DEFAULT 1,
  referrer TEXT NOT NULL DEFAULT '',
  first_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS revisions (
  id SERIAL PRIMARY KEY,
  path TEXT NOT NULL,
  kind TEXT NOT NULL,          -- page | post
  content JSONB NOT NULL,      -- the row as it was before the change
  note TEXT NOT NULL DEFAULT '',
  username TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS revisions_path ON revisions(path, id DESC);

CREATE TABLE IF NOT EXISTS activity (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT NOT NULL DEFAULT '',
  link TEXT NOT NULL DEFAULT '',
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS media (
  id SERIAL PRIMARY KEY,
  url TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  size INTEGER NOT NULL DEFAULT 0,
  width INTEGER, height INTEGER,
  content_type TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
