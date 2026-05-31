-- Extend channel_type to support webhooks
ALTER TABLE notification_channels
  DROP CONSTRAINT IF EXISTS notification_channels_channel_type_check;

ALTER TABLE notification_channels
  ADD CONSTRAINT notification_channels_channel_type_check
  CHECK (channel_type IN ('email', 'slack', 'discord', 'webhook'));

-- Per-channel webhook secret for HMAC-SHA256 request signing
ALTER TABLE notification_channels
  ADD COLUMN IF NOT EXISTS webhook_secret TEXT;

-- Delivery log for webhook retries (separate from alert_log for granularity)
CREATE TABLE webhook_deliveries (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id     UUID        NOT NULL REFERENCES notification_channels(id) ON DELETE CASCADE,
  incident_id    UUID        NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  event_type     TEXT        NOT NULL,
  payload_hash   TEXT        NOT NULL,
  status         TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','success','failed')),
  attempt_count  SMALLINT    NOT NULL DEFAULT 0,
  last_http_code INTEGER,
  error_message  TEXT,
  next_retry_at  TIMESTAMPTZ,
  delivered_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_wh_deliveries_retry ON webhook_deliveries(next_retry_at)
  WHERE status = 'pending' AND next_retry_at IS NOT NULL;
