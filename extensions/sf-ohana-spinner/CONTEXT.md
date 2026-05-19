# SF Ohana Spinner

SF Ohana Spinner is the lightweight waiting-state companion for active agent turns in SF Pi. It exists to make waiting visible without adding decision-making or Salesforce workflow behavior.

## Language

**Waiting State**:
The short period when pi is actively producing or streaming an agent response.
_Avoid_: loading state, busy state

**Working Indicator**:
The visible animated cue shown during a **Waiting State**.
_Avoid_: loader, progress bar, spinner widget

**Ohana Mode**:
The playful **Working Indicator** mode with rotating Salesforce-themed messages.
_Avoid_: rainbow mode, funny mode, default mode

**Calm Mode**:
The quiet **Working Indicator** mode for users who prefer less color and visual noise.
_Avoid_: plain mode, boring mode, silent mode

**Spinner Mode Preference**:
The user's selected mode for the **Working Indicator**.
_Avoid_: spinner config, loader setting

**Preference Source**:
The project, global, or default origin of the active **Spinner Mode Preference**.
_Avoid_: current source, config path, setting owner

**Session Guard**:
The lifecycle check that prevents stale timers or async work from updating the wrong pi session.
_Avoid_: generation logic, timer hack, cleanup flag

**Message Catalog**:
A curated set of short, product/platform-oriented Salesforce-themed lines used by **Ohana Mode** during a **Waiting State**.
_Avoid_: joke database, content library, quote list, personality jokes

## Relationships

- A **Waiting State** may show exactly one **Working Indicator**.
- The **Spinner Mode Preference** selects either **Ohana Mode** or **Calm Mode**.
- **Ohana Mode** and **Calm Mode** are alternatives, not separate features that run together.
- **Ohana Mode** uses the **Message Catalog** for personality; **Calm Mode** does not.
- The **Spinner Mode Preference** follows SF Pi settings precedence: project settings override global settings, and defaults apply when neither scope is set.
- The **Preference Source** explains why a particular **Spinner Mode Preference** is active.
- The **Session Guard** protects the **Working Indicator** across session switch, reload, and shutdown boundaries.

## Example dialogue

> **Dev:** "Should the extension show Salesforce jokes while the agent is thinking?"
> **Domain expert:** "Only in **Ohana Mode**. Users who choose **Calm Mode** still need a clear **Working Indicator**, but without rotating personality text."

## Flagged ambiguities

- "spinner" can mean the whole extension, the animated glyph, or the mode preference; resolved: use **Working Indicator** for the visible cue and **Spinner Mode Preference** for the user choice.
- "best messages" is subjective; resolved: keep the **Message Catalog** small, witty, and public-safe rather than exhaustive.
- Named-person jokes age poorly and add review risk; resolved: keep the **Message Catalog** focused on products, platform concepts, and community concepts.
- Settings are necessary for **Calm Mode** adoption; resolved: keep **Spinner Mode Preference** behavior in this simplification pass.
- Scoped settings can otherwise look surprising; resolved: keep **Preference Source** visible in the configuration surface.
- Timer and async work can outlive their original session; resolved: keep the **Session Guard** even if it adds some code.
