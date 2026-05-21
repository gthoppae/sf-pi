---
layout: home
title: SF Pi documentation
hero:
  name: SF Pi
  text: Salesforce-focused extensions for pi
  tagline: Safer Salesforce development, richer agent tooling, and discoverable runtime surfaces inside the pi coding agent.
  actions:
    - theme: brand
      text: Install SF Pi
      link: /install
    - theme: alt
      text: Quickstart
      link: /quickstart
    - theme: alt
      text: View on GitHub
      link: https://github.com/salesforce/sf-pi
features:
  - title: Agent-ready Salesforce tools
    details: Agent Script, Data 360, Salesforce Browser, and Slack tools are exposed as typed pi runtime surfaces.
  - title: Safety first
    details: Salesforce-aware guardrails, generated docs, and public-safe checks keep day-to-day work reviewable.
  - title: Built from the repo
    details: Documentation, extension metadata, generated inventories, and source live together in one GitHub repository.
---

# SF Pi documentation

SF Pi is a bundle of opinionated Salesforce extensions for the
[pi coding agent](https://pi.dev). It helps developers and agents work with
Salesforce projects through slash commands, LLM tools, status surfaces,
provider wiring, skills, and safety guidance.

> **TL;DR** — install pi, run `pi install git:github.com/salesforce/sf-pi`,
> restart pi or run `/reload`, then open `/sf-pi` to inspect the bundled
> extensions.

## Where to start

- **[Install](./install.md)** — Node.js, pi, sf-pi, fonts, and recommended extensions.
- **[Quickstart](./quickstart.md)** — first commands to verify the package is alive.
- **[Bundled Extensions](./extensions.md)** — what ships in the package and which surfaces each extension exposes.
- **[Command Reference](./commands.md)** — every slash command generated from extension manifests.
- **[Privacy & telemetry](./privacy.md)** — what sf-pi does and does not collect.
- **[Troubleshooting](./troubleshooting.md)** — common install, runtime, and extension issues.

## What SF Pi does

- **Agent Script lifecycle** — compile, inspect, mutate, preview, evaluate, publish, and activate `.agent` files.
- **Data 360 workflows** — discover Data Cloud/Data 360 capabilities, call REST endpoints safely, inspect metadata, and run readiness probes.
- **Salesforce Browser automation** — open Salesforce orgs, inspect Lightning/Setup UI, interact with refs, wait for Lightning state, and capture browser evidence.
- **Slack research** — search, summarize, resolve Slack entities, read files/canvases, and send only with explicit human confirmation.
- **Guardrails and operator guidance** — enforce file safety, production-aware confirmations, and Salesforce API selection rules.
- **Developer UI** — status bars, welcome splash, skills HUD, LSP diagnostics, data explorer, and a central extension manager.

## Runtime surfaces

| Surface            | Use it for                                                                       | Start here                                  |
| ------------------ | -------------------------------------------------------------------------------- | ------------------------------------------- |
| **Slash commands** | Human-facing controls and panels in pi                                           | [`/sf-pi`](./commands.md#manager)           |
| **LLM tools**      | Agent-callable Salesforce, Data 360, Agent Script, browser, and Slack operations | [Bundled Extensions](./extensions.md)       |
| **Provider**       | Salesforce LLM Gateway model routing when configured                             | [`/sf-llm-gateway`](./commands.md#provider) |
| **Status/UI**      | Welcome, status bars, skills HUD, LSP activity, and data exploration             | [Bundled Extensions](./extensions.md#ui)    |
| **Safety hooks**   | File, shell, org, and production-aware guardrails                                | [`SF Guardrail`](./extensions.md#safety)    |

## Get help

- File issues: [github.com/salesforce/sf-pi/issues](https://github.com/salesforce/sf-pi/issues)
- Source: [github.com/salesforce/sf-pi](https://github.com/salesforce/sf-pi)
- Contributor guide: [Contributing](./contributing.md)
