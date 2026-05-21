---
title: "SF Feedback"
description: "Report SF Pi issues with useful, sanitized diagnostics instead of starting from a blank bug report."
---

# SF Feedback

<p class="sfpi-page-lead">Report SF Pi issues with useful, sanitized diagnostics instead of starting from a blank bug report.</p>

<div class="sfpi-action-card"><span>Best for</span><strong>GitHub issue feedback</strong><p>Report SF Pi issues with useful, sanitized diagnostics instead of starting from a blank bug report.</p></div>

## Why you'll use it

<div class="sfpi-benefit-grid">
<div class="sfpi-benefit-card">Collects helpful context without exposing private data by default.</div>
<div class="sfpi-benefit-card">Keeps users in control before anything is submitted.</div>
<div class="sfpi-benefit-card">Makes bug reports easier for maintainers to act on.</div>
</div>

## Try it first

Open feedback flow

```text
/sf-feedback
```

You can also manage this extension from the SF Pi home base:

```text
/sf-pi status sf-feedback
/sf-pi enable sf-feedback
/sf-pi disable sf-feedback
```

## Common use cases

- File a bug with environment and extension status context.
- Draft a feature request from inside pi.
- Share reproducible information while keeping sensitive details out.

## What you get

- Guided feedback flow.
- Public-safe diagnostic collection.
- Optional GitHub issue creation when configured.

## Safety notes

- Never submits a GitHub issue without user confirmation.
- Diagnostics are sanitized before preview or submission.
- Headless mode emits a draft and fallback URL only.

## Exact reference

<details>
<summary>Show commands, tools, providers, and hooks</summary>

- **Extension id:** `sf-feedback`
- **Category:** Assistive
- **Maturity:** stable
- **Default state:** on
- **Commands:** `/sf-feedback`
- **LLM tools:** _none_
- **Providers:** _none_
- **Events/hooks:** _none_

</details>

## For contributors

- [Full extension README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-feedback/README.md)
- [Source folder](https://github.com/salesforce/sf-pi/tree/main/extensions/sf-feedback)

## Troubleshooting

See the [Troubleshooting section in the full README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-feedback/README.md#troubleshooting) for extension-specific recovery steps.
