---
title: "SF Skills"
description: "See and manage Salesforce skills that are active in the LLM context."
---

# SF Skills

<p class="sfpi-page-lead">See and manage Salesforce skills that are active in the LLM context.</p>

<div class="sfpi-action-card"><span>Best for</span><strong>Skill visibility and setup</strong><p>See and manage Salesforce skills that are active in the LLM context.</p></div>

## Why you'll use it

<div class="sfpi-benefit-grid">
<div class="sfpi-benefit-card">Shows which Salesforce skills are active right now.</div>
<div class="sfpi-benefit-card">Helps install and manage curated Salesforce skill libraries.</div>
<div class="sfpi-benefit-card">Uses native pi settings instead of shadow state.</div>
</div>

## Try it first

Open skills manager

```text
/sf-skills
```

You can also manage this extension from the SF Pi home base:

```text
/sf-pi status sf-skills
/sf-pi enable sf-skills
/sf-pi disable sf-skills
```

## Common use cases

- Check what Salesforce guidance the agent can currently see.
- Install or prune managed Salesforce skills.
- Inspect skill usage and source scope.

## What you get

- A skills manager panel.
- Passive live-context HUD.
- Global/project skill source detection.

## Exact reference

<details>
<summary>Show commands, tools, providers, and hooks</summary>

- **Extension id:** `sf-skills`
- **Category:** UI
- **Maturity:** stable
- **Default state:** on
- **Commands:** `/sf-skills`
- **LLM tools:** _none_
- **Providers:** _none_
- **Events/hooks:** `session_start`, `message_end`, `session_tree`, `session_compact`, `before_agent_start`, `session_shutdown`

</details>

## For contributors

- [Full extension README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-skills/README.md)
- [Source folder](https://github.com/salesforce/sf-pi/tree/main/extensions/sf-skills)

## Troubleshooting

See the [Troubleshooting section in the full README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-skills/README.md#troubleshooting) for extension-specific recovery steps.
