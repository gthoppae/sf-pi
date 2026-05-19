# SF Data 360 Roadmap

## Current sweep coverage baseline

The facade-first `d360` capability sweep is the source of truth for live parity hardening. The current disposable mutation sweep has green coverage for:

- DMO lifecycle
- DLO lifecycle
- DLO to DMO mapping lifecycle
- Data action target and data action lifecycle
- Data transform validate/create/get/update/schedule/delete lifecycle
- Calculated insight create/get/run/delete lifecycle, with validate classified as org-gated when unavailable
- Segment create/get/delete lifecycle
- Activation target create/list/get/update lifecycle
- Activation create/get/delete lifecycle
- Semantic model shell lifecycle
- Semantic data object lifecycle
- Semantic calculated dimension and measurement lifecycles
- Semantic metric lifecycle
- Semantic relationship lifecycle
- Search index readiness
- Retriever readiness and retriever create/get/delete using an existing search index

## Pending lifecycle work

### 1. Identity Resolution readiness and lifecycle

Start with readiness, not mutation. The likely blocker is eligible mapped Profile DMOs. The sweep should first detect whether the org has identity-resolution-ready objects and classify missing prerequisites as `feature_gated` or `dependency_missing` instead of failing.

Target coverage:

1. list identity resolutions
2. inspect candidate mapped profile DMOs
3. create ruleset only when prerequisites are present
4. get/update/full-update where safe
5. publish/run only if the org state supports it
6. delete and verify cleanup

### 2. Data Stream lifecycle

Add a full lifecycle once a safe connector/source fixture is selected. Prefer a path that does not require secrets.

Target coverage:

1. list/test connection or connector metadata
2. create sweep-owned data stream
3. get/update stream
4. run only if the connector supports manual run
5. delete with `shouldDeleteDataLakeObject=true|false`
6. verify cleanup, allowing eventual consistency

Known caveat: Salesforce CRM streams can reject manual run.

### 3. Search Index create lifecycle

Readiness is green and retriever creation works against existing search indexes. Creating a sweep-owned search index still returns an opaque server error with the current payload shape.

Target coverage:

1. capture a known-good create payload from UI or official API example for this org shape
2. create sweep-owned search index
3. get/process-history
4. delete and verify cleanup
5. use the sweep-owned index in retriever lifecycle instead of an existing fixture

Current blocker: `d360_search_index_create` returns `UNKNOWN_EXCEPTION` for the attempted sweep payload.

### 4. Retriever configuration lifecycle

Retriever create/get/delete is green using an existing search index. Config create/update/delete is still pending.

Target coverage:

1. create retriever
2. create configuration
3. list/get configuration
4. update active/config fields if allowed
5. delete configuration
6. delete retriever

### 5. DataKit lifecycle

Postpone until a safe minimal DataKit fixture exists. DataKit deploy/undeploy can affect multiple components and should not be added to the destructive sweep without a fixture that is intentionally disposable.

Target coverage:

1. create or identify small test DataKit
2. deploy
3. get deployment status
4. get component status and dependencies
5. undeploy
6. verify cleanup

### 6. Optional segment publish/count/deactivate probes

The green segment lifecycle currently covers create/get/delete. Count, publish, and deactivate are state-sensitive and may reject while a new segment is `PROCESSING`.

Target coverage:

1. poll segment status
2. run count/publish/deactivate only when state permits
3. classify early-state rejections as `dependency_missing` or `state_gated`
4. keep create/get/delete as the required green path

### 7. Calculated insight run-status registry cleanup

Calculated insight create/get/run/delete is green. The current `d360_ci_run_status` operation maps to a GET on the run action path, which the live API rejects with `METHOD_NOT_ALLOWED`.

Target coverage:

1. find the correct run status endpoint, if one exists
2. update or remove/reclassify `d360_ci_run_status`
3. keep `d360_ci_run` as the required green runtime action

## Harness improvements still worth doing

- Add a `state_gated` outcome to distinguish lifecycle-state blockers from missing dependencies.
- Add artifact comparison, for example `--compare-to previous.json`.
- Add CI npm scripts for stable presets, such as `e2e:d360-sweep:stdm-safe` and `e2e:d360-sweep:stdm-mutate`.
- Add broader stale cleanup discovery with age filtering when list responses expose timestamps consistently.
