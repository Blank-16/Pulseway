-- Simple feature flag system.
-- Global flags (workspace_id IS NULL) apply to all workspaces.
-- Workspace-specific flags override global flags.
CREATE TABLE feature_flags (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  flag_name    TEXT        NOT NULL,
  workspace_id UUID        REFERENCES workspaces(id) ON DELETE CASCADE,
  enabled      BOOLEAN     NOT NULL DEFAULT false,
  rollout_pct  SMALLINT    NOT NULL DEFAULT 100 CHECK (rollout_pct BETWEEN 0 AND 100),
  description  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_flag_workspace UNIQUE (flag_name, workspace_id)
);

-- Partial index for global flag lookups
CREATE INDEX idx_ff_global ON feature_flags(flag_name) WHERE workspace_id IS NULL;
CREATE INDEX idx_ff_workspace ON feature_flags(flag_name, workspace_id) WHERE workspace_id IS NOT NULL;

-- Seed some initial flags
INSERT INTO feature_flags (flag_name, enabled, description) VALUES
  ('body_assertions',   false, 'Response body assertion checks on monitors'),
  ('webhook_channel',   true,  'Webhook notification channel type'),
  ('public_status_page',true,  'Public status page at /status/:slug'),
  ('multi_region',      false, 'Multi-region check distribution'),
  ('oncall_schedules',  false, 'On-call scheduling and escalation policies');
