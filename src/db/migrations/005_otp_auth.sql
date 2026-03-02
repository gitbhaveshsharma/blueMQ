-- 005: Add email column to apps + create OTPs table for email-based auth

ALTER TABLE apps ADD COLUMN IF NOT EXISTS email VARCHAR(255);

CREATE TABLE IF NOT EXISTS otps (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       VARCHAR(255) NOT NULL,
  code        VARCHAR(6)   NOT NULL,
  purpose     VARCHAR(32)  NOT NULL,     -- 'register' | 'login'
  app_id      VARCHAR(64),               -- only for register
  app_name    VARCHAR(255),              -- only for register
  expires_at  TIMESTAMPTZ  NOT NULL,
  verified    BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_otps_email_purpose
  ON otps (email, purpose, created_at DESC);
