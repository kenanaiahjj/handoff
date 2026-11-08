CREATE TRIGGER handoff_version_immutable_update
BEFORE UPDATE ON handoff_version
BEGIN
  SELECT RAISE(ABORT, 'Handoff versions are immutable');
END;
