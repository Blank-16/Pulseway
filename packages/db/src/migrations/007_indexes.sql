CREATE INDEX idx_monitors_workspace ON monitors(workspace_id);
CREATE INDEX idx_monitors_active_due ON monitors(is_active, last_checked_at)
  WHERE is_active = true;
CREATE INDEX idx_check_results_monitor ON check_results(monitor_id, checked_at DESC);
CREATE INDEX idx_incidents_monitor_status ON incidents(monitor_id, status);
CREATE INDEX idx_incidents_open ON incidents(status) WHERE status = 'open';
CREATE INDEX idx_members_workspace ON workspace_members(workspace_id);
CREATE INDEX idx_refresh_tokens_hash ON refresh_tokens(token_hash);
CREATE INDEX idx_incident_timeline_incident ON incident_timeline(incident_id, created_at);
CREATE INDEX idx_alert_log_incident ON alert_log(incident_id);
