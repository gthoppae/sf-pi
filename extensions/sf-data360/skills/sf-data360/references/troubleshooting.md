# SF Data 360 Troubleshooting

## `sf` authentication failed

Run:

```bash
sf org login web --set-default --alias my-sandbox
```

Then retry the `d360_api` call or pass `target_org` explicitly.

## Endpoint returned too much data

Use filters, `limit`, `rowLimit`, `offset`, or endpoint-specific pagination.
`d360_api` truncates oversized output and saves the full response to a temp file.

## Metadata request is too broad

Prefer metadata search first:

```json
{
  "method": "POST",
  "path": "/connect/search/metadata/results",
  "body": { "query": "the entity you need", "pagination": { "limit": 10 } }
}
```

Then fetch one entity with `/ssot/metadata` and an `entityName` query parameter.

## Create/update failed with schema errors

1. Fetch the current resource state with a `GET` call.
2. Re-read `examples.md` for a similar payload shape.
3. Remove read-only fields copied from a GET response.
4. Retry with the smallest possible body.

## Mutating call was blocked

Re-run with `dry_run: true` and inspect the safety decision. If the operation is
intended, run interactively so the confirmation dialog can appear.
