ALTER TABLE analysis_runs
  ADD COLUMN provider_http_status integer CHECK (provider_http_status BETWEEN 400 AND 599),
  ADD COLUMN provider_error_code text CHECK (provider_error_code ~ '^[A-Z_]{1,40}$');
