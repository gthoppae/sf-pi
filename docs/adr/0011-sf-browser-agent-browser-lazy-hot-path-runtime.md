# ADR 0011: SF Browser uses agent-browser as a lazy hot-path runtime

SF Browser is an experimental developer-assistive Bundled Extension for Salesforce UI last-mile work that Salesforce APIs cannot cover; it does not imply a stable Salesforce UI automation contract. We decided to use `agent-browser` as a Lazy Browser Runtime and expose only a cache-first `/sf-browser` command panel plus a Hot-Path Browser Tool Set (`open`, `snapshot`, `click`, `fill`, `press`, `wait`, and Browser Evidence capture), rather than wrapping the full browser automation surface or building a Playwright/Selenium-style driver layer. This keeps SF Pi agent-first, avoids boot-time probes and permission fatigue, preserves `agent-browser`'s fast CDP workflow, and leaves advanced browser work to direct `agent-browser` usage.

## Consequences

- SF Browser does not pursue feature parity with `agent-browser`.
- SF Browser does not mediate normal browser actions with v1 permission gates.
- `agent-browser` is detected and invoked only after explicit command or tool intent.
- Browser Evidence stores full-resolution screenshots privately under `browser-artifacts/latest/`, tracks captures with a lightweight index, and returns bounded image content only through explicit evidence capture modes.
- Salesforce Browser Contracts live in tool descriptions, tool results, help, and optional progressive skills rather than complex runtime logic.
- SF Browser v1 uses one default named `agent-browser` session instead of per-org or per-conversation browser sessions.
- Click and fill tools are ref-first in v1; semantic locator hardening remains a future decision, with direct `agent-browser` usage as the escape hatch.

## Follow-up learnings from first org test

The first Agentforce setup check showed that SF Browser needs more Salesforce-specific first-shot behavior while keeping the runtime thin:

- Browser Evidence should perform best-effort Ambient Overlay Dismissal for known non-workflow Salesforce overlays so screenshots are not obscured by guidance, security, or contact panels.
- SF Browser should prefer curated Setup Destinations, such as `agentforce-agents`, over search-and-click navigation when the target Setup path is known.
- These refinements remain contracts and small helpers, not a broad DOM abstraction or full Setup sitemap.
- Snapshot results should be pi-native: full `agent-browser` output is saved as an artifact, while the default model-visible content is a smart, icon-labeled summary with page URL, surface classification, alerts, primary actions, table/list summaries, and focus matches. Full inline snapshot output remains explicit opt-in.
- SF Browser tool results should include user-visible elapsed duration to make optimized last-mile workflows measurable without treating the value as an SLA or benchmark.
- SF Browser owns setup/admin UI evidence and fallback runbook references so SF Pi can stay API-first while remaining browser-ready when APIs or owning extensions fail.
- Salesforce Classic Setup Surface runbooks should use `select` plus Add/Remove controls for dual-list pages, treat near-timeout waits as ambiguous, and recover from validation errors through evidence capture plus direct navigation.
- Browser Evidence should support explicit scroll targeting (`scrollToRef`) so lower-page assertions can produce useful screenshots without adding automatic visual search.
