ALTER TABLE monitors
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS monitors_set_updated_at ON monitors;
CREATE TRIGGER monitors_set_updated_at
  BEFORE UPDATE ON monitors
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
