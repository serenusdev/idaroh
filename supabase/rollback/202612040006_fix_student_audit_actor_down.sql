BEGIN;
-- The previous function definition is intentionally retained on rollback: removing it would
-- reintroduce the audit_logs.actor_name NOT NULL failure for already-installed triggers.
COMMIT;
NOTIFY pgrst, 'reload schema';
