# SF Data 360 Quickstart

Use `d360_api` with paths relative to `/services/data/vXX.X`. The tool supplies
the active API version and target org. For validation runs or any session where
the default org is not the intended Data 360 org, pass `target_org` explicitly on
every call.

## List Data Model Objects

```json
{
  "method": "GET",
  "path": "/ssot/data-model-objects",
  "query": { "category": "Profile", "limit": 20 },
  "target_org": "my-data360-sandbox"
}
```

## Get a DMO schema

```json
{
  "method": "GET",
  "path": "/ssot/data-model-objects/Individual__dlm"
}
```

## Search metadata

```json
{
  "method": "POST",
  "path": "/connect/search/metadata/results",
  "body": {
    "query": "Individual profile fields",
    "pagination": { "limit": 10 }
  }
}
```

## Run a small Data 360 SQL query

```json
{
  "method": "POST",
  "path": "/ssot/query-sql",
  "body": {
    "sql": "SELECT ssot__Id__c FROM Individual__dlm LIMIT 10",
    "rowLimit": 10
  }
}
```

## Dry-run a mutating call

```json
{
  "method": "POST",
  "path": "/ssot/data-model-objects",
  "body": {
    "name": "ProductReview",
    "label": "Product Review",
    "category": "Other",
    "fields": [
      { "name": "ReviewId", "label": "Review ID", "dataType": "Text", "isPrimaryKey": true }
    ]
  },
  "dry_run": true
}
```

If `d360_api` is unavailable, translate the call to `sf api request rest`:

```bash
sf api request rest /services/data/v66.0/ssot/data-model-objects \
  --method GET \
  --target-org my-sandbox
```
