-- Optional response body assertions evaluated after each check
ALTER TABLE monitors
  ADD COLUMN IF NOT EXISTS body_contains       TEXT,       -- substring match (case-sensitive)
  ADD COLUMN IF NOT EXISTS body_json_path      TEXT,       -- JSONPath expression e.g. $.status
  ADD COLUMN IF NOT EXISTS body_json_value     TEXT;       -- expected value at that path

-- check_results: add failure_reason so incident messages are descriptive
ALTER TABLE check_results
  ADD COLUMN IF NOT EXISTS failure_reason TEXT;
