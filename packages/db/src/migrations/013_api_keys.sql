CREATE TABLE api_keys (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name         TEXT        NOT NULL,
  key_hash     TEXT        NOT NULL UNIQUE,
  key_prefix   TEXT        NOT NULL,
  role         TEXT        NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin', 'viewer')),
  last_used_at TIMESTAMPTZ,
  expires_at   TIMESTAMPTZ,
  revoked      BOOLEAN     NOT NULL DEFAULT false,
  created_by   UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_api_keys_workspace_id ON api_keys(workspace_id) WHERE revoked = false;
CREATE INDEX idx_api_keys_key_hash     ON api_keys(key_hash)     WHERE revoked = false;
