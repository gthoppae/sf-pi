# SF Data 360 Workflows

## Explore before querying

1. Search metadata with `/connect/search/metadata/results`.
2. Fetch one entity's metadata with `/ssot/metadata` using `entityName`.
3. Run a small `/ssot/query-sql` query with `rowLimit`.
4. Use query status and rows endpoints for pagination when needed.

## Create or update a mapping

1. Get source DLO schema: `GET /ssot/data-lake-objects/{dloName}`.
2. Get target DMO schema: `GET /ssot/data-model-objects/{dmoName}`.
3. Preview or inspect examples for mapping payload shape.
4. Use `dry_run: true` for the create/update call.
5. Create or update mapping only after field API names are verified.

## Create a calculated insight

1. Discover referenced DMO/CI fields.
2. Draft SQL with fully qualified field names.
3. Validate with `POST /ssot/calculated-insights/actions/validate`.
4. Create or update the CI.
5. Run or enable only after validation succeeds.
6. Check run/status before using the CI in segments.

## Create a data stream

1. List connectors and connector metadata.
2. List or test the connection.
3. Inspect target DMO and mapping requirements.
4. Prefer connector-specific create shapes when available.
5. Dry-run the create request.
6. Trigger ingestion only after create succeeds and dependencies are verified.

## Work with semantic data models

1. Create or locate the semantic model shell.
2. Add data objects.
3. List dimensions/measurements to get semantic field names.
4. Add relationships using semantic field names, not raw DMO field names.
5. Add calculated dimensions/measures and metrics.
6. Validate the model before semantic queries.

## Recovery loop

When a REST call fails:

1. Read the error body carefully.
2. Re-read the relevant reference/example file.
3. Fetch current resource state with a GET call.
4. Retry with the smallest corrected payload.
5. If the response is too large, request fewer rows or use pagination.
