# Roadmap

An item is checked only when its deliverable and associated evidence exist. Simulated tests never count as a natural quota cycle.

- [x] Phase 0: inspect legacy code, pass baseline unit tests, preserve runtime privately, commit and tag legacy baseline, import source with migration provenance.
- [ ] Phase 1: current community/protocol/framework research, licenses, telemetry semantics, stack ADR.
- [ ] Phase 2: adapters, live quota polling (10 seconds), independent history sampling (60 seconds), durable scheduling, SQLite, compatibility and doctor; pass headless tests first.
- [ ] Phase 3: Windows dashboard, threads, quota, tray, settings, diagnostics.
- [ ] Phase 4: quota charts, token/model/tier/effort analytics, context-aware versioned API-equivalent pricing.
- [ ] Phase 5: performance telemetry with exact, estimated, and unavailable distinctions.
- [ ] Phase 6: priority, reserve, concurrency, retries, resume queue and manual controls.
- [ ] Phase 7: desktop widget, expanded tray controls, deduplicated notifications, privacy mode.
- [ ] Phase 8: restart/offline/crash/unknown-version/corruption/manual-control/multiple-thread reliability.
- [ ] Phase 9: observe and document a real exhaustion → official reset → recovery → task completion cycle.
- [ ] Phase 10: security gate, public repository, CI, portable build, installer, hashes, screenshots, v0.1.0 release.

The complete acceptance checklist is maintained in [requirements](docs/requirements.md). Every stable stage is committed and pushed after scanning the publication surface.
