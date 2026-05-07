# SF Data 360 Payload Examples

These examples are generic and public-safe. Verify required fields against the
current org metadata before executing.

## Metadata search

```json
{
  "method": "POST",
  "path": "/connect/search/metadata/results",
  "body": {
    "query": "customer profile fields",
    "pagination": { "limit": 10 },
    "filters": [{ "field": "metadataType", "values": ["DataModelObject"] }]
  }
}
```

## Calculated insight validation

```json
{
  "method": "POST",
  "path": "/ssot/calculated-insights/actions/validate",
  "body": {
    "apiName": "Customer_Order_Summary__cio",
    "displayName": "Customer Order Summary",
    "definitionType": "CALCULATED_METRIC",
    "publishScheduleInterval": "SYSTEM_MANAGED",
    "expression": "SELECT Customer__dlm.ssot__Id__c customer_id, SUM(Order__dlm.TotalAmount__c) total_amount FROM Order__dlm GROUP BY Customer__dlm.ssot__Id__c"
  }
}
```

## DMO create dry run

```json
{
  "method": "POST",
  "path": "/ssot/data-model-objects",
  "dry_run": true,
  "body": {
    "name": "ProductReview",
    "label": "Product Review",
    "category": "Other",
    "fields": [
      {
        "name": "ReviewId",
        "label": "Review ID",
        "dataType": "Text",
        "isPrimaryKey": true
      },
      {
        "name": "Rating",
        "label": "Rating",
        "dataType": "Number"
      }
    ]
  }
}
```

## Mapping create dry run

Before using this pattern, fetch both the DLO and DMO schemas and verify exact
field API names.

```json
{
  "method": "POST",
  "path": "/ssot/data-model-object-mappings",
  "dry_run": true,
  "body": {
    "name": "ProductReviewToDmo",
    "sourceObjectName": "ProductReview__dll",
    "targetObjectName": "ProductReview__dlm",
    "fieldMappings": [
      {
        "sourceFieldName": "review_id__c",
        "targetFieldName": "ReviewId__c"
      },
      {
        "sourceFieldName": "rating__c",
        "targetFieldName": "Rating__c"
      }
    ]
  }
}
```

## Segment publish dry run

```json
{
  "method": "POST",
  "path": "/ssot/segments/SEGMENT_ID/actions/publish",
  "dry_run": true
}
```

## Semantic model query

```json
{
  "method": "POST",
  "path": "/semantic-engine/gateway",
  "body": {
    "semanticModelId": "SEMANTIC_MODEL_ID",
    "structuredSemanticQuery": {
      "fields": [
        { "expression": { "semanticField": { "name": "CustomerCount" } }, "alias": "customers" }
      ],
      "options": { "limitOptions": { "limit": 10 } }
    }
  }
}
```
