# Validation record and phase boundaries

Updated 2026-10-07. This page separates baseline evidence, research, simulations and live natural-cycle acceptance. A result in one category does not imply the others passed.

## Phase 0 — Baseline

| Check | Result | Scope and limits |
| --- | --- | --- |
| Legacy Node unit suite | **PASS: 25/25; 0 failed** | Isolated unit tests from the imported watchdog; no live model request. |
| Full repository `npm test` suite | **PASS: 52/52; 0 failed** | Includes baseline tests, Core v2 fixtures and black-box acceptance tests using simulated adapters and temporary SQLite. No real Codex turn was started. |
| Legacy repository state | **Saved** | Legacy source baseline commit `56175194b7c4896c64636d161ecab4d0457beacc`, tag `legacy-watchdog-baseline-2026-10-07`. The original runtime daemon was not stopped or modified. |
| New repository migration baseline | **Saved** | Initial import commit `e115cae` and tag `legacy-import-baseline-2026-10-07`. |
| Existing Desktop smoke scripts | **Inspected, not run** | They create owned test Threads/Goals, navigate Desktop, send model turns and write receipts. Their side effects were excluded from Phase 0 read-only validation. |
| Natural quota cycle | **NOT OBSERVED** | The 25 unit tests do not simulate or establish a real quota reset. See [acceptance record](../E2E-NATURAL-QUOTA-CYCLE.md). |

### Legacy natural-event observation (not Core v2 acceptance)

On 2026-10-07, the legacy watchdog recorded a Goal in `waitingQuota` at `02:51:39.149Z` with the 5-hour reset timestamp `1791343173` (`11:19:33 +08:00`). The legacy watchdog reported a continuation accepted at `03:21:44.163Z`. Record classification: **LEGACY / INCOMPLETE for Core v2**. This is operational evidence from the old daemon, not evidence for the new 10-second detector, scheduler, or Core v2 persistence. It must not be copied into the Core v2 natural-cycle acceptance as a pass.

## Phase 1 — Research

Source and license review is recorded in [research.md](research.md). Token/accounting, pricing and timing semantics are recorded in [telemetry-and-pricing.md](telemetry-and-pricing.md). Official docs are dated snapshots; upstream Codex references are pinned to a commit. No source-code reuse is represented by this research.

| Check | Result | Scope and limits |
| --- | --- | --- |
| Eleven named community repositories | **Reviewed at pinned commit** | Capability and actual license-file links in `research.md`; `manuelsh/codex-monitor` has no committed LICENSE file at its observed SHA and is reference-only. |
| Codex app-server and telemetry source | **Reviewed at pinned commit** | Protocol shapes and current source fields only; no live runtime compatibility claim. |
| OpenAI API model/pricing docs | **Reviewed 2026-10-07** | Public API pricing reference only; not Codex subscription billing or quota impact. |
| Desktop framework docs | **Reviewed 2026-10-07** | Tauri 2, Windows App SDK/WinUI/WPF, Electron capabilities; no comparative benchmark run. |

### Observability adapter targeted acceptance

Targeted black-box acceptance: **PASS 6/6** via `node --test test/acceptance-observability.test.mjs`, using synthetic JSONL events and a temporary SQLite database. No actual Codex session data was read. This result does not represent a full `npm test` rerun after the observability files were added.

Source identity: repository base commit `f901eab` plus the uncommitted working tree at test time. SHA-256 fingerprints:

| File | SHA-256 |
| --- | --- |
| `src/observability/index.mjs` | `C0304F07C6994E3D8B3AB40C3E663E5BA971D56B48B3074C13A1D95F59C1A0E7` |
| `src/observability/session-log-adapter.mjs` | `40C68B6852ED9168C607C9AAE639DC36BEAA996DC6A49DAC011D77AD19FDC8A7` |
| `src/observability/pricing.mjs` | `06A54804CAC57AEE3B901AC2DF6507E1D4DE94481A5E282E2971B0662FB0A625` |
| `pricing.json` | `5E71029349A2EAA4D69E22E5A1B57B5712ABA556DE29743D631DC3C588E38161` |
| `test/acceptance-observability.test.mjs` | `A8D972F1FCFC2DD25E8E7F8A20401D38E3168EA7854994A71205228EF51CC737` |

## Windows build tool availability (read-only check)

| Tool | Observation | Interpretation |
| --- | --- | --- |
| Rust / Cargo | Initial shell probe did not find `rustc` or `cargo` on PATH. A task-specific Rust 1.99 toolchain was subsequently installed outside global PATH. | The compiler toolchain is present for this task; the default shell still needs its explicit path/environment. No global PATH change was made. |
| MSVC C++ toolchain | Visual Studio Build Tools `18.10.12224.181`; MSVC tools `14.51.36231`; x86/x64 VC Tools component and `cl.exe` exist | Installed. `cl.exe` is not on the inspected shell PATH, so invoke through a Developer Command Prompt or an explicit VS environment. No compilation was run. |
| .NET SDK | `dotnet.exe` is present; `dotnet --list-sdks` returned no SDK entries | No .NET SDK detected. .NET Core and Windows Desktop runtimes 8.0.14 and 9.0.3 are installed. |
| WebView2 runtime | Runtime directories and `msedgewebview2.exe` / `EmbeddedBrowserWebView.dll` observed under `C:\Program Files (x86)\Microsoft\EdgeWebView\Application` (`154.0.4258.37`, `154.0.4258.53`) | Runtime appears installed. No Tauri app launch/loader test was performed. |

This is a tool-presence record, not a build result. The task-specific Rust toolchain is not added to global PATH. It does not verify a Tauri build, WebView2 loader resolution inside the app, code signing, installer packaging, or application runtime.

## Later phase evidence

| Phase | Required evidence | Current state |
| --- | --- | --- |
| Phase 2 — Core v2 | Deterministic parser/state/scheduler tests; app-server integration with explicit authorization; durable-state restart tests; no duplicate dispatch | **Fixture suite PASS (included in 52/52); phase remains pending** for runtime integration and owner handover |
| Phase 3 — Desktop MVP | Packaged Tauri shell; tray/window/widget behavior and UI smoke | Pending |
| Phase 4 — Observability | Quota history, token attribution and price-policy tests with exact/estimated/unavailable distinctions | Pending |
| Phase 5 — Performance | Instrumented client timings with labels that distinguish visible end-to-end timing from unavailable model timing | Pending |
| Phase 6 — Scheduler | Queue, concurrency, retry and reserve policy tests | Pending |
| Phase 7 — Widget | Tray/widget and privacy-mode checks | Pending |
| Phase 8 — Reliability | Restart, network failure, version mismatch, duplication, manual state changes, multiple tasks, database recovery | Pending |
| Phase 9 — Natural quota cycle | Completed record in `E2E-NATURAL-QUOTA-CYCLE.md` from a real naturally reset window | **NOT OBSERVED** |
| Phase 10 — Open-source release | Security gate, secret review, package hashes, installer and release verification | Pending |

Never promote mocked fixtures, synthetic quota responses, or unit tests into natural-cycle evidence. Keep live smoke-test evidence separate from unit and integration results.
