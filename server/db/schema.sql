-- Users table
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  pro_expires_at TIMESTAMP WITH TIME ZONE NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Promo redemptions (track codes and usage)
CREATE TABLE promo_codes (
  code TEXT PRIMARY KEY,
  description TEXT,
  expires_at TIMESTAMP WITH TIME ZONE,
  max_uses INT DEFAULT 1,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE TABLE promo_redemptions (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL REFERENCES promo_codes(code) ON DELETE CASCADE,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  redeemed_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Usage limits / quotas
CREATE TABLE usage_counters (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period_start TIMESTAMP WITH TIME ZONE NOT NULL,
  rename_count INT DEFAULT 0,
  zip_count INT DEFAULT 0,
  UNIQUE(user_id, period_start)
);
