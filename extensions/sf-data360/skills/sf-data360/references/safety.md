# SF Data 360 Safety

`d360_api` classifies calls by method and path before executing.

## Always safe by default

- `GET` requests.
- `POST /connect/search/metadata/results`.
- `POST /ssot/query-sql` and legacy query endpoints.
- Validation endpoints such as `/actions/validate`.
- Connection test endpoints.

## Requires confirmation

- `DELETE` requests always.
- `PATCH` and `PUT` when the target org is production or unresolved.
- `POST` action paths that run, publish, deploy, or undeploy.
- Unclassified `POST` requests when the target org is production or unresolved.

## Headless mode

If a call requires confirmation and no UI is available, `d360_api` fails closed.
Set `SF_D360_ALLOW_HEADLESS_WRITE=1` only for automation contexts where the
workflow has already been reviewed.

## Dry-run first

Use `dry_run: true` before mutating requests. The dry run returns:

- resolved method
- normalized `/services/data/vXX.X/...` path
- target org
- org type
- safety level
- whether confirmation would be required
- request body

## Production and unknown orgs

Unknown target orgs are treated conservatively. If the tool cannot prove an org
is a sandbox/scratch/developer/trial org, mutating calls may require
confirmation.
