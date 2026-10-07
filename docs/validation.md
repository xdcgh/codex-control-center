# Validation record and phase boundaries

Updated 2026-10-07. This page separates baseline evidence, research, simulations and live natural-cycle acceptance. A result in one category does not imply the others passed.

## Phase 0 — Baseline

| Check | Result | Scope and limits |
| --- | --- | --- |
| Legacy Node unit suite | **PASS: 25/25; 0 failed** | Isolated unit tests from the imported watchdog; no live model request. |
| Full repository `npm test` suite | **PASS: 52/52; 0 failed** | Verified against Core v2 source commit `0288b89`, before later Observability and named-pipe broker additions. Includes baseline/Core v2 fixtures and black-box tests with simulated adapters and temporary SQLite. No real Codex turn was started. |
| Legacy repository state | **Saved** | Legacy source baseline commit `56175194b7c4896c64636d161ecab4d0457beacc`, tag `legacy-watchdog-baseline-2026-10-07`. The original runtime daemon was not stopped or modified. |
| New repository migration baseline | **Saved** | Initial import commit `e115cae` and tag `legacy-import-baseline-2026-10-07`. |
| Existing Desktop smoke scripts | **Inspected, not run** | They create owned test Threads/Goals, navigate Desktop, send model turns and write receipts. Their side effects were excluded from Phase 0 read-only validation. |
| Natural quota cycle | **INCOMPLETE** | A real Core v2 reset and resume acknowledgement were observed, but the automatic event hook was missing and the original Goal/turn was still running. No completed natural-cycle pass is claimed. See [acceptance record](../E2E-NATURAL-QUOTA-CYCLE.md). |

### Legacy natural-event observation (not Core v2 acceptance)

On 2026-10-07, the legacy watchdog recorded a Goal in `waitingQuota` at `02:51:39.149Z` with the 5-hour reset timestamp `1791343173` (`11:19:33 +08:00`). The legacy watchdog reported a continuation accepted at `03:21:44.163Z`. Record classification: **LEGACY / INCOMPLETE for Core v2**. This is operational evidence from the old daemon, not evidence for the new 10-second detector, scheduler, or Core v2 persistence. It must not be copied into the Core v2 natural-cycle acceptance as a pass.

### Core v2 natural-event observation

On 2026-10-07, a real reset was reported at `16:29:37.000 +08:00`; the Core v2 detector recorded all windows ready at `16:29:37.553` and accepted one continuation at `16:29:42.137`. Classification: **INCOMPLETE** because the automatic event hook was missing and the original Goal/turn was still running when this report was made. The 553 ms detection and 5.137 s acknowledgement intervals are partial observations only; they do not satisfy completion, event-history, or restart-persistence acceptance.

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

Source identity: Observability implementation commit `276e4bf`; the fingerprints below bind this test record to the tested modules and policy snapshot. SHA-256 fingerprints:

| File | SHA-256 |
| --- | --- |
| `src/observability/index.mjs` | `C0304F07C6994E3D8B3AB40C3E663E5BA971D56B48B3074C13A1D95F59C1A0E7` |
| `src/observability/session-log-adapter.mjs` | `40C68B6852ED9168C607C9AAE639DC36BEAA996DC6A49DAC011D77AD19FDC8A7` |
| `src/observability/pricing.mjs` | `06A54804CAC57AEE3B901AC2DF6507E1D4DE94481A5E282E2971B0662FB0A625` |
| `pricing.json` | `5E71029349A2EAA4D69E22E5A1B57B5712ABA556DE29743D631DC3C588E38161` |
| `test/acceptance-observability.test.mjs` | `A8D972F1FCFC2DD25E8E7F8A20401D38E3168EA7854994A71205228EF51CC737` |

### Local broker targeted acceptance

Targeted black-box acceptance: **PASS 6/6** via `node --test test/acceptance-broker.test.mjs` with the temporary `CODEX_CONTROL_CENTER_NATIVE_TEST_HELPER` environment override. Five cases exercised the Node mock broker; one case spawned the production Rust helper in `--pipe-broker-helper` mode with a mock route. No Core process or Codex turn was started. On Windows, the temporary broker directory and descriptor DACLs were read and confirmed to include the current user SID and SYSTEM while excluding Everyone and Built-in Users. The descriptor intentionally contains the random authentication token for the authorized UI; tests verify it is not echoed in RPC responses.

The native helper test covered local authentication, response correlation, per-line bounds, and the eight-client cap. The source statically sets `first_pipe_instance(true)` and `reject_remote_clients(true)`. No remote-client attempt was made, so OS-level remote rejection is supported by source inspection rather than a live remote test. A full `npm test` run was not repeated while CI was validating the release candidate.

Source identity: repository base commit `b4e9fe0` plus the uncommitted broker/desktop working tree at test time. The separate debug helper binary was built outside the repository. SHA-256 fingerprints:

