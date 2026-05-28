-- On-call schedules define rotation windows for who receives alerts
CREATE TABLE oncall_schedules (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name         TEXT        NOT NULL,
  timezone     TEXT        NOT NULL DEFAULT 'UTC',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Each layer is one person's on-call window within a schedule
CREATE TABLE oncall_layers (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id UUID        NOT NULL REFERENCES oncall_schedules(id) ON DELETE CASCADE,
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Weekday bitmask: bit 0 = Mon, bit 6 = Sun
  weekdays    INTEGER     NOT NULL DEFAULT 127,
  start_hour  SMALLINT    NOT NULL DEFAULT 0  CHECK (start_hour BETWEEN 0 AND 23),
  end_hour    SMALLINT    NOT NULL DEFAULT 23 CHECK (end_hour  BETWEEN 0 AND 23),
  priority    SMALLINT    NOT NULL DEFAULT 1  CHECK (priority  > 0),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Escalation policies define who gets alerted and in what order after an incident opens
CREATE TABLE escalation_policies (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name         TEXT        NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE escalation_steps (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id   UUID        NOT NULL REFERENCES escalation_policies(id) ON DELETE CASCADE,
  step_order  SMALLINT    NOT NULL,
  -- target: user_id or schedule_id (one must be set)
  user_id     UUID        REFERENCES users(id) ON DELETE CASCADE,
  schedule_id UUID        REFERENCES oncall_schedules(id) ON DELETE CASCADE,
  -- channel: email | slack | discord | pagerduty
  channel     TEXT        NOT NULL DEFAULT 'email',
  delay_mins  SMALLINT    NOT NULL DEFAULT 0,
  CONSTRAINT chk_escalation_target CHECK (
    (user_id IS NOT NULL)::int + (schedule_id IS NOT NULL)::int = 1
  )
);

-- Link monitors to an escalation policy
ALTER TABLE monitors ADD COLUMN IF NOT EXISTS escalation_policy_id UUID
  REFERENCES escalation_policies(id) ON DELETE SET NULL;

-- Silence windows suppress alerts during planned downtime
CREATE TABLE maintenance_windows (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name         TEXT        NOT NULL,
  starts_at    TIMESTAMPTZ NOT NULL,
  ends_at      TIMESTAMPTZ NOT NULL,
  monitor_ids  UUID[]      NOT NULL DEFAULT '{}', -- empty = all monitors
  created_by   UUID        REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_window_order CHECK (ends_at > starts_at)
);

CREATE INDEX idx_mw_workspace_active ON maintenance_windows(workspace_id, ends_at DESC)
  WHERE ends_at > NOW();

CREATE INDEX idx_escalation_steps_policy ON escalation_steps(policy_id, step_order);
