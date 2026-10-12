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

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS csrf TEXT NOT NULL DEFAULT '';

-- Two-step sign-in with an authenticator app, one-time recovery codes
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_last_step BIGINT NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_since TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS recovery_codes JSONB NOT NULL DEFAULT '[]';

-- Between the password and the code: a short-lived half sign-in
CREATE TABLE IF NOT EXISTS mfa_pending (
  id TEXT PRIMARY KEY,                -- sha256 of the cookie token
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  next TEXT NOT NULL DEFAULT '/admin/',
  tries INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL
);

-- Every sign-in, successful or not (shown under Settings)
CREATE TABLE IF NOT EXISTS signins (
  id SERIAL PRIMARY KEY,
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  username TEXT NOT NULL DEFAULT '',
  ok BOOLEAN NOT NULL,
  step TEXT NOT NULL DEFAULT 'password',
  ip_hash TEXT NOT NULL DEFAULT '',
  ip_hint TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS signins_at ON signins(at DESC);

-- The site has one manager: the database itself refuses a second account
DO $$ BEGIN IF (SELECT count(*) FROM users) <= 1 THEN CREATE UNIQUE INDEX IF NOT EXISTS users_single ON users ((true)); END IF; END $$;

-- Shop: products, payment links and orders (Cardcom). Prices are in agorot.
-- The price in the database is what gets charged; the browser never sends one.
CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price_agorot INTEGER NOT NULL CHECK (price_agorot > 0),
  max_payments INTEGER NOT NULL DEFAULT 1 CHECK (max_payments BETWEEN 1 AND 36),
  page_path TEXT NOT NULL DEFAULT '',          -- the page that shows its buy button
  ravmesser_list TEXT NOT NULL DEFAULT '',     -- buyers join this Rav-Messer list
  position INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A charge with no product and no page (registration fee, deposit, agreed price): /pay/<token>/
CREATE TABLE IF NOT EXISTS payment_links (
  id SERIAL PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  amount_agorot INTEGER NOT NULL CHECK (amount_agorot > 0),
  max_payments INTEGER NOT NULL DEFAULT 1 CHECK (max_payments BETWEEN 1 AND 36),
  max_uses INTEGER CHECK (max_uses IS NULL OR max_uses >= 1),
  expires_at TIMESTAMPTZ,
  ravmesser_list TEXT NOT NULL DEFAULT '',
  internal_note TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per checkout: 'pending' when the payment page opens, 'paid' once Cardcom confirms
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,                         -- random UUID, sent to Cardcom as ReturnValue
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  payment_link_id INTEGER REFERENCES payment_links(id) ON DELETE SET NULL,
  title TEXT NOT NULL DEFAULT '',              -- what was bought, as it was called then
  amount_agorot INTEGER NOT NULL,
  num_payments INTEGER,
  customer_name TEXT NOT NULL DEFAULT '',      -- as the buyer typed it for us, else the card owner
  customer_email TEXT NOT NULL DEFAULT '',
  customer_phone TEXT NOT NULL DEFAULT '',
  card_owner_name TEXT NOT NULL DEFAULT '',    -- as Cardcom reports it
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed', 'refunded')),
  fulfillment TEXT NOT NULL DEFAULT 'not_required' CHECK (fulfillment IN ('not_required', 'pending', 'sent', 'failed')),
  lowprofile_id TEXT,
  transaction_id TEXT,
  approval_number TEXT,
  invoice_number TEXT,
  card_last4 TEXT,
  page TEXT NOT NULL DEFAULT '',
  paid_at TIMESTAMPTZ,
  fulfilled_at TIMESTAMPTZ,
  error_detail TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS orders_created ON orders(created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS orders_lowprofile ON orders(lowprofile_id) WHERE lowprofile_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS orders_link ON orders(payment_link_id) WHERE payment_link_id IS NOT NULL;
