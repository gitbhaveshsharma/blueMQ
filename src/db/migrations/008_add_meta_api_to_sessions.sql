-- =============================================
-- Migration: Add Meta WhatsApp Cloud API support to whatsapp_sessions
-- =============================================
-- This migration adds columns to support Meta WhatsApp Cloud API
-- as an alternative provider to WAHA. Each coach/entity can choose
-- either 'waha' (QR scan) or 'meta' (API key) connection type.
--
-- Run: psql $DATABASE_URL -f src/db/migrations/008_add_meta_api_to_sessions.sql
-- =============================================

-- Add connection_type column (default 'waha' for backward compatibility)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'whatsapp_sessions' AND column_name = 'connection_type'
  ) THEN
    ALTER TABLE whatsapp_sessions
    ADD COLUMN connection_type VARCHAR(20) NOT NULL DEFAULT 'waha';
  END IF;
END $$;

-- Add meta_api_key column (coach's Meta permanent access token)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'whatsapp_sessions' AND column_name = 'meta_api_key'
  ) THEN
    ALTER TABLE whatsapp_sessions
    ADD COLUMN meta_api_key TEXT DEFAULT NULL;
  END IF;
END $$;

-- Add meta_phone_number_id column (Meta phone number ID)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'whatsapp_sessions' AND column_name = 'meta_phone_number_id'
  ) THEN
    ALTER TABLE whatsapp_sessions
    ADD COLUMN meta_phone_number_id VARCHAR(100) DEFAULT NULL;
  END IF;
END $$;

-- Add meta_business_account_id column (optional, for reference)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'whatsapp_sessions' AND column_name = 'meta_business_account_id'
  ) THEN
    ALTER TABLE whatsapp_sessions
    ADD COLUMN meta_business_account_id VARCHAR(100) DEFAULT NULL;
  END IF;
END $$;

-- Add CHECK constraint for connection_type (if not exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_name = 'whatsapp_sessions' AND constraint_name = 'chk_connection_type'
  ) THEN
    ALTER TABLE whatsapp_sessions
    ADD CONSTRAINT chk_connection_type CHECK (connection_type IN ('waha', 'meta'));
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Add comment for documentation
COMMENT ON COLUMN whatsapp_sessions.connection_type IS 'Provider type: waha (QR scan) or meta (API key)';
COMMENT ON COLUMN whatsapp_sessions.meta_api_key IS 'Meta WhatsApp Cloud API permanent access token (per-coach)';
COMMENT ON COLUMN whatsapp_sessions.meta_phone_number_id IS 'Meta WhatsApp phone number ID from Business Manager';
COMMENT ON COLUMN whatsapp_sessions.meta_business_account_id IS 'Meta Business Account ID (optional, for reference)';
