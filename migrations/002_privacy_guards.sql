CREATE FUNCTION guard_source_visibility() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
    OR NEW.owner_id IS DISTINCT FROM OLD.owner_id
    OR NEW.visibility IS DISTINCT FROM OLD.visibility THEN
    RAISE EXCEPTION 'Source visibility and ownership cannot be changed implicitly' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER source_privacy_boundary BEFORE UPDATE ON sources FOR EACH ROW EXECUTE FUNCTION guard_source_visibility();

CREATE FUNCTION guard_derived_visibility() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_owner uuid; source_visibility text; restricted uuid;
BEGIN
  SELECT s.owner_id, s.visibility INTO source_owner, source_visibility
  FROM source_versions v JOIN sources s ON s.id = v.source_id AND s.workspace_id = v.workspace_id
  WHERE v.workspace_id = NEW.workspace_id AND v.id = NEW.source_version_id;
  IF TG_TABLE_NAME = 'task_evidence' THEN
    SELECT t.restricted_to INTO restricted FROM tasks t WHERE t.workspace_id = NEW.workspace_id AND t.id = NEW.task_id;
  ELSE
    restricted := NEW.restricted_to;
  END IF;
  IF source_visibility = 'private' AND restricted IS DISTINCT FROM source_owner THEN
    RAISE EXCEPTION 'Private source derivatives must remain private' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER private_task_evidence BEFORE INSERT ON task_evidence FOR EACH ROW EXECUTE FUNCTION guard_derived_visibility();
CREATE TRIGGER private_proposals BEFORE INSERT OR UPDATE ON change_sets FOR EACH ROW EXECUTE FUNCTION guard_derived_visibility();
CREATE TRIGGER private_decisions BEFORE INSERT OR UPDATE ON decisions FOR EACH ROW EXECUTE FUNCTION guard_derived_visibility();
CREATE TRIGGER private_analysis BEFORE INSERT OR UPDATE ON analysis_runs FOR EACH ROW EXECUTE FUNCTION guard_derived_visibility();
