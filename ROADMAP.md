# Roadmap

An item is checked only when its deliverable and associated evidence exist. Simulated tests never count as a natural quota cycle.

- [x] Phase 0: inspect legacy code, pass baseline unit tests, preserve runtime privately, commit and tag legacy baseline, import source with migration provenance.
- [x] Phase 1: current community/protocol/framework research, licenses, telemetry semantics, stack ADR.
- [x] Phase 2: adapters, live quota polling (10 seconds), independent history sampling (60 seconds), durable scheduling, SQLite, compatibility and doctor; headless suite and live read-only probes passed.
- [x] Phase 3: Windows dashboard, threads, quota, tray presence, settings, diagnostics; installed application reused the authenticated Core. Actual tray menu interaction remains Phase 7 acceptance.
- [ ] Phase 4: quota charts, token/model/tier/effort analytics, context-aware versioned API-equivalent pricing.
- [ ] Phase 5: performance telemetry with exact, estimated, and unavailable distinctions.
- [x] Phase 6: priority, reserve, concurrency, retries, resume queue and manual controls; independent race/restart/fail-safe acceptance passed.
- [ ] Phase 7: desktop widget, expanded tray controls, deduplicated notifications, privacy mode.
- [ ] Phase 8: restart/offline/crash/unknown-version/corruption/manual-control/multiple-thread reliability.
- [ ] Phase 9: observe and document a real exhaustion → official reset → recovery → task completion cycle.
- [ ] Phase 10: security gate, public repository, CI, portable build, installer, hashes, screenshots, v0.1.0 release.

The complete acceptance checklist is maintained in [requirements](docs/requirements.md). Every stable stage is committed and pushed after scanning the publication surface.

On 2026-10-08 the installed GUI and widget survived a UI-only restart; NSIS payload equality, schema migration, offline corruption-preservation controls and a mandatory recovery-review fence passed targeted acceptance. These do not complete physical Windows restart or the natural Goal lifecycle. Outstanding fields and evidence are itemized in [the requirement audit](docs/acceptance-audit.md).
