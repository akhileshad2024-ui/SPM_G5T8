# Backend Operation Details

Use the [README](../../README.md) for installation, normal startup and test commands. This page contains only database, mail and specialist verification details.

## Database changes

`backend/schema_changes.sql` is the single collection of existing incremental SQL changes. It is not an empty-database bootstrap or a safe full rerun: inspect the target database first and apply only missing, applicable sections with authorised administrator approval. Core tables must already exist; the US50/US51/US45 section references `safety_reviews` as well as `users` and `events`.

The final section creates `arrangement_reassessments` and `event_preparations`, their constraints and index. It enables RLS, revokes browser Data API roles and grants the backend service role access. FastAPI still enforces session identity, roles and event ownership. SQLAlchemy `create_all` creates missing tables but does not alter existing ones or reproduce these explicit grants/RLS settings.

No SQL was executed as part of this file consolidation. It does not establish which changes have already been applied to any shared database.

For rollback of the reassessment feature, stop the new app before reverting code. Retain the additive tables and their audit data; do not drop records to clear flags. Older sections contain data updates and constraint changes and must be assessed separately before execution or reversal.

## Confirmation email and retry worker

Configure `SMTP_HOST`, `SMTP_FROM`, `SMTP_PORT` and any `SMTP_USERNAME`/`SMTP_PASSWORD` in `backend/.env`. Never commit credentials. `SMTP_SSL=true` uses implicit TLS; otherwise the worker uses STARTTLS. `SMTP_ALLOW_PLAINTEXT` is for an explicitly authorised local test receiver only.

Registration commits a recipient-scoped notice and an email outbox row with the registration. The API attempts background delivery after commit. From `backend/`, run `python -m mail_worker` for independent retries, or `python -m mail_worker --once` for one pass. Without HOST/FROM, queued messages remain pending. Failed deliveries are retried up to ten attempts. Correct the configuration before resetting exhausted attempts.

Delivery is at-least-once: a crash after SMTP acceptance but before the database commit can produce a duplicate; the Message-ID is stable. A queued message or saved `sent_at` alone does not prove actual inbox receipt. Verify receipt using an authorised test mailbox before claiming the email acceptance outcome. No external mailbox verification is claimed by this guide.

## Optional PostgreSQL locking verification

The ordinary automated suites use isolated SQLite. The real locking check requires a local disposable PostgreSQL database, not the shared Supabase database. Set `DOD_POSTGRES_TEST_URL` for that local database, then run:

```bash
python -m pytest tests/integration/test_equipment_postgres_concurrency.py -q
```

The test refuses remote hosts, creates/removes its own uniquely named schema and uses independent database sessions. It checks that two attempts for the last equipment unit produce one success, one conflict and exactly one reservation. Without the variable, it is explicitly skipped. Do not report a skipped run as verified PostgreSQL concurrency.

## Design and evidence references

- [C4 architecture](../architecture/ConnectSphere_C4_Editable.drawio)
- [Implementation decisions and test traceability](../testing/traceability.md)
- [Historical reassessment execution evidence](../testing/reassessment-tests.md)

Notion is the current DoD register. Local passes do not replace peer review, merge or merge-commit CI.
