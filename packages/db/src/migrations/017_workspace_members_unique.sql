-- workspace_members should have had this from the start.
-- The ON CONFLICT DO UPDATE in addMember already assumes it exists;
-- this makes it explicit and adds the partial index for active member lookups.
ALTER TABLE workspace_members
  ADD CONSTRAINT IF NOT EXISTS uq_workspace_members_user_workspace
  UNIQUE (user_id, workspace_id);

CREATE INDEX IF NOT EXISTS idx_workspace_members_workspace
  ON workspace_members(workspace_id);
