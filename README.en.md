<div align="center">

# 🔔 dsh-update-checker · Plugin Update Checker

**One-click & background update checker for DeepSeek Harness third-party plugins: upstream detection, changelog diffs, sidebar reminders, and safe AI-assisted updates.**

[![Release](https://img.shields.io/github/v/release/daha1216/dsh-update-checker?color=4d6bfe.svg?style=flat-square)](https://github.com/daha1216/dsh-update-checker/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg?style=flat-square)](./LICENSE)
[![DSH plugin](https://img.shields.io/badge/DSH-plugin-4A90D9.svg?style=flat-square)](https://github.com/topics/dsh-plugin)
[![Tests Passing](https://img.shields.io/badge/tests-350%2B%20passed-brightgreen.svg?style=flat-square)](https://github.com/daha1216/dsh-update-checker)
[![Node >=22](https://img.shields.io/badge/node-%E2%89%A522-339933.svg?style=flat-square)](https://nodejs.org)

[中文](./README.md) · **English**

</div>

---

As the DeepSeek Harness (DSH) plugin ecosystem expands, third-party extensions—from context compression and skills management to session time-travel—greatly enhance the agent's capabilities. However, in day-to-day use:
- Critical bug fixes and new features land upstream, but you have no easy way of knowing about them.
- Manually inspecting npm registries, GitHub Releases, and local repositories is tedious and time-consuming.
- Conventional update tools often silently alter your local workspace or consume massive network quotas.

**dsh-update-checker** is a native **plugin update checker** crafted for DeepSeek Harness. Adhering strictly to a **"Pure Read-Only Inspection · Zero Unintended Modifications"** security policy, it offers full-spectrum manual scanning, detailed changelog diffing, low-overhead **background scheduled checks**, and an unobtrusive **sidebar badge with interactive popups**. When a new release is detected, a single click passes the formatted upgrade command to your AI agent for safe, guided execution.

---

## 📸 Visual Showcase

<div align="center">

| Sidebar Reminder Popup (Background Scheduler) | Settings View: Plugin Updates Center |
| :---: | :---: |
| <img src="./assets/reminder-popup.png" width="450" alt="Sidebar badge and pending update popup" /> | <img src="./assets/settings-panel.png" width="470" alt="Full-view Plugin Updates settings panel" /> |
| *Background checks run quietly. When updates are found, an unobtrusive badge appears in the bottom sidebar. Click to view pending versions, trigger AI updates, or ignore releases.* | *One-click full scan with separate status and install-source filters; the background reminder collapses to a single row with settings on demand, and release notes render as rich Markdown.* |

</div>

---

## ✨ Key Features

### 1. 🔍 Full-Spectrum Scanning & Multi-Source Detection
- **Comprehensive Dependency Discovery**: Automatically parses the active profile's `package.json`, extracting third-party plugins while filtering out internal `@deepseek-ai/*` packages.
- **Universal Source Support**:
  - **npm SemVer Specs** (`^1.2.3`, `~0.1.6`, exact versions): Queries the official npm registry with seamless npmmirror fallback.
  - **GitHub Remote References** (`github:owner/repo#tag`): Compares against the latest GitHub Release tags; branch or commit references are clearly classified as "tracking branches".
  - **Local Development Installs** (`file:` / `link:`): If the project points to an upstream GitHub repository, it compares versions and labels them as "local ahead", "local behind", or "in sync with upstream".
- **Granular Status & Filter Chips**: Status filters for `All`, `Updates Available`, `Latest`, and `Needs Attention`, plus a **separate** install-source dropdown (npm / GitHub / local) — a local checkout can trail upstream too, so source is not a status. Sort by status or name.
- **Compact Rows**: Each row merges name, status and version onto one line, clamps the description to a single line, and moves the install spec and release notes into the expander — noticeably more plugins per screen (since v0.7.0).

### 2. 🔔 Background Scheduler & Non-Intrusive Sidebar Alerts
- **Configurable Polling Intervals**: Set your preferred background check frequency in Settings (every 30 mins / 1 hour / 2 hours / 6 hours, or custom minutes).
- **Subtle Sidebar Badge**: When updates are available, a clean counter badge appears in the bottom-left sidebar (e.g., `↑ Plugin Updates 2`), preserving your coding flow without disruptive popups.
- **Rich Popup Controls**:
  - **Clear Version Diffs**: Shows exact version transitions (`Installed → Latest`).
  - **Ignore This Release**: Temporarily dismisses the reminder until a newer version is released or a manual check is run.
  - **Ignore All**: Marks all current updates as acknowledged and suppresses ongoing alerts.
  - **Durable Persistence**: Dismissal preferences and pending update lists persist across DSH restarts and profile reloads.

### 3. 🤖 AI-Assisted Updates: "Update with AI" and "Update all"
- **Strict Read-Only Guarantee**: The plugin **never runs package managers or alters `node_modules` and config files on its own**.
- **One-Click Agent Delegation**: Clicking "Update with AI" fills the chat input with a standardized prompt (e.g., `Help me update the billion-context plugin`). If no session is active or focused, it cleanly falls back to copying the instruction to your clipboard, allowing the agent to follow best practices in an isolated sandbox.
- **Update All (batch)**: When several plugins are outdated, an "Update all" button appears in the popup footer and in the settings page header. One click **opens a new conversation and fills its composer with the whole pending list — it does not send**. The list carries each plugin name, installed → latest version, install spec (`file:` / `link:` / `github:` / npm) and the profile name, so the agent can update them one by one and report back. Sending stays your call; if a new conversation cannot be created it falls back to the current composer, then to the clipboard and says so.

### 4. 📖 Deep Changelog Parsing (Release Notes Diff)
- **Range-Aware Release Aggregation**: Aggregates all Release entries between the currently installed version and the latest stable release.
- **Zero-Dependency Markdown Engine**: Features a custom lightweight Markdown AST parser supporting headings, lists, code blocks, blockquotes, bold text, and links.
- **No innerHTML XSS Risk**: Translates plain text directly into AST nodes and safe React elements.
- **Lazy Rendering**: Release notes remain collapsed by default and render on demand, ensuring zero lag even when displaying multi-thousand-word changelogs.

### 5. ⚡ Industrial-Grade Unified Outbound HTTP Layer
- **Single-Flight Coalescing**: Duplicate concurrent requests to identical URLs are merged into a single network flight (e.g., multiple plugins sharing the same repo).
- **TTL Memory Cache + ETag Conditional Requests (304 Not Modified)**:
  - Cache hits within 5 minutes are served instantly from memory.
  - Stale cache entries dispatch conditional requests with `If-None-Match`. **GitHub 304 responses do not consume unauthenticated API quota** (60 requests/hour/IP).
- **High-Quota GitHub Token**: Set `GITHUB_TOKEN` or `GH_TOKEN` in your environment to automatically send Bearer authentication, increasing your quota to 5,000 requests/hour.
- **Concurrency Capping & Circuit Breaking**: Limits concurrent outbound sockets to 6. If rate limits (403/429) are encountered, the host cooldown pauses requests according to `x-ratelimit-reset` and gracefully falls back to jsDelivr CDN.
- **Fast-Path npm dist-tags**: Queries lightweight `dist-tags` (~200 bytes) first to instantly verify up-to-date packages without downloading heavy megabyte-sized packuments.

### 6. 🛡️ Architectural Reliability & Native DSH Design
- **Cordis 4 Compliance**: Disposers register strictly through `ctx.effect`. Scheduler state is held in closures, avoiding accidental property pollution on `ctx`.
- **Atomic Persistence & Multi-Profile Isolation**: State files are saved via atomic temporary file renaming (`tmp` + `rename`). Cache and reminder files are scoped per profile.
- **Concurrent In-Process Serialization (withStateLock)**: Prevents race conditions between background scan writes and frontend user actions (e.g., clicking ignore).
- **DSH Design Tokens Alignment**: Fully redesigned in v0.3.2 to match official DSH Design Tokens, ensuring crisp readability and WCAG-compliant contrast in dark mode.

---

## 🧭 Status Glossary

| Status | Display Label | Description |
|---|---|---|
| `update` | **Update Available** | A newer stable release exists upstream. Expand to inspect the full release notes. |
| `local-behind` | **Local · Upstream Newer** | Local development install (`file:` / `link:`) has a lower version than upstream. |
| `local-ahead` | **Local · Ahead of Upstream** | Local version is higher than upstream (active local development or upstream version rollback). |
| `local-latest` | **Local · In Sync** | Local version matches the latest upstream release exactly. |
| `latest` | **Up to Date** | Installed npm version matches the latest stable release. |
| `branch` | **Tracking Branch** | Installed from a git branch or commit SHA (e.g., `#main`), where SemVer comparison does not apply. |
| `unknown` | **Indeterminate** | Version cannot be parsed from the reference (e.g., non-standard tags). |
| `local` | **Local Install** | Local install without an upstream repository link. |
| `error` | **Check Failed** | Network timeout, domain resolution error, or rate limiting; the error message is displayed inline. |

---

## 📦 Installation & Configuration

> **Prerequisites**: DeepSeek Harness installed with Node.js ≥ 22.

### Option 1: Profile Install (Recommended)

Run the following command in your terminal:

```bash
# For DSH Desktop
dsh plugin --profile desktop add github:daha1216/dsh-update-checker

# For DSH Web standalone deployment
dsh plugin --profile web add github:daha1216/dsh-update-checker
```

> 💡 **Important Notes**:
> 1. After installing, **completely restart the DSH Desktop application** (to load the host Cordis module) and **refresh the GUI page** (to load the frontend script).
> 2. To update the checker itself later, simply re-run the same `add` command.
>
> **Compatibility**: `engines.dsh` declares `^0.2.0-rc.1`, i.e. **DSH 0.2.0-rc.1 up to (but not including) 0.3.0**. On an unsupported runtime the plugin manager refuses with `incompatible-version`; add a one-off exemption with `dsh plugin allow-version` if you really need to try it elsewhere. Once DSH reaches 0.3.x this plugin needs a new release to widen the range.

### Option 2: Local Development (Checkout Mode)

To clone and develop locally:

```bash
git clone https://github.com/daha1216/dsh-update-checker.git "D:/dsh work/dsh-update-checker"
dsh plugin --profile desktop add "file:D:/dsh work/dsh-update-checker"
```

---

## 🔑 Environment Variables

| Variable | Purpose |
|---|---|
| `GITHUB_TOKEN` / `GH_TOKEN` | Bearer token for the GitHub API. Defaults to unauthenticated mode (60 req/hr/IP); setting this expands the quota to **5,000 req/hr**. |

---

## 🏗️ Architecture & Internal Design

```
dsh-update-checker/
├── index.js          # Cordis host plugin: route mounting, RPC handlers, scheduler, lifecycle
├── lib/
│   ├── http.js       # Outbound network layer: single-flight, TTL cache, ETag 304, circuit breaker
│   ├── checker.js    # Pure-function checker: package.json parser, multi-source resolution, release diffing
│   ├── reminder.js   # Reminder state management: fingerprinting, ignore policies, atomic file I/O
│   └── md.js         # Zero-dependency Markdown parser: safe AST generation & React mapping
├── client/
│   └── client.js     # Frontend Settings view & sidebar action: i18n, UI state machine, interactions
├── locale/           # Plugin metadata translations (zh.json / en.json)
├── assets/           # Screenshots and visual assets
└── test/             # Comprehensive automated test suites
```

### 1. RPC Communication & Fencing
- The frontend Settings page and sidebar popup communicate with the host via a dedicated Connection RPC channel (`/dsh-update-checker`).
- The host mounts this channel as a `kind: 'prefix'` route on the trusted `webServer`, mirroring the official `/api` protocol with strict loopback and origin rejection guards.

### 2. Scheduler Resilience & Concurrency
- The reminder scheduler is completely isolated in closures, preventing property leakage onto `ctx`.
- Active timers are tracked and guaranteed to be cleared on fiber disposal via `ctx.effect`.
- In-flight scans and foreground dismiss actions are coordinated via `withStateLock` to prevent file corruption.

---

## 🧪 Automated Testing

The codebase includes 11 test suites with over **350 passed assertions**:

```bash
# Run the complete offline test suite
npm test

# Run isolated end-to-end tests against real network sources
npm run test:e2e
```

- `test/checker.test.mjs`: 69 assertions for exact version comparison, spec/range mapping, and status transitions.
- `test/http.test.mjs`: 28 tests verifying TTL caching, single-flight coalescing, ETag revalidation, cache bounds, error-body release, and circuit breaking.
- `test/host.test.mjs`: 30 tests over real sockets for the loopback fence and the `node:http` → fetch bridge (oversized bodies, disconnects, error containment).
- `test/integration.test.mjs`: 30 tests simulating complete check pipelines under scripted network conditions (`#semver:` ranges, no mirror fallback on 404).
- `test/md.test.mjs`: 23 tests validating Markdown parser accuracy and sanitization.
- `test/render-harness.mjs`: Headless React rendering smoke tests for settings and popup views.
- `test/lifecycle.test.mjs`: Real Cordis 4 lifecycle tests validating clean disposal and route teardown.
- `test/reminder.test.mjs`: 77 assertions covering reminder state logic, ignore semantics, fingerprint collisions, and atomic persistence.
- `test/reminder-panel.test.mjs`: 19 source guards locking the force-refresh path, timers/watchdog and status-line copy.
- `test/batch-update.test.mjs`: 43 assertions covering the batch list, updatable predicate and the "new conversation, fill but do not send" handoff.
- `test/reminder-scheduler.test.mjs`: 35 assertions testing scheduler interval rescheduling, the forced-refresh floor, and RPC fallbacks.

---

## 📝 Changelog

### Unreleased (security & robustness audit, 2026-10-27)
- **Host crash containment**: every async path of the `node:http` → fetch bridge (reading the request body, fetching, writing the response, `waitForDrain`) now runs inside try/catch/finally; a client disconnect cancels the response body and stops writing, and 500s only say `update check failed` — no internal messages or absolute paths reach the renderer. New `test/host.test.mjs` covers this with real sockets.
- **Loopback fence parses the Host header** instead of `split(':')`: `127.0.0.1:56185@evil.example` is no longer trusted, IPv6 `[::1]:56185` works again, and 127/8 aliases are accepted. The bridge builds its `Request` from a fixed internal origin plus the request path, so a malformed Host or an absolute-form request line can no longer throw.
- **Bounded inputs and honest errors**: an unreadable/malformed profile `package.json` fails the scan instead of pretending "no plugins"; dependency keys are validated against the npm shape before being joined into `node_modules`; packument names are encoded; a 404 from the primary registry no longer discloses the package name to the npmmirror fallback.
- **Version decisions fixed**: digit segments above 2^53 compare exactly; `1`/`1.2` are ranges rather than exact pins; `#semver:` refs pick the highest satisfying tag (or report `unknown` when none matches) instead of recommending a breaking major; canonical `git+ssh`/`ssh://`/`git://`/`scp` GitHub URLs are recognized.
- **Process hygiene**: the HTTP response cache is capped at 400 entries and released on fiber teardown; per-scan caches are dropped per profile; stale ignore entries are pruned; config/state/snapshot files are written 0700/0600 with temp-file cleanup; failed config writes no longer report success.
- **Client timers and fingerprints**: `checkNow`'s 500 ms ticker and 90 s watchdog are cleared on success, timeout, and unmount; `draftInNewSession` subscribes before the first fill and cannot leak a listener when the new session mounts synchronously; reminder fingerprints are JSON-encoded pairs so `@`/`|` in plugin names cannot collide. Test matrix grows to 11 suites / 350+ assertions.

### v0.7.1 (2026-10-27)
- **Fixed: the sidebar entry no longer squeezes other plugins out of its row.** The sidebar footer is a flex row shared by several plugins, and this one hard-coded `width: 100%` with `flex: none` — whenever another entry shared the row (for example the dsh-purge status dot), it took the entire width and left that entry a few pixels wide. It now uses `flex: 1 1 0%; min-width: 0`, spreading when there is room and shrinking when there isn't, with overlong titles handled by the existing ellipsis; the collapsed rail keeps an explicit `flex: 0 0 36px`, matching its previous width.
- Client-side CSS only: a page refresh applies it and no host restart is needed. No backend, state machine, or storage-format changes.

### v0.7.0 (2026-10-26)
- **Settings page rebuilt around updates, with configuration folded away**: the rarely-touched background settings no longer own the first screen, and long descriptions no longer crowd out the plugin list.
  - **Reminder collapsed to one row**: switch, current state and interval sit on a single line (`Auto-check · On · every 2 hours`); the interval selector, its explanation and save errors live behind a "Settings" expander.
  - **Slimmer rows**: name, status and version share one line, the description clamps to a single line (full text on hover, or expand), and the install spec and release notes move into the expander.
  - **Status and source are separate filters**: install source (npm / GitHub / local) left the status chips for its own dropdown, listing only the sources actually installed. "Local" and "updates available" sat in one row as if mutually exclusive, yet a local checkout can trail upstream just as well.
  - **Buttons explain themselves**: a permanent line under "Update all" says it opens a new conversation with the list filled in, instead of hiding that in a tooltip.
- **Local-behind rows gained the update button**: `local-behind` (`file:` / `link:` install with a newer upstream) appeared under "Updates Available" and in the batch list but had no per-row "Update with AI" button. Row buttons and the batch list now share one `isActionable` predicate.
- **Healthy states quieted down**: "Latest" and friends moved from green to neutral; red is reserved for rows that actually failed.
- **Tests**: `test/render-harness.mjs` seeds follow the new `sourceFilter` / `expanded` state, and the row-button assertion now locks the `isActionable` gate.

### v0.6.0 (2026-10-26)
- **"Update all" now opens a new conversation and does not send**: it used to splice the whole list into the current session's prompt and press send for you. It now opens a **new conversation**, fills its composer with the list, and **does not send** — timing stays yours. Because it targets the new conversation's composer rather than the active one, it cannot pollute the chat you are in; if that composer has not mounted yet it waits up to 10 seconds instead of falling back to the old session. When no new conversation can be created it falls back to the current composer, then the clipboard.

### v0.3.5 (2026-10-19)
- **Fixed Timer Rescheduling Race**: Eliminated duplicate timer creation when changing the polling interval during an active scan.
- **Serialized Write Queue (withStateLock)**: Queued scan persistence and user ignore actions to prevent concurrent state overwrite.
- **RPC Fallback Graceful Degradation**: Protected `connection.rpc.handle` fallback from throwing in environments without `webServer`.
- **Dynamic Custom Interval Display**: Automatically appends and selects non-preset intervals configured directly in JSON.
- **Added Scheduler Regressions**: Added scenarios C and D to `test/reminder-scheduler.test.mjs` (33 assertions total).

### v0.3.4 (2026-10-19)
- **Fixed State Deserialization Loss**: Resolved an issue where reading back saved state from `reminder-<profile>.json` emptied the pending update list.
- **"Update with AI" Action**: Updated action buttons to prefill the composer with standardized upgrade instructions.
- **Top-Level Scheduler Card**: Moved the background reminder configuration card to the top of the Settings view.

### v0.3.3 (2026-10-18)
- **Cordis 4 Lifecycle Refactoring**: Fixed host crash issues under DSH 0.2.1-rc.2 by keeping scheduler state in private closures.
- **Introduced Sidebar Action & Popups**: Added the bottom sidebar badge, interactive reminder card, and dismiss options.

### v0.3.2 (2026-10-18)
- **Comprehensive Dark Mode Restyling**: Aligned color tokens with official DSH Design Tokens, fixing unreadable buttons and low-contrast borders.

### v0.3.1 (2026-10-18)
- **Profile Isolation & Status Enhancements**: Scoped cache files per profile; added `local-ahead` status; improved release range slicing; enabled `GITHUB_TOKEN` Bearer auth.

### v0.3.0 (2026-10-17)
- **Outbound HTTP Engine Overhaul**: Added concurrency limits, single-flight caching, ETag 304 revalidation, and npm `dist-tags` fast-path.

---

## 🙏 Contributors

Thanks to everyone who contributed code and improvements to this project:

- [@lanslot4n93r](https://github.com/lanslot4n93r) — dark-mode primary button color fix (`label-primary-inverted`).

---

## 📄 License

Open-sourced under the [MIT License](./LICENSE).

## 🔗 Related Projects

- Featured in [dsh-plugin-collection](https://github.com/daha1216/dsh-plugin-collection).
- Companion DSH plugins by the same author:
  - [dsh-retrace](https://github.com/daha1216/dsh-retrace) — Session time machine: message recall, in-place edit & resend, and artifact rollbacks.
  - [dsh-skills-manager](https://github.com/daha1216/dsh-skills-manager) — Visual management panel for DSH skills and invocation policies.
  - [dsh-watcher](https://github.com/daha1216/dsh-watcher) — Cross-session environment change monitor.
