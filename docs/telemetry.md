# Telemetry, Metrics, and Privacy

sf-pi does **not** collect active runtime telemetry.

No bundled sf-pi extension sends usage events from a user's machine, and sf-pi
has no telemetry endpoint. The project only uses aggregate metrics that GitHub
provides to repository maintainers.

## What sf-pi does not collect

sf-pi does not collect or transmit:

- prompts, assistant responses, tool calls, or tool results
- file contents, filenames, local paths, git remotes, or branch names
- Salesforce org aliases, org IDs, instance URLs, usernames, or emails
- Slack workspace/channel/user information
- model/provider API keys, Salesforce auth tokens, or environment variables
- command-level runtime usage from installed copies of sf-pi
- persistent user, device, or install identifiers

## Aggregate metrics we archive

The repository includes a scheduled GitHub Actions workflow,
[`.github/workflows/metrics-archive.yml`](../.github/workflows/metrics-archive.yml),
that archives aggregate maintainer metrics to a separate `metrics` branch.

The workflow runs on GitHub-hosted infrastructure, not on user machines. It
collects only aggregate data available to project maintainers through public
platform APIs:

- GitHub repository views and unique visitors
- GitHub repository clones and unique cloners
- GitHub popular referrers and paths
- GitHub release asset download counts

These metrics help maintainers understand discovery and distribution trends
without adding client-side telemetry.

## Pi runtime install/update telemetry

The upstream pi runtime (separate from sf-pi) emits one anonymous
install/update version ping to `https://pi.dev/api/report-install` after
a fresh install or changelog-detected update, and a periodic
latest-version probe to `https://pi.dev/api/latest-version`. Neither is
an sf-pi feature.

**sf-pi opts users out of the install/update ping by default.** On the
first session after sf-pi is installed, the manager extension writes
`enableInstallTelemetry: false` to pi's global `settings.json` _if and
only if the key is currently unset_. An explicit user opt-in (`true`)
is always preserved across sessions.

Intentional non-goals of this default:

- The latest-version probe is **not** disabled — users continue to see
  security and feature update nudges. Disable separately with
  `PI_SKIP_VERSION_CHECK=1` or master-kill with `PI_OFFLINE=1`.
- sf-pi never edits the user's shell environment, `~/.zshrc`, or
  exported env vars. The default lives only in pi's `settings.json`.

Manage the setting via the standard `/sf-pi` surface:

```text
/sf-pi telemetry status     # show the current value and source
/sf-pi telemetry on         # opt back in (writes true)
/sf-pi telemetry off        # opt out (writes false)
```

The live state is also rendered on the sf-welcome splash as a `Privacy:
telemetry off (sf-pi default)` row — see
[`extensions/sf-welcome/`](../extensions/sf-welcome/README.md).

## Active telemetry policy

Active telemetry means an installed copy of sf-pi sends events while running on a
user's machine. sf-pi does not do this.

If active telemetry is ever proposed in the future, it must be reviewed as a
separate privacy-sensitive feature and must satisfy these minimum requirements:

1. Off by default.
2. Fully documented before release.
3. Previewable by the user before any event is sent.
4. Easy to disable with settings and environment variables.
5. No prompts, responses, tool payloads, file paths, org identifiers, customer
   names, emails, tokens, or credentials.
6. No persistent identifier unless the user explicitly opts in and can reset it.

Until such a feature is explicitly documented and released, assume sf-pi has no
active telemetry.
