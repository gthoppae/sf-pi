# SF Data 360 Data Shapes

These notes condense public Data 360 API examples and request DTO shapes into
API-first guidance for `d360_api`. Treat them as starting points; verify against
live org metadata before mutating.

## DMO create shape

Endpoint: `POST /ssot/data-model-objects`

Important fields:

- `name` — custom DMO API name root. For create calls, do not include `__dlm`; the API can append the suffix. Do not start custom names with `ssot`.
- `label` — display label.
- `category` — usually `Profile`, `Engagement`, or `Other`.
- `fields[]` — each field should include `name`, `label`, `dataType`, and `isPrimaryKey`.
- `eventDateTimeFieldName` — required for Engagement-style objects.
- `dataSpaceName` — optional, but include it when working outside the default data space.

Example skeleton:

```json
{
  "name": "ProductReview",
  "label": "Product Review",
  "category": "Other",
  "fields": [
    { "name": "ReviewId", "label": "Review ID", "dataType": "Text", "isPrimaryKey": true },
    { "name": "Rating", "label": "Rating", "dataType": "Number", "isPrimaryKey": false }
  ]
}
```

## Data stream create shape

Endpoint: `POST /ssot/data-streams`

Common fields:

- `name`, `label`
- `connectorInfo.connectorType`
- `connectorInfo.connectorDetails` for connector-specific values such as source object or connection name.
- `dataLakeObjectInfo` for DLO label/name/category/dataspace/fields.
- `sourceFields[]` for source-side field names/types.
- `mappings[]` for source-to-DLO mappings when required.
- `refreshConfig` for refresh behavior.
- `dataAccessMode`, often an ingest/direct-access value depending on connector.
- `advancedAttributes` for connector-specific values such as file/parser/directory settings.

Guidance:

1. Inspect connector metadata first.
2. Inspect or test the connection before stream creation.
3. For Engagement streams, choose an immutable event time field.
4. Do not assume every connector supports full stream creation through the API.

## DMO mapping shape

Endpoint: `POST /ssot/data-model-object-mappings`

Common API shape:

```json
{
  "sourceEntityDeveloperName": "SourceObject__dll",
  "targetEntityDeveloperName": "TargetObject__dlm",
  "fieldMapping": [{ "sourceFieldName": "source_id__c", "targetFieldName": "TargetId__c" }]
}
```

Live-listing note: mapping list usually needs a filter such as `dmoDeveloperName`
or `sourceObjectName`. Do not use an unfiltered list as a readiness probe.

## Calculated insight create shape

Endpoint: `POST /ssot/calculated-insights`

Common fields:

- `apiName` — must end with `__cio`.
- `displayName`
- `definitionType` — usually `CALCULATED_METRIC` for calculated metrics.
- `publishScheduleInterval`
- `expression` — CI SQL.
- optional `dataSpaceName`, `description`, schedule start/end, draft flags.

Do not include explicit dimensions/measures arrays unless the current API
documentation requires them; the platform can derive them from the expression.

## Segment create shape

Endpoint: `POST /ssot/segments`

Common fields:

- `displayName`
- `segmentOnApiName` — entity being segmented, often a unified DMO.
- `segmentType`
- `segmentCreationFlow`
- `publishSchedule*` fields when scheduled publishing is needed.
- `includeDbt.models.models[].sql` for SQL/dbt-style segment definitions.

Segment SQL is Data Cloud SQL, not CRM SOQL. Verify referenced calculated
insights are active before segment creation.

## Identity resolution shape

Endpoint: `POST /ssot/identity-resolutions`

Common fields:

- `label`, `description`
- `configurationType` — for example individual/account style configurations.
- `rulesetId`
- `doesRunAutomatically`
- `matchRules[].criteria[]` with `entityName`, `fieldName`, `matchMethodType`, and blank/case behavior.
- `reconciliationRules[]` with `entityName`, `ruleType`, source precedence, and optional field-level rules.

Rule of thumb: include an explicit `ruleType` for each reconciliation rule and
choose a rule compatible with fields that are actually mapped.

## Semantic model shape

Semantic model workflows are multi-step:

1. `POST /ssot/semantic/models` — create model shell with `apiName`, `label`, `dataspace`.
2. `POST /ssot/semantic/models/{id}/data-objects` — add DMO/DLO/CI objects. Use `dataObjectType` values like `Dmo`, `Dlo`, or `Cio`.
3. List data objects/dimensions/measurements to discover semantic field names.
4. Create relationships using semantic field API names, not raw DMO field names.
5. Add calculated dimensions/measures/metrics.
6. Validate before query.

Semantic formula syntax uses bracketed semantic references such as
`[DataObject].[Field]`.

## Search index shape

Search index creation is configuration-heavy. Before create/update:

1. Fetch search-index configuration options for the org when that surface exists.
2. Retrieve an existing index if updating.
3. Populate only values supported by the org, such as chunking strategy,
   embedding model, search type, similarity metric, transformation settings,
   and per-file or field-level settings.

Do not use search-index availability as the only Data Cloud readiness signal;
it can be absent in otherwise healthy orgs.
