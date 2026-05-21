---
title: Troubleshooting
description: Common SF Pi install, runtime, Salesforce, and extension recovery paths.
---

# Troubleshooting

Start with the symptom closest to what you see. For extension-specific fixes,
use the generated troubleshooting index in the root README or the linked
extension README files.

## SF Pi does not load

1. Restart pi or run `/reload`.
2. Confirm the package is installed in the expected scope:

   ```text
   /sf-pi status
   ```

3. Verify Node.js is at least `22.19`:

   ```bash
   node --version
   ```

4. Reinstall the package if pi cannot find it:

   ```bash
   pi install git:github.com/salesforce/sf-pi
   ```

## Salesforce commands cannot find an org

SF Pi uses Salesforce CLI authentication. Check the CLI directly:

```bash
sf org list --all
sf config get target-org
```

Authenticate or set the target org with the Salesforce CLI, then reload pi.

## Glyphs render as question marks

Run the font helper and switch your terminal to the installed Nerd Font:

```text
/sf-setup-fonts
```

## A bundled extension is noisy or not needed

Use the manager to disable optional extensions globally or for the current
project:

```text
/sf-pi
/sf-pi disable <extension-id>
/sf-pi enable <extension-id>
```

Always-on manager behavior is mediated by SF Pi Manager and cannot be disabled
from inside the package.

## Slack tools are unavailable

Slack tools register only after an auth token is available. Run:

```text
/sf-slack
```

Then follow the setup panel. If auth is missing, use `/login sf-slack` or your
approved automation token path.

## Data 360 or Agent Script calls fail

Confirm that the target Salesforce org is connected and has the required
features enabled. Start with the extension panels:

```text
/sf-data360
/sf-agentscript
```

For Data 360 readiness, use the read-only probe surface from `/sf-data360`.

## More troubleshooting links

- Root README troubleshooting index: [README.md](https://github.com/salesforce/sf-pi#troubleshooting)
- Command reference: [Commands](./commands.md)
- Extension inventory: [Bundled Extensions](./extensions.md)
- File an issue: [github.com/salesforce/sf-pi/issues](https://github.com/salesforce/sf-pi/issues)
