-- Supports keyset pagination on incidents: ORDER BY started_at DESC, id DESC
-- The partial filter on status also accelerates "open incidents" queries.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_incidents_workspace_keyset
  ON incidents (started_at DESC, id DESC)
  INCLUDE (monitor_id, status);
