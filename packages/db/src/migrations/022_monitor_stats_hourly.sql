CREATE TABLE monitor_stats_hourly (
  monitor_id       UUID        NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  hour_bucket      TIMESTAMPTZ NOT NULL,
  total_checks     INTEGER     NOT NULL DEFAULT 0,
  up_count         INTEGER     NOT NULL DEFAULT 0,
  down_count       INTEGER     NOT NULL DEFAULT 0,
  degraded_count   INTEGER     NOT NULL DEFAULT 0,
  p50_ms           INTEGER,
  p75_ms           INTEGER,
  p95_ms           INTEGER,
  p99_ms           INTEGER,
  PRIMARY KEY (monitor_id, hour_bucket)
);

CREATE INDEX idx_stats_monitor_hour ON monitor_stats_hourly(monitor_id, hour_bucket DESC);

-- Roll up check_results into hourly buckets.
-- Designed to be called incrementally: pass last_processed_at to avoid full scans.
CREATE OR REPLACE FUNCTION rollup_monitor_stats(cutoff TIMESTAMPTZ DEFAULT NOW() - INTERVAL '2 hours')
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO monitor_stats_hourly
    (monitor_id, hour_bucket, total_checks, up_count, down_count, degraded_count,
     p50_ms, p75_ms, p95_ms, p99_ms)
  SELECT
    monitor_id,
    date_trunc('hour', checked_at)                        AS hour_bucket,
    COUNT(*)                                              AS total_checks,
    COUNT(*) FILTER (WHERE status = 'up')                 AS up_count,
    COUNT(*) FILTER (WHERE status = 'down')               AS down_count,
    COUNT(*) FILTER (WHERE status = 'degraded')           AS degraded_count,
    PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY response_time_ms)::INTEGER AS p50_ms,
    PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY response_time_ms)::INTEGER AS p75_ms,
    PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY response_time_ms)::INTEGER AS p95_ms,
    PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY response_time_ms)::INTEGER AS p99_ms
  FROM check_results
  WHERE checked_at >= cutoff
    AND checked_at < date_trunc('hour', NOW())  -- only complete hours
  GROUP BY monitor_id, date_trunc('hour', checked_at)
  ON CONFLICT (monitor_id, hour_bucket) DO UPDATE SET
    total_checks   = EXCLUDED.total_checks,
    up_count       = EXCLUDED.up_count,
    down_count     = EXCLUDED.down_count,
    degraded_count = EXCLUDED.degraded_count,
    p50_ms         = EXCLUDED.p50_ms,
    p75_ms         = EXCLUDED.p75_ms,
    p95_ms         = EXCLUDED.p95_ms,
    p99_ms         = EXCLUDED.p99_ms;
END;
$$;
