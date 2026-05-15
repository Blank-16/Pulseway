-- Stripe event idempotency — prevents duplicate processing
CREATE TABLE stripe_events (
  id           TEXT PRIMARY KEY,
  event_type   TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
