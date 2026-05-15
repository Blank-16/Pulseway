-- Index for pruning expired tokens efficiently
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires_at
  ON refresh_tokens(user_id, expires_at)
  WHERE revoked = false;

-- Prune function — call via pg_cron or scheduled ECS task monthly
CREATE OR REPLACE FUNCTION prune_expired_refresh_tokens() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM refresh_tokens
  WHERE expires_at < NOW() - INTERVAL '1 day'
     OR revoked = true;
END;
$$;
