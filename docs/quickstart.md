---
title: SF Pi Quickstart
description: First commands to verify SF Pi and discover the bundled Salesforce runtime surfaces.
---

# SF Pi Quickstart

After installing SF Pi, use these commands to confirm the package is loaded and
to discover the surfaces available in your current pi session.

## 1. Open the manager

```text
/sf-pi
```

Use the manager to list bundled extensions, enable or disable optional surfaces,
open configuration panels, inspect recommendations, and run doctor checks.

## 2. Check Salesforce context

```text
/sf-org
```

This shows the Salesforce CLI target org information that SF Pi will use for
org-aware workflows. If no org is connected, authenticate with the Salesforce
CLI outside pi, then reload the session.

## 3. Inspect the dev status surfaces

```text
/sf-devbar
/sf-lsp
```

`/sf-devbar` explains the status bar and footer state. `/sf-lsp` shows advisory
Apex, LWC, and Agent Script diagnostic status.

## 4. Try the Salesforce-aware tools

Choose the surface that matches your task:

| Task                                      | Start here          |
| ----------------------------------------- | ------------------- |
| Build or test `.agent` files              | `/sf-agentscript`   |
| Work with Data Cloud / Data 360           | `/sf-data360`       |
| Use Salesforce UI as a last-mile fallback | `/sf-browser`       |
| Search Slack from pi                      | `/sf-slack`         |
| Explore Salesforce data read-only         | `/sf-data-explorer` |
| Review safety gates                       | `/sf-guardrail`     |
| Manage Salesforce skills                  | `/sf-skills`        |

## 5. Use generated references

- [Bundled Extensions](./extensions.md) shows every extension and runtime surface.
- [Command Reference](./commands.md) lists every slash command.
- [Troubleshooting](./troubleshooting.md) points to common recovery paths.

## Recommended first session

```text
/sf-pi status
/sf-org
/sf-devbar
/sf-guardrail
/sf-pi recommended
```

Then pick the extension that matches the work in front of you.
