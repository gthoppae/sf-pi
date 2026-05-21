---
title: Contributing
description: Contributor and agent-facing sources of truth for changing SF Pi.
---

# Contributing

SF Pi is organized as a bundle of self-contained pi extensions. Start from the
public contributor docs, then use generated inventories to find the exact
extension or runtime surface you need.

## Start here

- [Contributing guide](https://github.com/salesforce/sf-pi/blob/main/CONTRIBUTING.md) — workflow, validation, and review expectations.
- [Architecture](https://github.com/salesforce/sf-pi/blob/main/ARCHITECTURE.md) — repo structure and source-of-truth rules.
- [Human orientation](./human-orientation.md) — practical contributor map.
- [Agent orientation](./agent-orientation.md) — generated extension and runtime-surface inventory.
- [ADRs](https://github.com/salesforce/sf-pi/tree/main/docs/adr) — accepted architecture decisions.

## Source-of-truth rules

- Extension metadata starts in `extensions/<id>/manifest.json`.
- Generated catalog files and generated docs are refreshed with `npm run generate-catalog`.
- Do not hand-edit generated files or generated marker blocks.
- Extension behavior stays co-located under `extensions/<id>/`.
- Shared helpers live under `lib/common/` only when at least two extensions need them.

## Validation

Use the CI-like path before publishing changes:

```bash
npm run validate:ci
```

Useful focused checks:

```bash
npm run generate-catalog:check
npm run docs:health:check
npm run docs:build
npm run format:check
npm run check
npm test
```

## Public-safe documentation

This repository is public-facing. Do not copy internal discussion text,
customer examples, Slack links, org URLs, workspace/user IDs, private hostnames,
or non-public implementation details into docs, comments, tests, examples, or
commit messages. Use fresh generic examples when an example is needed.
