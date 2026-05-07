---
name: sf-data360
description: Data Cloud/Data 360 REST API workflows using d360_api or sf api request rest. Use for Data 360 metadata discovery, SQL queries, DMO/DLO schemas, mappings, data streams, calculated insights, segments, activations, semantic data models, search indexes, retrievers, and DataKit operations.
---

# SF Data 360

Use this skill when working with Salesforce Data Cloud / Data 360 REST APIs.

## Execution preference

1. Use `d360_probe` first when Data Cloud/Data 360 readiness is uncertain.
2. Prefer the native `d360_api` tool when available.
3. If `d360_api` is unavailable, use `sf api request rest` directly.
4. Always use the active org API version from the Salesforce environment.
5. Always name the target org explicitly for mutating calls.

## Default workflow

1. Probe readiness before assuming Data Cloud is on or off.
2. Discover metadata before querying or mutating.
3. Read examples before complex create/update calls.
4. Use `dry_run: true` before create, update, run, publish, deploy, undeploy, or delete.
5. Keep result sets small with limits, row limits, and pagination.
6. Prefer validation, preview, and test endpoints before saving configuration.

## References

Read these files only when needed:

- `references/quickstart.md` — common `d360_api` examples.
- `references/workflows.md` — end-to-end operation sequences.
- `references/endpoint-families.md` — endpoint families and representative paths.
- `references/examples.md` — public-safe payload examples.
- `references/data-shapes.md` — request-body shapes distilled from public examples and DTOs.
- `references/query-patterns.md` — Data Cloud SQL, CI SQL, and semantic query guidance.
- `references/safety.md` — mutating-operation safety policy.
- `references/readiness.md` — how to interpret Data 360 readiness probes.
- `references/troubleshooting.md` — common failures and recovery steps.

## Rules of thumb

- Prefer metadata search over broad metadata listing.
- Prefer Data 360 query SQL endpoints over legacy query endpoints for new work.
- Read `references/query-patterns.md` before inventing Data Cloud SQL, calculated insight SQL, or semantic queries.
- For mappings, inspect both source DLO and target DMO fields first.
- For calculated insights, validate before create/update and check status before using in segments.
- For data streams, inspect connector metadata and test connections first.
- For semantic models, create the model shell first, then add data objects, relationships, calculations, and metrics.
- Read `references/data-shapes.md` before complex create/update calls.
- Confirm destructive operations even in sandboxes unless the user explicitly asked for them.
