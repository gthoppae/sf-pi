---
title: "SF Welcome"
description: "Start each pi session with a friendly SF Pi status summary and useful next steps."
---

# SF Welcome

<p class="sfpi-page-lead">Start each pi session with a friendly SF Pi status summary and useful next steps.</p>

<div class="sfpi-action-card"><span>Best for</span><strong>First-run and session overview</strong><p>Start each pi session with a friendly SF Pi status summary and useful next steps.</p></div>

## Why you'll use it

<div class="sfpi-benefit-grid">
<div class="sfpi-benefit-card">Shows environment and privacy posture at launch.</div>
<div class="sfpi-benefit-card">Surfaces recommendations and announcements without forcing a command.</div>
<div class="sfpi-benefit-card">Makes new SF Pi sessions feel intentional and discoverable.</div>
</div>

## Try it first

Open welcome surface

```text
/sf-welcome
```

You can also manage this extension from the SF Pi home base:

```text
/sf-pi status sf-welcome
/sf-pi enable sf-welcome
/sf-pi disable sf-welcome
```

## Common use cases

- Review setup status at the start of a session.
- Install fonts when glyphs do not render correctly.
- See recommended next steps after installing SF Pi.

## What you get

- Startup splash or quiet header behavior.
- Release freshness, environment, privacy, and recommendation rows.
- Font setup helper.

## Exact reference

<details>
<summary>Show commands, tools, providers, and hooks</summary>

- **Extension id:** `sf-welcome`
- **Category:** UI
- **Maturity:** stable
- **Default state:** on
- **Commands:** `/sf-welcome`, `/sf-setup-fonts`
- **LLM tools:** _none_
- **Providers:** _none_
- **Events/hooks:** `session_start`, `agent_start`, `tool_call`, `session_shutdown`

</details>

## For contributors

- [Full extension README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-welcome/README.md)
- [Source folder](https://github.com/salesforce/sf-pi/tree/main/extensions/sf-welcome)

## Troubleshooting

See the [Troubleshooting section in the full README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-welcome/README.md#troubleshooting) for extension-specific recovery steps.
