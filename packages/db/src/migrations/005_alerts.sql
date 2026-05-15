CREATE TABLE alert_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id  UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  channel_type TEXT NOT NULL CHECK (channel_type IN ('email', 'slack', 'discord')),
  status       TEXT NOT NULL CHECK (status IN ('sent', 'failed')),
  error        TEXT,
  sent_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
