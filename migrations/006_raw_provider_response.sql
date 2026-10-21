-- Exact bounded response body, separate from resolved proposals and redacted error diagnostics.
-- Internal audit only: retain the analysis run's workspace/private-source visibility; never expose in API DTOs or logs.
ALTER TABLE analysis_runs ADD COLUMN raw_provider_response text
  CHECK (octet_length(raw_provider_response) <= 250000);
