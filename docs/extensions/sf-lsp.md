---
title: "SF LSP"
description: "Surface advisory diagnostics for Apex, LWC, and Agent Script files as you edit in pi."
---

# SF LSP

<p class="sfpi-page-lead">Surface advisory diagnostics for Apex, LWC, and Agent Script files as you edit in pi.</p>

<div class="sfpi-action-card"><span>Best for</span><strong>Code diagnostics</strong><p>Surface advisory diagnostics for Apex, LWC, and Agent Script files as you edit in pi.</p></div>

## Why you'll use it

<div class="sfpi-benefit-grid">
<div class="sfpi-benefit-card">Get quick feedback after file writes and edits.</div>
<div class="sfpi-benefit-card">See LSP health without leaving pi.</div>
<div class="sfpi-benefit-card">Keep diagnostics advisory so they help without blocking every workflow.</div>
</div>

## Try it first

Open LSP status

```text
/sf-lsp
```

You can also manage this extension from the SF Pi home base:

```text
/sf-pi status sf-lsp
/sf-pi enable sf-lsp
/sf-pi disable sf-lsp
```

## Common use cases

- Check Apex, LWC, or Agent Script diagnostics after editing.
- Run a doctor command when language tooling is not responding.
- Track LSP activity in status surfaces.

## What you get

- Advisory diagnostics on write/edit.
- Language-server discovery for supported Salesforce file types.
- A status panel for health and activity.

## Safety notes

- Never overrides the built-in write/edit tools (pi cross-extension conflict guard).
- Defers .agent file diagnostics to sf-agentscript when that extension is loaded.

## Exact reference

<details>
<summary>Show commands, tools, providers, and hooks</summary>

- **Extension id:** `sf-lsp`
- **Category:** Assistive
- **Maturity:** stable
- **Default state:** on
- **Commands:** `/sf-lsp`
- **LLM tools:** _none_
- **Providers:** _none_
- **Events/hooks:** `session_start`, `session_shutdown`, `tool_result`

</details>

## For contributors

- [Full extension README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-lsp/README.md)
- [Source folder](https://github.com/salesforce/sf-pi/tree/main/extensions/sf-lsp)

## Troubleshooting

See the [Troubleshooting section in the full README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-lsp/README.md#troubleshooting) for extension-specific recovery steps.
