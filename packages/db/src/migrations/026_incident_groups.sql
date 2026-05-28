-- Groups related incidents opened within a short time window (shared infrastructure failure)
CREATE TABLE incident_groups (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title        TEXT        NOT NULL,
  root_cause   TEXT,
  started_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE incidents ADD COLUMN IF NOT EXISTS group_id UUID
  REFERENCES incident_groups(id) ON DELETE SET NULL;

CREATE INDEX idx_incident_groups_workspace ON incident_groups(workspace_id, started_at DESC);
CREATE INDEX idx_incidents_group ON incidents(group_id) WHERE group_id IS NOT NULL;
