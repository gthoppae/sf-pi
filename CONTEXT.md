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

**SF Brain**:
The Bundled Extension that gives agents compact Salesforce operator guidance and a reference map to the deeper SF Pi and Salesforce resources they should load only when needed.
_Avoid_: Salesforce encyclopedia, all-purpose memory dump

**Salesforce Operator Kernel**:
The dense, always-available operating rules for safe Salesforce work, including how to choose APIs, verify org state, and avoid guessing live-org details.
_Avoid_: documentation index, Salesforce knowledge base

**SF Pi Reference Map**:
A compact guide that points agents from SF Brain to repo-local sources of truth such as the extension catalog, command reference, extension READMEs, and bundled progressive skills. It may mention active SF skills as a runtime signal, but must not assume user-global skill-library paths.
_Avoid_: duplicated docs, hardcoded personal skill paths, Salesforce encyclopedia

## Relationships

- **SF Pi** contains one or more **Bundled Extensions**.
- A **Bundled Extension** exposes zero or more **Runtime Surfaces**.
- The **Manager Surface** controls the enabled state and configuration entry points for **Bundled Extensions**.
- **SF Brain** is a **Bundled Extension** that provides the **Salesforce Operator Kernel**.
- The **Salesforce Operator Kernel** points to the **SF Pi Reference Map** when deeper routing context is needed.

## Example dialogue

> **Dev:** "Should this new Salesforce helper be another **Bundled Extension**?"
> **Domain expert:** "Only if it has a clear **Runtime Surface** and users should be able to manage it through the **Manager Surface**."

## Flagged ambiguities

- "plugin" is ambiguous because pi calls them extensions; resolved: use **Bundled Extension** for SF Pi-owned extensions.
- "brain" could mean an all-purpose knowledge base; resolved: **SF Brain** stays compact and routes to the **SF Pi Reference Map** instead of loading broad Salesforce content eagerly.
