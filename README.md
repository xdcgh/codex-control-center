# Codex Control Center

A local-first Windows control center for OpenAI Codex — quota monitoring, thread/Goal recovery, scheduling, token analytics, performance telemetry, and API-equivalent cost analysis.

This is an unofficial project, not affiliated with OpenAI. It stores application analytics locally and sends no application telemetry. API-equivalent estimates are based on public API prices and are not Codex subscription bills. Private Desktop protocol compatibility can change; unknown versions must remain in read-only safe mode.

Development follows the [roadmap](ROADMAP.md). [Progress and validation](PROGRESS.md) distinguish implemented features, isolated tests, live Desktop checks, and the natural quota cycle. A working GUI alone is not release acceptance.

## Development

Node.js 24 or newer is required by the retained recovery engine and built-in SQLite integration.

```powershell
npm install
npm test
```

The original recovery engine remains in `src/`, with its original test suite in `test/`. The original installed watchdog is retained separately during development. The [migration baseline](docs/baseline.md) records provenance and rollback. The [historical watchdog guide](docs/legacy-watchdog.md) describes the baseline behavior, including its old reset buffer.

Core v2 polls actual quota every 10 seconds by default, saves quota history independently every 60 seconds, and resumes eligible work without a reset buffer. Both short and weekly blocking windows must be available. Fresh-state/Goal checks and the durable send ledger prevent unsafe repeat dispatch; priority, quota reserve, concurrency and manual controls guard the queue. Unknown Desktop versions leave monitoring available and disable automatic writes.

The desktop application includes a quota dashboard/history, Thread/Goal policies, token and performance views, diagnostics, tray and widget. Pricing uses versioned public-source snapshots; missing telemetry stays Partial or Unavailable. Independent tests, actual Desktop smokes and installed-application evidence are recorded in [validation](docs/validation.md), with their source stages and limits.

The public repository and Windows/Linux CI are active. Staged unsigned Windows installer and portable artifacts have passed direct payload comparison and an installed GUI/UI-restart check. Physical Windows restart, actual tray clicks and full natural Goal completion remain open acceptance items. The [complete requirement audit](docs/acceptance-audit.md) tracks additional work; no production v0.1.0 release is claimed yet.

For native builds and package verification, follow [Windows build instructions](docs/build.md). User runtime, sessions and authentication files are excluded from source and packages. A portable package keeps application data in the user's local profile; it is not a copy of Codex credentials or private threads.

See [requirements](docs/requirements.md), [architecture decisions](docs/adr/001-desktop-stack.md), [security policy](SECURITY.md), and [third-party notices](THIRD_PARTY_NOTICES.md). Distribution packages will be published only after the security gate and required acceptance checks pass.
