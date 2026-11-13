CREATE TABLE serv_coverage_attempts (
  id uuid PRIMARY KEY,
  actor_id uuid NOT NULL REFERENCES users(id),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX serv_coverage_attempts_started ON serv_coverage_attempts(started_at);
CREATE INDEX serv_coverage_attempts_actor ON serv_coverage_attempts(actor_id);
