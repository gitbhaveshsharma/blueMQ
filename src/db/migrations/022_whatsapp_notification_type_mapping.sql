-- =============================================
-- 022: Add notification_type mapping to whatsapp_meta_templates
-- =============================================
-- This allows mapping generic notification types with conditions
-- to WhatsApp-specific template names.
--
-- Example:
--   notification_type: "fee_receipt_reminder"
--   condition_key: "due_offset_days"
--   condition_value: "1"
--   → maps to WhatsApp template: "fee_reminder_upcoming_util"

ALTER TABLE whatsapp_meta_templates
  ADD COLUMN IF NOT EXISTS notification_type VARCHAR(512),
  ADD COLUMN IF NOT EXISTS condition_key VARCHAR(128),
  ADD COLUMN IF NOT EXISTS condition_value VARCHAR(255);

-- Create index for lookup by notification_type with conditions
CREATE INDEX IF NOT EXISTS idx_whatsapp_meta_templates_notification_type
  ON whatsapp_meta_templates (app_id, entity_id, notification_type, condition_key, condition_value, status)
  WHERE notification_type IS NOT NULL;

-- Create index for lookup without conditions
CREATE INDEX IF NOT EXISTS idx_whatsapp_meta_templates_notification_type_simple
  ON whatsapp_meta_templates (app_id, entity_id, notification_type, status)
  WHERE notification_type IS NOT NULL AND condition_key IS NULL;

-- Add comments
COMMENT ON COLUMN whatsapp_meta_templates.notification_type IS 
  'Generic notification type (e.g. "fee_receipt_reminder", "attendance_marked"). Maps to WhatsApp-specific template name.';

COMMENT ON COLUMN whatsapp_meta_templates.condition_key IS 
  'Optional condition key to match variants (e.g. "due_offset_days", "request_status"). Must match the condition_key from templates table.';

COMMENT ON COLUMN whatsapp_meta_templates.condition_value IS 
  'Optional condition value to match variants (e.g. "1", "APPROVED"). Must match the condition_value from templates table.';



-- Map fee_reminder templates
UPDATE whatsapp_meta_templates
SET notification_type = 'fee_receipt_reminder',
    condition_key = 'due_offset_days',
    condition_value = '1'
WHERE name = 'fee_reminder_upcoming_util';

UPDATE whatsapp_meta_templates
SET notification_type = 'fee_receipt_reminder',
    condition_key = 'due_offset_days',
    condition_value = '0'
WHERE name = 'fee_reminder_due_util';

UPDATE whatsapp_meta_templates
SET notification_type = 'fee_receipt_reminder',
    condition_key = 'due_offset_days',
    condition_value = '-1'
WHERE name = 'fee_reminder_overdue_util';

-- Map attendance_marked (same name)
UPDATE whatsapp_meta_templates
SET notification_type = 'attendance_marked'
WHERE name = 'attendance_marked';
