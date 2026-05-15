-- Add replaced_by to support refresh token rotation (detect reuse of revoked tokens).
-- If a revoked token is presented and replaced_by IS NOT NULL, it indicates
-- a stolen token was used after legitimate rotation — trigger full session revocation.
ALTER TABLE refresh_tokens
  ADD COLUMN IF NOT EXISTS replaced_by UUID REFERENCES refresh_tokens(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_replaced_by
  ON refresh_tokens(replaced_by)
  WHERE replaced_by IS NOT NULL;
