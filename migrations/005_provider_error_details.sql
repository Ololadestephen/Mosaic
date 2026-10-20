-- Only the adapter's redacted diagnostic allowlist is stored here, never raw responses.
ALTER TABLE analysis_runs ADD COLUMN provider_error_details jsonb
  CHECK (provider_error_details IS NULL OR jsonb_typeof(provider_error_details) = 'object');
