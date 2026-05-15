CREATE TABLE check_results (
  id               UUID NOT NULL DEFAULT gen_random_uuid(),
  monitor_id       UUID NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  status           TEXT NOT NULL CHECK (status IN ('up', 'down', 'degraded')),
  status_code      INTEGER,
  response_time_ms INTEGER,
  error_message    TEXT,
  region           TEXT NOT NULL,
  checked_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, checked_at)
) PARTITION BY RANGE (checked_at);

-- Initial partitions — extend monthly via scheduled automation in production
CREATE TABLE check_results_2025_01 PARTITION OF check_results
  FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');
CREATE TABLE check_results_2025_02 PARTITION OF check_results
  FOR VALUES FROM ('2025-02-01') TO ('2025-03-01');
CREATE TABLE check_results_2025_03 PARTITION OF check_results
  FOR VALUES FROM ('2025-03-01') TO ('2025-04-01');
CREATE TABLE check_results_2025_04 PARTITION OF check_results
  FOR VALUES FROM ('2025-04-01') TO ('2025-05-01');
CREATE TABLE check_results_2025_05 PARTITION OF check_results
  FOR VALUES FROM ('2025-05-01') TO ('2025-06-01');
CREATE TABLE check_results_2025_06 PARTITION OF check_results
  FOR VALUES FROM ('2025-06-01') TO ('2025-07-01');
CREATE TABLE check_results_2025_07 PARTITION OF check_results
  FOR VALUES FROM ('2025-07-01') TO ('2025-08-01');
CREATE TABLE check_results_2025_08 PARTITION OF check_results
  FOR VALUES FROM ('2025-08-01') TO ('2025-09-01');
CREATE TABLE check_results_2025_09 PARTITION OF check_results
  FOR VALUES FROM ('2025-09-01') TO ('2025-10-01');
CREATE TABLE check_results_2025_10 PARTITION OF check_results
  FOR VALUES FROM ('2025-10-01') TO ('2025-11-01');
CREATE TABLE check_results_2025_11 PARTITION OF check_results
  FOR VALUES FROM ('2025-11-01') TO ('2025-12-01');
CREATE TABLE check_results_2025_12 PARTITION OF check_results
  FOR VALUES FROM ('2025-12-01') TO ('2026-01-01');
CREATE TABLE check_results_2026_01 PARTITION OF check_results
  FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
CREATE TABLE check_results_2026_02 PARTITION OF check_results
  FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');
CREATE TABLE check_results_2026_03 PARTITION OF check_results
  FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');
CREATE TABLE check_results_2026_04 PARTITION OF check_results
  FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');
CREATE TABLE check_results_2026_05 PARTITION OF check_results
  FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE check_results_2026_06 PARTITION OF check_results
  FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
CREATE TABLE check_results_2026_07 PARTITION OF check_results
  FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE check_results_2026_08 PARTITION OF check_results
  FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE check_results_2026_09 PARTITION OF check_results
  FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE check_results_2026_10 PARTITION OF check_results
  FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE check_results_2026_11 PARTITION OF check_results
  FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE TABLE check_results_2026_12 PARTITION OF check_results
  FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');
