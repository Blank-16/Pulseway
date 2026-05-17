ALTER TABLE monitors
  ADD CONSTRAINT IF NOT EXISTS chk_interval_seconds
  CHECK (check_interval_seconds IN (30, 60, 300, 600));
