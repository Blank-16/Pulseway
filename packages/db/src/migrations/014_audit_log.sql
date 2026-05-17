CREATE TABLE audit_events (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID        REFERENCES workspaces(id) ON DELETE SET NULL,
  actor_id      UUID        REFERENCES users(id) ON DELETE SET NULL,
  auth_method   TEXT        NOT NULL DEFAULT 'jwt' CHECK (auth_method IN ('jwt', 'api_key')),
  action        TEXT        NOT NULL,
  resource_type TEXT        NOT NULL,
  resource_id   TEXT,
  diff          JSONB,
  ip            INET,
  user_agent    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Audit log is append-only — no UPDATE/DELETE permissions should be granted
CREATE INDEX idx_audit_workspace_created ON audit_events(workspace_id, created_at DESC);
CREATE INDEX idx_audit_actor             ON audit_events(actor_id, created_at DESC);
