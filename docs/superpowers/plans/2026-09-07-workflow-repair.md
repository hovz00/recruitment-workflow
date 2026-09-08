# Recruitment Workflow reliability implementation plan

> Execute continuously using superpowers:subagent-driven-development and test-driven-development. The user authorized repairing the reviewed issues and publishing the result to the new recruitment-workflow repository.

**Goal:** Make the existing repository reliable for confirmed recruitment operations and compatible preview/manual review imports.

**Architecture:** Excel remains the flow fact source, Markdown stores evidence, confirmed proposals write transactionally. One canonical review-data adapter feeds XLSX/CSV export and the current review HTML. Default exports redact direct identity and free text; explicit internal exports may retain them.

**Stack:** Node.js, ExcelJS, vanilla HTML/JS, Node tests and Playwright browser verification.

## Tasks

- [x] Confirmed operations: first add regressions for identifier traversal, stale-role proposals, partial rows, missing intake data, stale before values and rollback. Restrict IDs and resolved paths, require selected role, never reuse populated rows, validate proposed values and preserve recoverability. Scope: apply-confirmed-action, agent-state and dedicated tests.
- [x] Role lifecycle: regress passed-but-pending follow-ups, completed onboarding exclusion, current-round feedback and initial confirmed documents. Persist supplied confirmed Markdown documents; mark blank-template initialization as draft. Add idempotent migration of legacy roles without replacing existing documents or ledger data. Scope: initialize-role-workspace, get-role-snapshot, migration script and tests.
- [x] Review data: regress contextual metadata truncation, dropped dates, upload controls and identity leakage. Add canonical adapter/exporter preserving explicit dynamic stage entry/pass dates plus Offer dates. Retain fixed interview scheduling dates as operational fields without guessing historical entry dates. Export first-row headers, only recruitment rows, consistent stage configuration; protect XLSX/CSV content from formula injection. Scope: review-data/export scripts, ledger builder, pipeline config, sync and tests.
- [x] Dashboard: incorporate reviewed recruitment-review commit cf9709fcdebc8cbaa530c940cb91675ea9e4f1a7 as vendored template with provenance. Bootstrap through applyStageConfiguration and commitImportedRows, preserve manual upload and configure empty role dashboards. Test preview and reupload with same fictional records, stage counts, dates and Offer/onboard results. Preserve compatibility helpers only where useful.
- [x] Workflow guidance: unify Recruitment Workflow naming; keep existing protocol/state file paths for compatibility. Document confirmed documents, migration, exports/privacy, stage date semantics and manual import steps. Archive outdated design documents explicitly rather than treating them as current instructions. Include safe synthetic example invocation.
- [x] Local validation and independent review completed. Publishing checklist: run full Node suite, browser import/preview tests and independent spec then code review. Commit only source/tests/docs; recheck remote main before fast-forward publishing, preserving intervening changes. Verify the published main and CI; no force push.

## Acceptance checks

Run `node --test workflow/tests/*.test.mjs` from repository root. New regressions must fail before fixes. Use real Excel workbooks for proposal/update/migration round trips. Browser-check generated HTML plus exported CSV/XLSX against the vendored dashboard; ensure no dictionary records, identical counts, no direct identifiers in default outputs, and working manual upload. Verify git diff for accidental recruiting materials before commit.

## Verification record

2026-09-08: 82 Node tests passed; real-browser preview, XLSX and CSV import passed against both the vendored template and the referenced review checkout. Independent review findings (initialization race, empty-role configuration, derived paths, case-insensitive archive collisions) were fixed and checked. Remote main was re-fetched before publishing; see GitHub Actions for the published commit status.
