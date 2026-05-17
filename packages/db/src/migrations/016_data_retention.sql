-- Function called by pg_cron or EventBridge Lambda monthly.
-- Deletes check_results beyond plan-specific retention windows.
CREATE OR REPLACE FUNCTION prune_check_results_by_plan() RETURNS TABLE(workspace_id UUID, deleted_count BIGINT)
LANGUAGE plpgsql AS $$
DECLARE
  ws RECORD;
  deleted BIGINT;
BEGIN
  FOR ws IN
    SELECT id, plan FROM workspaces
  LOOP
    deleted := 0;
    CASE ws.plan
      WHEN 'free' THEN
        DELETE FROM check_results cr
        USING monitors m
        WHERE cr.monitor_id = m.id
          AND m.workspace_id = ws.id
          AND cr.checked_at < NOW() - INTERVAL '7 days';
        GET DIAGNOSTICS deleted = ROW_COUNT;
      WHEN 'pro' THEN
        DELETE FROM check_results cr
        USING monitors m
        WHERE cr.monitor_id = m.id
          AND m.workspace_id = ws.id
          AND cr.checked_at < NOW() - INTERVAL '30 days';
        GET DIAGNOSTICS deleted = ROW_COUNT;
      WHEN 'team' THEN
        DELETE FROM check_results cr
        USING monitors m
        WHERE cr.monitor_id = m.id
          AND m.workspace_id = ws.id
          AND cr.checked_at < NOW() - INTERVAL '90 days';
        GET DIAGNOSTICS deleted = ROW_COUNT;
    END CASE;
    IF deleted > 0 THEN
      RETURN QUERY SELECT ws.id, deleted;
    END IF;
  END LOOP;
END;
$$;
