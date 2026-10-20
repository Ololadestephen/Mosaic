ALTER TABLE analysis_runs
  ADD COLUMN provider text NOT NULL DEFAULT 'openrouter' CHECK (provider IN ('openrouter', 'gemini')),
  ADD COLUMN validation_id uuid,
  ADD COLUMN token_usage jsonb,
  ADD COLUMN duration_ms integer CHECK (duration_ms >= 0),
  ADD CONSTRAINT gemini_validation_required CHECK (provider <> 'gemini' OR validation_id IS NOT NULL);
CREATE INDEX analysis_validation_usage ON analysis_runs(provider, validation_id);