| File | SHA-256 |
| --- | --- |
| `src/core/broker.mjs` | `0B37FCB596B031D6C37B2824D8C6AB31D974CBD22BCDE5AD30679FAF351E158E` |
| `src/core/router.mjs` | `8604F40ED3FBCB0ED0818213165F4EAA7173394B931964452EB0CE30F3CF9012` |
| `src/adapters/codex.mjs` | `31D1815B52107ACDDA13ACFFC1581C5D9181B051AFCE97A0654D30C99FC9587F` |
| `src/store.mjs` | `4BDF2575B3741D9443FFF49E215B126EC822F42573FD41598D02238099834B5E` |
| `src/core-cli.mjs` | `C2F0C484ED17FA32E466D7A9A5C5ADAD8D7B6D0DFDFBDF3651CBE92C340098DA` |
| `src-tauri/src/pipe_helper.rs` | `0DBFDF0BEEA1EA7870AC89C7EF602CEF2FB8315876B1CA3B5E97551F351E7CE7` |
| `src-tauri/src/config_binding.rs` | `9A847E8004D5B42035A0D19570727FDC6724A8727CC4B81C631B2989341C440A` |
| `src-tauri/src/main.rs` | `A1F5A7B0DD49787C3D9F6FEE801E2ECA3203E96934043634A0539DCA63F5AA51` |
| Debug helper executable | `9D1DDFB9B1E003FC4A89494F9B656CD10951E0D022C118681350A7E496472DA7` |
| `test/acceptance-broker.test.mjs` | `CAB50F43ADFD6E6C3EECA7B92E1ED1477319F381299BC2C742207671D2B6A057` |

### Core profile and Resume now targeted acceptance

Targeted Core black-box checks: **PASS 12/12** via selected test-name filters in `test/acceptance-core.test.mjs`. Coverage includes concurrent manual Resume now sharing a max-one slot, one-shot `NeverAuto` preservation and quota/user/compatibility gates, loading/not-loaded Desktop snapshots preserving the quota-wait incident, and a two-ACK retry cap after each resumed turn fails again. The binding-loss check used the debug helper's `--probe-config-binding` mode against a synthetic temporary profile and confirmed that a missing binding plus an established-binding sentinel, stale owner marker, or existing state database fails closed without creating replacement config/state. The owner fixture has an explicit current-SID owner and tests that changing LOCALAPPDATA/TEMP keeps the same USERPROFILE anchor; a reparse/junction anchor is rejected. No GUI, Core sidecar, Codex process, or real user profile was started or read. This is targeted evidence only, not a full-suite rerun after current source changes.

Source identity: repository base commit `b1d2850` plus the current uncommitted Core/profile/test working tree. SHA-256 fingerprints:

| File | SHA-256 |
| --- | --- |
| `src/core/control-center.mjs` | `616229315E713F379A6A4ABAF498699EC12E9684D2BA3FE8CB02A3681AE827B2` |
| `src/core/ownership.mjs` | `ACF432AFBD1C40C2B758B74E2F621D77716BD93B9D2217808955DE08D44DAC03` |
| `src/adapters/codex.mjs` | `31D1815B52107ACDDA13ACFFC1581C5D9181B051AFCE97A0654D30C99FC9587F` |
| `src/core-cli.mjs` | `0A335D4AA1B6FE841C84548B273DB0A4FC66C0D6EFADA9CD3392E0807556B4EF` |
| `src-tauri/src/config_binding.rs` | `9A847E8004D5B42035A0D19570727FDC6724A8727CC4B81C631B2989341C440A` |
| `src-tauri/src/main.rs` | `84501EB0B1CF6BFDF1FE9F30DAF2E44E9DB8E744601DD8B14FE93EA3DEAF4E13` |
| `src/engine.mjs` | `77BCC7222A88A2F6E37D09585757A403A2CBC95F5ECDCD1F509521AA0F629F5D` |
| `test/acceptance-core.test.mjs` | `1798E11202DC4DDAC8BA65F319EEE8028CC774E10440B8B0D53159B23DBFECC3` |
| Debug helper executable | `214C3195483857137A4E1DDD817DBB6C3299D23A07515FCC922F98E0B0971B42` |

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
| Phase 2 — Core v2 | Deterministic parser/state/scheduler tests; app-server integration with explicit authorization; durable-state restart tests; no duplicate dispatch | **Fixture suite PASS (52/52 at `0288b89`); phase remains pending** for runtime integration and owner handover |
| Phase 3 — Desktop MVP | Packaged Tauri shell; tray/window/widget behavior and UI smoke | Pending |
| Phase 4 — Observability | Quota history, token attribution and price-policy tests with exact/estimated/unavailable distinctions | Pending |
| Phase 5 — Performance | Instrumented client timings with labels that distinguish visible end-to-end timing from unavailable model timing | Pending |
| Phase 6 — Scheduler | Queue, concurrency, retry and reserve policy tests | Pending |
| Phase 7 — Widget | Tray/widget and privacy-mode checks | Pending |
| Phase 8 — Reliability | Restart, network failure, version mismatch, duplication, manual state changes, multiple tasks, database recovery | Pending |
| Phase 9 — Natural quota cycle | Completed record in `E2E-NATURAL-QUOTA-CYCLE.md` from a real naturally reset window | **INCOMPLETE** |
| Phase 10 — Open-source release | Security gate, secret review, package hashes, installer and release verification | Pending |

Never promote mocked fixtures, synthetic quota responses, or unit tests into natural-cycle evidence. Keep live smoke-test evidence separate from unit and integration results.
