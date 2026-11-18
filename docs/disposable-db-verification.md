# Disposable Database Verification — Review Idempotency (Migrations 11 → 12)

Status: **prepared procedure, NOT executed**. At preparation time
(2026-11-18) the Docker daemon was not running on this machine (colima VM
down), so per the safety boundary no database execution was attempted and no
verification result is claimed. A later preflight on the same day found the
machine has 8 GB RAM with only ~2–3 GB reclaimable — insufficient for the
full local stack (estimated 4–6 GB); local execution is BLOCKED until RAM is
freed or a reduced postgres-only stack is approved. The CI path below is the
prepared alternative and is itself NOT VERIFIED until a run completes.

## Safety boundary

- Use ONLY the local disposable stack started by `supabase start`.
- This repo is linked to a hosted project (`supabase/.temp/project-ref`
  exists). **Never** run `supabase db push`, `supabase migration up`,
  `supabase link`, or anything with `--linked` as part of verification.
  Never use `.temp/project-ref` as a test target.
- `supabase db reset` and `supabase test db` act on the LOCAL database only.
- No production credentials are needed: fixtures create their own
  `auth.users`/profiles and set JWT claims via `set_config`.

## Environment facts (verified locally)

| Item | State |
| --- | --- |
| Docker CLI | present (`/usr/local/bin/docker`), daemon via colima **not running** |
| Supabase CLI | 3.1.0 (`supabase --version`) |
| `supabase/config.toml` | `[db] major_version = 17`, port 54322, seed disabled |
| Extensions | `pgcrypto` preinstalled in `extensions` schema by the Supabase PG image; migration `20261102000015` also declares it |
| Migration chain | all 54 files in `supabase/migrations/` apply in filename order; 11 (`20261117000001`) precedes 12 (`20261118000001`); 12 drops the 3-param RPCs and requires the 5-param signature |
| pgTAP fixtures | `supabase/tests/report_review_idempotency.sql` (transaction rollback, idempotent retry, atomic audit/push, grants), `rls_matrix.sql`, `account_approval.sql` |
| Concurrency drill | `scripts/drill/review-concurrency.sh` (wired into CI `database-integration`; also runnable locally against a running local DB) |

## Exact procedure

```bash
# 0. Start the Docker daemon (colima). Review resources before starting.
colima start --cpu 4 --memory 6

# 1. Start the disposable local stack (first run pulls PG 17 images).
supabase start

# 2. Apply ALL migrations from scratch to the local database.
#    Fails loudly if any migration (incl. 11's duplicate-reference preflight)
#    cannot apply. This is local-only; it never touches the linked project.
supabase db reset

# 3. Run the pgTAP fixtures (each wraps itself in BEGIN ... ROLLBACK).
supabase test db

# 4. Concurrency drill (two parallel psql sessions, same actor/key).
DB_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
  bash scripts/drill/review-concurrency.sh

# 5. Optional: operator inventory/backfill DRY-RUN against the disposable DB
#    (never against hosted data without separate approval).
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
  -f supabase/operator/report_review_email_inventory.sql
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
  -f supabase/operator/report_review_email_backfill.sql   # dry-run by default

# 6. Cleanup — destroy the disposable stack and all local data.
supabase stop --no-backup
colima stop   # optional, frees the VM
```

## What each layer proves

- `supabase db reset`: migration order, preflight guards, schema validity.
- `supabase test db` (SQL fixtures, single session): atomic commit of
  decision + status + idempotency + email outbox + push event + audit;
  rollback on recipient/audit failure; idempotent retry semantics; grants.
- `review-concurrency.sh` (two sessions): row-lock serialization — same
  actor/key in parallel yields exactly one decision and one audit/outbox/
  notification event; distinct keys yield independent decisions.
- Mocked Vitest suites prove app-layer wiring only. They are NOT a substitute
  for the database layers above.

## CI coverage (wired, NOT yet executed)

`.github/workflows/ci.yml` defines a `database-integration` job that starts a
disposable Supabase on the runner (`supabase start`,
`supabase db reset --local --yes`, `supabase test db --local`, CLI 2.122.0),
then runs the concurrency drill (`scripts/drill/review-concurrency.sh`,
5-minute step timeout, local `DB_URL` only), and then real-database E2E.
The extended pgTAP fixture
(`supabase/tests/report_review_idempotency.sql`, 28 assertions) runs inside
`supabase test db`. Any failing stage fails the job; `supabase stop
--no-backup` runs via `if: always()`. The job needs no repository secrets —
all credentials come from the disposable local stack.

Status: the workflow change is prepared locally but has NOT been committed,
pushed, or executed. CI coverage is NOT VERIFIED until a run completes after
push approval. Note the CLI version drift: CI pins 2.122.0 while the operator
machine has 3.1.0; `config.toml` uses only long-stable keys, but the first CI
run is the proof.

## Known gaps before this procedure can run

1. Docker daemon must be started (step 0) — intentionally not done by the
   agent under the local-only safety boundary.
2. First `supabase start` downloads images; needs network access.
3. Concurrency coverage for the audit hash-chain advisory lock under heavy
   parallel load is exercised only indirectly (every fixture insert chains);
   a dedicated stress drill is future work, not a release blocker.