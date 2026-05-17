ALTER TABLE refresh_tokens
  ADD COLUMN IF NOT EXISTS session_id UUID NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS device_name TEXT;

-- Index for efficient session-scoped revocation
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_session_id
  ON refresh_tokens(session_id)
  WHERE revoked = false;
