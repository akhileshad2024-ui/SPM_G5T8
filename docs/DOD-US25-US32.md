# US25–US32 — proposed Notion DoD entries

Use with `US25-US32-delivery.md` and PR #36. This is an evidence draft, not an approval and not an update to the live Notion checklist.

| DoD item | Evidence / status |
|---|---|
| Approved AC met | US25/26 notification triggers implemented and recipient-scoped API tests pass. US27 local performance passes. US29 SMTP implementation exists but real delivery evidence is pending. Final AC verification after revised browser tests is pending. |
| Peer-reviewed and merged to main | Unchecked: requires teammate review and actual merge. |
| Unit tests pass | Frontend 352 passed; independent equipment interval unit tests included in backend suite. Full backend: 1,434 passed plus 609 subtests; independent unittest discovery: 449 passed. |
| Integration tests pass (if applicable) | Equipment, notification, registration and email adapter tests passed locally. Real PostgreSQL concurrency test is opt-in and not run here. |
| CI build and tests pass on merge commit | Unchecked: requires updated PR CI, actual merge and merge-commit CI. |
| Tests linked to US / AC | Yes: test names carry US/AC identifiers; regression tests name the defect. |
| Functional TC created and required tests pass | Revised module suite: 13 passed. Final sign-off waits for the full 180-test Playwright suite and GitHub CI. |
| No workflow-blocking defects | The two reproduced review defects are fixed with regression tests. Final sign-off waits for full browser/integration checks on the revision. |
| Setup / schema / run documentation updated (if needed) | Updated delivery instructions, SMTP variables, outbox worker, performance evidence and PostgreSQL test command. |

## Per-story Pending fields

- **US25:** Updated full browser/CI results; teammate review, merge and merge-commit CI. Technician notices are now persisted, not an unimplemented US36 dependency.
- **US26:** Updated full browser/CI results; teammate review, merge and merge-commit CI. Coordinator status-change notices are now persisted. Old event-API permission bypass and empty requests have regression fixes.
- **US27:** Local benchmark max 0.0391 seconds with 1,000 reservations; target-deployment response-time evidence still required.
- **US28:** Run the real local PostgreSQL concurrency check; SQLite API tests do not demonstrate PostgreSQL row locking.
- **US29:** Configure SMTP in the authorised deployment and confirm actual mailbox receipt. Outbox / TLS / retry / duplicate prevention adapter tests pass; mocked delivery is not inbox proof.
- **US30–US32:** Updated full browser/CI results, teammate review, merge and merge-commit CI.

## Scrum entry (this work only)

Completed: merged latest main, resolved test-account conflict, fixed technician access and empty equipment requests, restored equipment quantity summary, added durable recipient-scoped notices and SMTP confirmation outbox/worker, added regression/unit/performance/concurrency-test coverage and updated run instructions.

Next: import this revision into yangbo-m5, run the full Playwright suite, push to update PR #36, configure/verify SMTP and execute the PostgreSQL check, then request teammate review.

Blockers: this agent environment does not provide a real email provider or PostgreSQL service. Formal peer approval and merge-commit CI remain team actions.

## PR #36 idle-session CI regression

The c09c64d functional CI run reported 178 passed, one skipped and TC-009 failed:
the login page appeared before server logout completed. Background notification
polling also renewed the idle cookie every 15 seconds. GET /notifications now
validates authentication without renewing it; deliberate user actions retain the
existing sliding session behavior. Idle logout waits for cookie removal before
navigation, and the tracker triggers logout only once while it is pending.

Regression evidence: TC-009 and TC-010 pass locally with a deliberately delayed
logout response; all 352 frontend unit tests and TypeScript checking pass. The
backend regression verifies polling sends no Set-Cookie and cannot extend token
expiry; the related backend login/notification suite passes all 136 tests. The updated full GitHub workflow must still pass after this revision is
pushed; these local results do not mark the merge-commit CI item complete.
