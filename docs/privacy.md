---
title: Privacy & telemetry
description: Public summary of sf-pi telemetry behavior and aggregate metrics posture.
---

# Privacy & telemetry

SF Pi does **not** collect active runtime telemetry. It does not send prompts,
responses, tool calls, file paths, Salesforce org identifiers, Slack identifiers,
environment variables, or command usage from your machine.

## Pi runtime install telemetry

The upstream pi runtime may emit an anonymous install/update version ping after
a fresh install or changelog-detected update. SF Pi opts users out by default
when the setting is unset, while preserving any explicit user preference.

Check or change the setting from pi:

```text
/sf-pi telemetry status
/sf-pi telemetry on
/sf-pi telemetry off
```

## Aggregate project metrics

Repository automation may archive aggregate GitHub-facing project metrics such
as releases, issues, pull requests, stars, forks, and workflow status. These are
repository-level signals, not local runtime telemetry.

## Where this behavior lives

- Detailed policy: [Telemetry, Metrics, and Privacy](./telemetry.md)
- User-facing controls: [`/sf-pi`](./commands.md#manager)
- Source repository: [github.com/salesforce/sf-pi](https://github.com/salesforce/sf-pi)
