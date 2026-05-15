CREATE TABLE monitors (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id           UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name                   TEXT NOT NULL,
  url                    TEXT NOT NULL,
  http_method            TEXT NOT NULL DEFAULT 'GET'
                           CHECK (http_method IN ('GET', 'POST', 'HEAD')),
  request_headers        JSONB NOT NULL DEFAULT '{}',
  expected_status_code   INTEGER NOT NULL DEFAULT 200,
  check_interval_seconds INTEGER NOT NULL DEFAULT 60
                           CHECK (check_interval_seconds IN (30, 60, 300, 600)),
  region_codes           TEXT[] NOT NULL DEFAULT '{"us-east-1"}',
  is_active              BOOLEAN NOT NULL DEFAULT true,
  last_checked_at        TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE notification_channels (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  channel_type TEXT NOT NULL CHECK (channel_type IN ('email', 'slack', 'discord')),
  config       JSONB NOT NULL,
  is_active    BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
