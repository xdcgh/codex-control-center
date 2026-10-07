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

See [requirements](docs/requirements.md), [architecture decisions](docs/adr/001-desktop-stack.md), [security policy](SECURITY.md), and [third-party notices](THIRD_PARTY_NOTICES.md). Distribution packages will be published only after the security gate and required acceptance checks pass.
