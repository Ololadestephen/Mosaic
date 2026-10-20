CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE CHECK (email = lower(email)),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE TABLE rate_limits (
  key text PRIMARY KEY,
  attempts integer NOT NULL DEFAULT 1,
  window_start timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE memberships (
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  user_id uuid NOT NULL REFERENCES users(id),
  role text NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
  PRIMARY KEY (workspace_id, user_id)
);
CREATE INDEX memberships_user ON memberships(user_id);
CREATE TABLE sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  owner_id uuid NOT NULL,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 180),
  visibility text NOT NULL CHECK (visibility IN ('workspace', 'private')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, owner_id) REFERENCES memberships(workspace_id, user_id)
);
CREATE TABLE source_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  source_id uuid NOT NULL,
  predecessor_id uuid,
  number integer NOT NULL CHECK (number > 0),
  text text NOT NULL CHECK (length(text) BETWEEN 1 AND 20000),
  content_hash text NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, source_id, id),
  UNIQUE (workspace_id, source_id, number),
  UNIQUE NULLS NOT DISTINCT (workspace_id, source_id, predecessor_id, content_hash),
  FOREIGN KEY (workspace_id, source_id) REFERENCES sources(workspace_id, id),
  FOREIGN KEY (workspace_id, source_id, predecessor_id) REFERENCES source_versions(workspace_id, source_id, id),
  FOREIGN KEY (workspace_id, created_by) REFERENCES memberships(workspace_id, user_id)
);
CREATE TABLE tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 180),
  status text NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'done')),
  assignee_id uuid,
  due_date date,
  restricted_to uuid,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  lineage jsonb NOT NULL DEFAULT '{}',
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, assignee_id) REFERENCES memberships(workspace_id, user_id),
  FOREIGN KEY (workspace_id, restricted_to) REFERENCES memberships(workspace_id, user_id)
);
CREATE INDEX tasks_workspace ON tasks(workspace_id, archived, created_at);
CREATE TABLE task_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  task_id uuid NOT NULL,
  source_version_id uuid NOT NULL,
  start_offset integer NOT NULL CHECK (start_offset >= 0),
  end_offset integer NOT NULL CHECK (end_offset > start_offset),
  quote text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id, task_id) REFERENCES tasks(workspace_id, id),
  FOREIGN KEY (workspace_id, source_version_id) REFERENCES source_versions(workspace_id, id)
);
CREATE TABLE change_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  source_version_id uuid NOT NULL,
  created_by uuid NOT NULL,
  restricted_to uuid,
  revision integer NOT NULL DEFAULT 1,
  state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'applied')),
  items jsonb NOT NULL,
  questions jsonb NOT NULL,
  preserved jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, source_version_id),
  FOREIGN KEY (workspace_id, source_version_id) REFERENCES source_versions(workspace_id, id),
  FOREIGN KEY (workspace_id, created_by) REFERENCES memberships(workspace_id, user_id),
  FOREIGN KEY (workspace_id, restricted_to) REFERENCES memberships(workspace_id, user_id)
);
CREATE TABLE analysis_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  source_version_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  restricted_to uuid,
  status text NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  model text NOT NULL,
  prompt_version text NOT NULL,
  reserved_usd numeric(12,6) NOT NULL CHECK (reserved_usd >= 0),
  error_code text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, source_version_id) REFERENCES source_versions(workspace_id, id),
  FOREIGN KEY (workspace_id, actor_id) REFERENCES memberships(workspace_id, user_id),
  FOREIGN KEY (workspace_id, restricted_to) REFERENCES memberships(workspace_id, user_id)
);
CREATE UNIQUE INDEX one_running_analysis ON analysis_runs(workspace_id, source_version_id) WHERE status = 'running';
CREATE INDEX analysis_usage ON analysis_runs(actor_id, started_at);
CREATE TABLE execution_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  operation text NOT NULL CHECK (operation IN ('apply', 'edit', 'create', 'undo')),
  operation_key uuid NOT NULL,
  request_hash text NOT NULL,
  restricted_to uuid,
  target_batch_id uuid,
  change_set_id uuid,
  changes jsonb NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, actor_id, operation, operation_key),
  FOREIGN KEY (workspace_id, actor_id) REFERENCES memberships(workspace_id, user_id),
  FOREIGN KEY (workspace_id, restricted_to) REFERENCES memberships(workspace_id, user_id),
  FOREIGN KEY (workspace_id, target_batch_id) REFERENCES execution_batches(workspace_id, id),
  FOREIGN KEY (workspace_id, change_set_id) REFERENCES change_sets(workspace_id, id)
);
CREATE UNIQUE INDEX one_compensation ON execution_batches(workspace_id, target_batch_id) WHERE operation = 'undo';
CREATE UNIQUE INDEX one_apply ON execution_batches(workspace_id, change_set_id) WHERE operation = 'apply';
CREATE TABLE change_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  batch_id uuid NOT NULL,
  task_id uuid NOT NULL,
  field text NOT NULL CHECK (field IN ('created', 'status', 'assigneeId', 'dueDate')),
  before_value text,
  after_value text,
  mutation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id, batch_id) REFERENCES execution_batches(workspace_id, id),
  FOREIGN KEY (workspace_id, task_id) REFERENCES tasks(workspace_id, id)
);
CREATE INDEX events_task ON change_events(workspace_id, task_id, created_at);
CREATE TABLE decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  source_version_id uuid NOT NULL,
  restricted_to uuid,
  statement text NOT NULL,
  citations jsonb NOT NULL,
  needs_review boolean NOT NULL DEFAULT false,
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id, source_version_id) REFERENCES source_versions(workspace_id, id),
  FOREIGN KEY (workspace_id, restricted_to) REFERENCES memberships(workspace_id, user_id)
);
CREATE FUNCTION reject_immutable_write() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'This record is immutable' USING ERRCODE = 'integrity_constraint_violation';
END;
$$;
CREATE TRIGGER immutable_sources BEFORE UPDATE OR DELETE ON source_versions FOR EACH ROW EXECUTE FUNCTION reject_immutable_write();
CREATE TRIGGER immutable_batches BEFORE UPDATE OR DELETE ON execution_batches FOR EACH ROW EXECUTE FUNCTION reject_immutable_write();
CREATE TRIGGER immutable_events BEFORE UPDATE OR DELETE ON change_events FOR EACH ROW EXECUTE FUNCTION reject_immutable_write();
CREATE TRIGGER immutable_evidence BEFORE UPDATE OR DELETE ON task_evidence FOR EACH ROW EXECUTE FUNCTION reject_immutable_write();
