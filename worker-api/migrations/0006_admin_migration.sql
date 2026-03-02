-- Admin API migration: add missing columns for GCS tracking and report locks
ALTER TABLE users ADD COLUMN gcs_last_deduction_at INTEGER;
ALTER TABLE users ADD COLUMN warning_issued_at INTEGER;
ALTER TABLE report_locks ADD COLUMN display_name TEXT;
