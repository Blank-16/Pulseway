-- Prevents duplicate open incidents per monitor at the DB level.
-- Only one open/acknowledged incident allowed per monitor at a time.
CREATE UNIQUE INDEX idx_incidents_one_open_per_monitor
  ON incidents(monitor_id)
  WHERE status IN ('open', 'acknowledged');

-- Partial index for fast lookup of open incidents (already partial in 007 but make explicit)
-- Drop the old one first if it exists
DROP INDEX IF EXISTS idx_incidents_open;
CREATE INDEX idx_incidents_open_acknowledged
  ON incidents(monitor_id, status)
  WHERE status IN ('open', 'acknowledged');
