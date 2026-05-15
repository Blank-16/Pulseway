-- Email verification tokens table.
-- token_hash is SHA-256 of the raw token sent to the user (never stored plaintext).
-- Single-use: used_at set on first redemption; subsequent calls are rejected.
CREATE TABLE email_verification_tokens (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT        NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_evt_token_hash ON email_verification_tokens(token_hash)
  WHERE used_at IS NULL;

CREATE INDEX idx_evt_user_id ON email_verification_tokens(user_id)
  WHERE used_at IS NULL;

-- Prune used/expired tokens — add to the same pg_cron job as refresh tokens
CREATE OR REPLACE FUNCTION prune_email_verification_tokens() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM email_verification_tokens
  WHERE expires_at < NOW() - INTERVAL '1 day'
     OR used_at IS NOT NULL;
END;
$$;
