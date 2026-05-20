# SF Browser Setup Destinations

Setup Destinations are curated, public-safe shortcuts from stable names to Salesforce Setup paths. Prefer them over search-and-click navigation when the target Setup page is known.

This list is intentionally small. It is not a full Salesforce Setup sitemap.

| Destination            | Path                                                    | Use for                                                                         |
| ---------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `setup-home`           | `/lightning/setup/SetupOneHome/home`                    | Setup landing page and general navigation starting point.                       |
| `agentforce-agents`    | `/lightning/setup/EinsteinCopilot/home`                 | Agentforce Agents setup, Agentforce enablement evidence, New Agent entry point. |
| `connected-apps`       | `/lightning/setup/ConnectedApplication/home`            | Manage Connected Apps, OAuth usage and policy evidence.                         |
| `data-cloud-setup`     | `/lightning/setup/CDPSetupHome/home`                    | Data Cloud Setup Home evidence after Data 360 API readiness checks.             |
| `external-client-apps` | `/lightning/setup/ManageExternalClientApplication/home` | External Client Apps setup evidence and UI fallback navigation.                 |
| `flows`                | `/lightning/setup/Flows/home`                           | Flow list, Flow Builder entry, flow activation evidence.                        |
| `object-manager`       | `/lightning/setup/ObjectManager/home`                   | Object and field setup navigation.                                              |
| `session-settings`     | `/lightning/setup/SecuritySession/home`                 | Session timeout, clickjack, CSP, and related security setting evidence.         |
| `sharing-settings`     | `/lightning/setup/SecuritySharing/home`                 | Organization-Wide Defaults and sharing-rule evidence.                           |
| `users`                | `/lightning/setup/ManageUsers/home`                     | User records, user access evidence, permission-assignment fallback navigation.  |

## Promotion criteria

Add a new destination only when all are true:

1. The path is stable enough to be used as a shortcut.
2. The destination is useful for repeated SF Pi workflows.
3. The name is generic and public-safe.
4. A runbook or repeated task needs it.

## Usage

```json
{
  "target_org": "my-sandbox",
  "setup": "agentforce-agents",
  "purpose": "Verify Agentforce is enabled"
}
```

For unknown or one-off destinations, pass an explicit `path` instead of adding a destination prematurely.
