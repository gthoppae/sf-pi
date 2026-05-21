---
title: Install SF Pi
description: Install pi, add sf-pi from GitHub, and verify the bundled extensions.
---

# Install SF Pi

SF Pi runs inside the [pi coding agent](https://pi.dev). Install the runtime
first, then add this repository as a pi package.

## Requirements

- Node.js `>=22.19`
- pi coding agent `>=0.75.4`
- macOS, Linux, or WSL for the best-supported shell experience
- Salesforce CLI if you plan to use Salesforce org-aware workflows

## 1. Install Node.js

```bash
node --version
npm --version
```

If Node.js is missing or too old, install a current Node 22 release. With
`nvm`:

```bash
nvm install 22
nvm use 22
nvm alias default 22
```

## 2. Install pi

```bash
npm install -g --ignore-scripts @earendil-works/pi-coding-agent
```

Run `pi` in a project folder to launch the terminal UI.

## 3. Install SF Pi

Install globally so the extensions are available in every pi session:

```bash
pi install git:github.com/salesforce/sf-pi
```

Or install only for the current project:

```bash
pi install -l git:github.com/salesforce/sf-pi
```

Restart pi or run:

```text
/reload
```

## 4. Verify the package

Open the manager panel:

```text
/sf-pi
```

Useful follow-up checks:

```text
/sf-pi status
/sf-org
/sf-devbar
/sf-guardrail
```

## 5. Set up the terminal font

Some SF Pi surfaces use Nerd Font glyphs. If symbols render as `?` or blank
boxes, run:

```text
/sf-setup-fonts
```

Then set your terminal font to **MesloLGM Nerd Font Mono** and reopen the
terminal.

## 6. Install recommended community extensions

SF Pi works on its own, but the recommended pi extension bundle improves web
search, tool display, and day-to-day agent ergonomics:

```text
/sf-pi recommended install bundle:default
```

You can inspect or remove recommendations from the same manager surface:

```text
/sf-pi recommended
```

## Updating

Use pi's package update flow for installed Git packages. After updating,
restart pi or run `/reload`, then check `/sf-pi status`.

## Next step

Continue with the [Quickstart](./quickstart.md).
