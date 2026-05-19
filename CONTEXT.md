# SF Pi

SF Pi is a bundled set of Salesforce-focused extensions for pi. It exists to make Salesforce development safer, more discoverable, and more agent-friendly inside pi.

## Language

**SF Pi**:
The package-level product that bundles Salesforce-oriented pi extensions.
_Avoid_: sf-pi repo, plugin collection

**Bundled Extension**:
A first-party extension shipped as part of SF Pi and managed through the shared extension catalog.
_Avoid_: plugin, add-on, module

**Manager Surface**:
The user-facing control surface for discovering, enabling, disabling, and configuring bundled extensions.
_Avoid_: admin screen, settings page

**Runtime Surface**:
A way an extension participates in pi during a session, such as a command, tool, provider, event hook, or UI element.
_Avoid_: integration point, hook thing

## Relationships

- **SF Pi** contains one or more **Bundled Extensions**.
- A **Bundled Extension** exposes zero or more **Runtime Surfaces**.
- The **Manager Surface** controls the enabled state and configuration entry points for **Bundled Extensions**.

## Example dialogue

> **Dev:** "Should this new Salesforce helper be another **Bundled Extension**?"
> **Domain expert:** "Only if it has a clear **Runtime Surface** and users should be able to manage it through the **Manager Surface**."

## Flagged ambiguities

- "plugin" is ambiguous because pi calls them extensions; resolved: use **Bundled Extension** for SF Pi-owned extensions.
