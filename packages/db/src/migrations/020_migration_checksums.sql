-- Add checksum column to detect modified migration files after application
ALTER TABLE schema_migrations
  ADD COLUMN IF NOT EXISTS checksum TEXT;
