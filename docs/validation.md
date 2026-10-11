# Validation record and phase boundaries

Updated 2026-10-11. Historical sections retain their observation dates. This page separates baseline evidence, research, simulations and live natural-cycle acceptance. A result in one category does not imply the others passed. Physical Windows reboot/startup restoration is explicitly deferred to the next version by the user; it is not an outstanding gate for this version.

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

Targeted black-box acceptance: **PASS 8/8** (`test/acceptance-observability.test.mjs`) and implementation tests **PASS 17/17** (`test/observability.test.mjs`); combined **25/25**, 0 failed, 0 skipped. Tests use synthetic JSONL and temporary SQLite only. No actual Codex session data was read.

Counter semantics were rechecked after the legacy baseline failure: initial, reset, and out-of-order cumulative snapshots go to a non-additive inventory with token totals and price unavailable. In the restart/archive fixture, only ordered within-epoch changes count as deltas: 500 input tokens before reset plus 40 after reset (540 total); a late pre-reset snapshot does not rewind the new baseline. A legacy row still carrying `scope=cumulative-delta` but marked `initialCounter=true` remains byte-for-byte unchanged in storage and is summarized as unpriced inventory. Actual response-ID records are kept in their own ledger, deduplicated for the same known provider/response ID across a fork, and never combined with counter deltas or inventory.

Scope limit: these checks validate per-observed-file counter provenance and ledger separation. They do **not** prove globally complete account consumption or resolve root/fork/inherited-history overlap; `globalConsumptionStatus` remains Unavailable. Do not add response, counter-delta, inventory, or latest-snapshot ledgers together.

Source identity: base commit `3b0c6ed` plus the uncommitted observability implementation/test working tree at verification time. The following fingerprints bind this result to the tested source snapshot:

| File | SHA-256 |
| --- | --- |
| `src/observability/index.mjs` | `3BF2A3CAF0A3BB7D7C58E4312CF0740D5ED30D0DF83BEEDA9447CB4286624411` |
| `src/observability/session-log-adapter.mjs` | `04B7681C76E74EC8AC65548E2B39C36CCB8158F11DC80F09A07C3BD63D5BB977` |
| `src/observability/pricing.mjs` | `C1F0CAB88C8D7362DB4AF01A71B9C81FAA922258716491B83E91D688900C0602` |
| `pricing.json` | `5E71029349A2EAA4D69E22E5A1B57B5712ABA556DE29743D631DC3C588E38161` |
| `test/acceptance-observability.test.mjs` | `864CE486515567B3A3601B750C183A1473A11DE509D160ED627CEC5A8B9FFB63` |

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
| Phase 2 — Core v2 | Deterministic parser/state/scheduler tests; app-server integration with explicit authorization; durable-state restart tests; no duplicate dispatch | Historical fixture suite passed 52/52 at `0288b89`; current source suite passes 160/160, the read-only Doctor passed all six checks, and the single installed Core owner was confirmed. Natural Goal terminal completion remains Phase 9. |
| Phase 3 — Desktop MVP | Packaged Tauri shell; tray/window/widget behavior and UI smoke | Tauri app is installed and running; Normal/Goal one-turn smokes passed. Installed Dashboard, Settings/About, all five Quota ranges, Pricing, DatabaseRecovery layout, Chinese Performance, loaded Token page and expanded ThreadDetails were visually inspected. Main/widget language switching and GUI-only preference persistence passed. Compact tray click and localized tray menu/tooltip were observed at recorded checkpoints; action-by-action menu behavior and visible toast popup remain unverified. Physical reboot/autostart/widget restoration is deferred to the next version. |
| Phase 4 — Observability | Quota history, token attribution and price-policy tests with exact/estimated/unavailable distinctions | Targeted tests **25/25 PASS**; five installed Quota ranges and the loaded Token page were inspected. Eleven model groups across response/delta/inventory ledgers displayed Partial/Unavailable quality. Global inherited/fork/account totals remain unavailable and are not inferred. |
| Phase 5 — Performance | Instrumented client timings with labels that distinguish visible end-to-end timing from unavailable model timing | Observed turn-performance view passed source tests and installed Chinese-page inspection. Exact model TTFT/decode/model-waiting remain unavailable by protocol. |
| Phase 6 — Scheduler | Queue, concurrency, retry and reserve policy tests | Pending |
| Phase 7 — Widget | Tray/widget and privacy-mode checks | Main/widget language synchronization and privacy mode were visually checked. Tray left-click/compact and bilingual context-menu/tooltip were observed at the recorded checkpoints. Visible toast popup presentation remains unverified. |
| Phase 8 — Reliability | Restart, network failure, version mismatch, duplication, manual state changes, multiple tasks, database recovery | Pending |
| Phase 9 — Natural quota cycle | Completed record in `E2E-NATURAL-QUOTA-CYCLE.md` from a real naturally reset window | **INCOMPLETE** |
| Phase 10 — Open-source release | Security gate, secret review, package hashes, installer and release verification | The `f81886b` bilingual candidate is installed and passes strict installer/portable/ZIP payload checks. Current Core-validation/publication-security and Windows package CI both pass. Root updated and verified the private prerelease draft with exactly three `f81886b` assets. Remaining product evidence is the natural Goal terminal outcome and visible toast popup; formal stable release publication remains. Physical Windows reboot is deferred to the next version. |

Never promote mocked fixtures, synthetic quota responses, or unit tests into natural-cycle evidence. Keep live smoke-test evidence separate from unit and integration results.

### Desktop real-turn smoke — 2026-10-07

**REAL_DESKTOP_SMOKE: PASS for one normal turn and one Goal turn; two model calls total.** Both used the live model catalog's `gpt-6-luna` at `low`, sent once over Desktop IPC to newly created owned fixtures, and completed with their distinct fixed markers and matching client message IDs. Goal identity, budget, and usage counters were preserved during restoration and the Goal completed. Its trigger was deliberately set to `usageLimited` in the fixture before restoration: classify this as **SIMULATED_TRIGGER**, never as a natural quota-cycle pass.

Both fixture rows were observed as `thread_source=agent`; each was absent from the Core candidate list and eligibility check, and neither appeared in Core thread records, policies, intents, or events (**2/2 isolated**). Detailed receipts remain in private temporary diagnostics; no IDs, prompts, account values, or user-thread content are included here. Existing Codex backend/Core processes remained running, and no existing user thread or Goal was changed.

**Cleanup compatibility issue:** the two completed test fixtures remain unarchived. `thread/archive` returned JSON-RPC `-32600`, and the Desktop archive broadcast did not mark the catalog rows archived. This is a known issue for future Desktop/AppServer compatibility work. Do not stop/restart the owner or edit the Codex database to force cleanup. This smoke is not evidence of natural quota recovery or a complete product acceptance.

### Extracted installer payload comparison — 2026-10-08

Root installed the staged unsigned NSIS package into a new task-owned directory (installer exit code 0). The strengthened read-only `scripts/verify-installed-payload.mjs` was then run against that extracted directory and portable. Payload equality still passes for 37 non-main-executable files; the main executable has exactly the expected one-marker Tauri NSS/UNK difference and its normalized hash matches. The pinned Node v24.21.0 hash matches an independent official digest as well as both manifests; license/notice files and the four expected older-build PowerShell helpers are present.

**This older staged package failed the strengthened release gate:** it had four PowerShell scripts instead of the five then required, and ASCII/UTF-16LE scans found private absolute-path strings in two packaged executable files (644 marker occurrences total). No path text is reproduced here. Installer SHA-256: `3658fe49d349476e92263b32abe409a6be7c0715961d8b5192acbc1d8a7b5f78`; portable ZIP SHA-256: `5639a4badf20df817fb7e24e93841ce390a18d4fa14765820a9ddab4ac60511b`. These hashes identify a superseded build and must not be used as release artifacts.

No model turns were used for this historical comparison. The superseding remapped package passed the strict checks recorded below on 2026-10-08, and the bilingual `44274f3` package passed fresh installed/portable, marker and private-path checks in the 2026-10-11 section. Physical Windows reboot remains a separate acceptance item deferred to the next version.

### Remapped v0.1.0 artifact checkpoint — 2026-10-08 (superseded)

Root rebuilt through the source-path remapping wrapper, installed the final unsigned NSIS package to the new task-owned install directory (exit code 0, 42 files including the uninstaller), and extracted the portable ZIP into a new ignored verification directory. The ZIP extraction and loose portable directory each contained 44 files with **44/44 relative names and bytes identical**, including an exact raw executable match.

The strict installed-payload checker passed against both loose portable and actual ZIP extraction: **41/41** payload files per side, 40 non-main-executable payload files exact, and only the same-length Tauri NSIS/portable build marker differs in the main executable. One expected marker was present in each binary and no counterpart marker was present; normalizing only that marker produced the matching SHA-256 `2a6e8f1d83e44aeac8ae2bd6c9de71031f93b49a2132d260f43e4cfb8b4dd80b`. Node v24.21.0 matched the independent official SHA-256 `ba4e6d110e8c1592a1ecd390f6b05f3da124b13871a5be62b341a07a853c6c32`; the five expected PowerShell scripts and license/notice texts were present. Bounded ASCII/UTF-16LE payload scanning found **0** private absolute-path matches. The independent publication scanner passed for **130** files across the install, portable, and ZIP-extracted trees.

Final installer SHA-256: `4ac42366cea51c0e68569fbf47b4bf6a8521b1b47386c4a46d101ebce985ec47`; portable ZIP SHA-256: `da196f434961b4f881d5fe6feece7aee072394cc0248e7e97b37e3a51069d6ba`. Root performed the installation and launch; this audit only read package contents. No model calls or owner restarts were made. Physical Windows reboot persistence was not tested and is explicitly deferred to the next version by the user.

### Maintenance and pricing interface targeted acceptance — 2026-10-08

`test/acceptance-maintenance.test.mjs` (**6/6**), `test/acceptance-statistics.test.mjs` (**2/2**), and `test/observability.test.mjs` (**23/23**) passed together (**31/31**, 0 skipped). All storage/recovery/statistics fixtures use isolated temporary SQLite/session logs and synthetic profile/owner paths; the pricing route test uses a temporary Observability Worker database and never calls the official pricing endpoint.

Coverage includes v1→v2 migration with a pre-migration SQLite snapshot and preserved thread/intent/legacy aggregate state; schema-newer and corrupt-file fail-closed preservation; offline-proof, synthetic global lease exclusivity, and current-PID database-owner rejection through `recoverOffline`; explicit confirmed restore preserving the damaged database and sidecars while setting automatic recovery off/review required; Doctor-gated review acknowledgement does not turn automatic recovery back on; Core settings, thread-policy and manual Resume are blocked before quota/turn send until acknowledgement; 180-day daily aggregation with 30-day raw retention, reset-group min/mean/max/count, chart point labels, replay idempotence and reopen; and routed confirmed pricing override/history persistence across an Observability Worker restart. These checks use only temporary synthetic state; Root has not applied database recovery to a live profile, and the UI does not yet provide a recovery-review screen.

`test/acceptance-statistics.test.mjs` separately exercises public observability summaries: observed request records do not imply a complete request total when provider coverage is missing; turn distributions, context windows, context-long and tier counts stay scoped to their appropriate ledger; and model/tier performance groups report observed turn timing while exact TTFT/decode/model-waiting remain unavailable.

The statistics fixture also separates same-model response/delta/inventory/latest ledgers, proves an unknown-provider response leaves `requestCount` unavailable while reporting a known-provider subset, distinguishes actual long requests from configured context capacity, preserves mode-only metadata without collaboration instructions, and keeps identical model/tier performance rows separate across providers.

## 2026-10-11 — 44274f3 compatibility and initial localization checkpoint (superseded package)

The read-only current Codex probe passed all six Doctor checks: protocol, quota, model catalog, Thread read, Goal read and dry-run resume. No turn was sent, and no Goal, database or running Codex process was changed. The active CLI reported `0.162.0-alpha.2`; the installed package is `26.1002.7124.0`, while its inspected ASAR reports app version `26.1002.52244`. The current compatibility source accepted this observed runtime. The observed quota payload had no five-hour value; no dynamic percentage is published here. The older pinned compatibility-version constants remain unchanged; this live result applies only to the inspected runtime on this date.

`test/acceptance-i18n.test.mjs` passes **4/4**. It covers system-language normalization (`zh-*` to Simplified Chinese, other tags such as `en-GB` to English), manual locale override, non-empty catalog translations and matching placeholders, quality text, formatting, and preservation of unknown IDs/codes. `test/ui-rendering.test.mjs` passes **2/2** with the actual `i18n-core` and React wrapper compiled into its isolated temporary module graph; both production comparison components were rendered in English and Simplified Chinese. Their empty metric/quality states localized correctly, and provider/model IDs and unknown tier keys remained intact. SSR proves component output under each locale; it does not prove the installed Tauri window.

The native Rust suite passed **9/9**, including Windows' real UI-language API probe, locale normalization/override, unchanged unknown identifiers and translated notification title/body coverage. The observed Windows UI language was `zh-CN`. The UI production build passed after adding the real locale modules. Source persists `language` as `auto`/`zh-CN`/`en`, returns the system and resolved locale as derived metadata, broadcasts preference updates across windows, and refreshes tray labels and tooltips; each toast reads the latest preference when shown. Settings offers a user-triggered test-notification action marked TEST without changing quota/recovery state. It submitted in both languages but no popup was visually confirmed. The earlier **146/146** suite result at `7f4f931` predates this work; the latest source and fresh Debug suites each pass **160/160** at HEAD `44274f3`.

GitHub Actions verified this checkpoint. [Core validation run 38099490643](https://github.com/xdcgh/codex-control-center/actions/runs/38099490643) at `44274f3` completed the Ubuntu tests, Windows tests and publication-security job successfully. [Windows package run 38099490646](https://github.com/xdcgh/codex-control-center/actions/runs/38099490646) at the same commit successfully built the native test app, validated the production helper/Core, built the NSIS installer, assembled the portable package/checksums and uploaded the artifact.

### Initial installed bilingual candidate acceptance — 2026-10-11 (`44274f3`, superseded)

The bilingual v0.1.0 candidate was prepared with pinned Node `v24.21.0`, installed with the unsigned NSIS package to the approved task-owned install directory, and launched with `--enable-autostart`. The NSIS installer and main executable have Authenticode status `NotSigned`; the portable ZIP is integrity-checked by its SHA-256, not Authenticode. Installer SHA-256: `1df4749365c0758f6e13f4c5631a611da3f5b6b18419efdf512e1e41bd3fc429`; portable ZIP SHA-256: `38eb977613cff84dffe983ea231135f21dca1be685c7d6ecc739f19e42c251f9`.

The strict installed-versus-loose-portable comparison and installed-versus-ZIP-extraction comparison each passed with 42/42 payload files, 41 non-main-executable files byte-identical, one expected NSS/UNK marker difference in the main executable, matching normalized executable hashes, and **0** private absolute-path matches. The user's existing runtime state was backed up before install and its 5-file inventory/hash comparison passed. Raw receipts and backup remain under ignored `runtime/`.

With the Windows UI language set to `zh-CN`, the installed preference initially read `auto`; the Chinese Settings and Dashboard were visually accepted with privacy mode on. Root selected English, Chinese and `auto` through UI Automation. Both the main window and topmost widget updated together. The explicit English preference survived a GUI-only exit/relaunch and the reopened English Dashboard was visually accepted while the background Core remained the same. The preference was then returned to `auto`; the Chinese Dashboard and Chinese Performance page were visually accepted. Performance displayed 1,376 observed turns without a blank page, and dynamic model/provider IDs remained intact. All five installed Quota ranges rendered axes, line and reset markers. The real quota source had no 5-hour value, which stayed unavailable; no zero was substituted. The Pricing page displayed the official snapshot/table/threshold/source and subscription distinction. Diagnostics showed schema 2 with `requiresReview=false` and disabled recovery controls; no recovery action was invoked. Token Analytics loaded 11 model groups across response, cumulative-delta and inventory ledgers, with Partial/Unavailable quality; a read-only summary agreed on the group and ledger counts, and no ledgers were added together. ThreadDetails expanded and showed the observed fields without blanking while private identifiers remained masked; no policy/resume action was invoked. The reviewed safe Dashboard captures are [`dashboard-zh-CN.png`](screenshots/dashboard-zh-CN.png) and [`dashboard-en.png`](screenshots/dashboard-en.png).

The Settings test-notification action was invoked in English and Chinese and returned successful submission to Windows. Read-only Windows ToastHistory verification found both generic TEST notifications stored with the setting enabled. No toast popup was visually observed, so this does not prove foreground popup appearance or event-specific notification behavior. The initial UI Automation attempt could not locate the tray icon; later checks at the same packaged checkpoint verified the bilingual tray menu and tooltip. The final language preference is `auto` on the `zh-CN` system locale.

At the initial installed `44274f3` checkpoint, task reason `running`, Token ledger label `Counter inventory (unknown attribution)`, and some ThreadDetails collaboration/runtime enums were untranslated. Those source fixes were subsequently visually accepted at the installed `f0cd45f` checkpoint; the About-only `f81886b` change did not modify them.

The latest read-only natural-cycle report contains five cycles: four have a recorded resume timestamp, one does not, and all five Goal outcomes remain `PENDING`. Its aggregate status is `FAIL` because the historical set includes failed episodes; that aggregate does not prove the original active Goal reached terminal completion. An earlier report contained three correlated recovery episodes and a separate `UNOBSERVED` cycle; those counts are historical and are superseded by the later five-cycle report. The natural-cycle requirement remains **INCOMPLETE**. No Goal was changed by these reads. A private v0.1.0 prerelease draft exists; no public stable release or full original-scope completion is claimed. Physical Windows reboot/startup restoration remains deferred to the next version by the user.

### f0cd45f localized package acceptance — 2026-10-11

Commit `f0cd45f` adds field-scoped Chinese labels for known task/Goal/collaboration/runtime values and Token inventory placeholders, bringing the catalog to **458 keys**. The full Windows Node suite passed **163/163 with zero skips** using the existing Debug native helper; the language/component subset passed **9/9** and preserves unknown provider/model/tier/runtime identifiers. UI production build passed after the compact CSS fix. [Core validation/publication security run 38101589186](https://github.com/xdcgh/codex-control-center/actions/runs/38101589186) and [Windows package run 38101589205](https://github.com/xdcgh/codex-control-center/actions/runs/38101589205) both succeeded at `f0cd45f`.

The installed f0cd45f NSIS candidate and portable ZIP are unsigned in Authenticode terms (NSIS/main executable `NotSigned`; ZIP checked by SHA-256). Actual installed-versus-loose-portable and installed-versus-ZIP checks each passed with 42/42 payload files, 41 non-main files byte-identical, only the expected NSS/UNK main-executable marker difference, matching normalized hashes, Node v24.21.0 official digest, full license files, five PowerShell helpers and zero private absolute-path matches. Installer SHA-256: `9554e160b2445829cc807eb40b0653cacaecf1605ef63fd365fd42bf5be36abc`; portable ZIP SHA-256: `943924b73a6489f23dad4ae93f9e6f975094c474c1ed70971b6088ab787ca0d4`. At that checkpoint the remote private draft contained the earlier 44274f3 assets; the f0cd45f files remained local. The later f81886b draft refresh is recorded below.

Root installed and visually checked the f0cd45f app with privacy mode on, default `auto` Chinese selection and preserved single-Core ownership. The localized task reason, Token ledger label and ThreadDetails enum values now render in Chinese. ThreadDetails shows the active Goal details without exposing IDs; no policy/resume action was invoked. Token Analytics loads 11 groups across response, cumulative-delta and inventory ledgers with Partial/Unavailable quality and does not combine them. All five Quota ranges show expected axes/line/reset markers; the 5h source value remains unavailable, not zero, and the live store has no daily aggregate (older daily-mean presentation remains fixture-only). DatabaseRecovery layout showed schema 2/review not required with recovery controls disabled; no backup/restore action was invoked.

The f0cd45f tray left-click opened the compact topmost window. Its 5h row stayed on one line; one scroll exposed the weekly reset and Token speed, so those values are not claimed to be simultaneously visible. The Chinese/English 13-item context menu and localized tooltip were visually reviewed on the preceding 44274f3 install; no menu action was invoked. Windows ToastHistory stores enabled generic TEST notifications in English and Chinese, but no foreground popup was visually observed. The final preference is `auto`; the Core and original Codex Desktop stayed active. The original natural quota Goal remains **INCOMPLETE**. The separate user-requested About developer credit naming `developercreditxudc2` and Codex is not included in f0cd45f and will have its own source/build verification. Physical Windows reboot remains deferred to the next version.

### Credited package acceptance — `f81886b` (2026-10-11)

Commit `f81886b` adds the requested About credit and two localized strings for a 460-key English/Simplified Chinese catalog. The installed 0.1.0 About panel was visually verified in both locales: “由 xudc2 与 Codex 开发” and “Developed by xudc2 and Codex”. Task reason, Token inventory and ThreadDetails enum screenshots were reviewed at the `f0cd45f` install; their code was unchanged by the About-only `f81886b` patch and they were not separately recaptured at f818. This wording does not change license ownership or digital certificate claims.

The local full Node suite result is **163/163 with zero skips at parent `f0cd45f`**. Separately, the `f81886b` Windows package CI log reports production helper/Core validation **163 passed, 0 failed, 0 skipped**, using a fresh Debug helper. The targeted language/component checks and UI build passed; native **9/9** is from the prior native checkpoint and was not rerun for this About-only change. Both current CI workflows succeeded: [Core validation/publication security run 38102339382](https://github.com/xdcgh/codex-control-center/actions/runs/38102339382) and [Windows package run 38102339376](https://github.com/xdcgh/codex-control-center/actions/runs/38102339376).

The NSIS installer and main executable are Authenticode `NotSigned`; the ZIP is checked by SHA-256, not Authenticode. Actual installed-vs-loose-portable and installed-vs-ZIP checks each passed with **42/42** payload files, 41 non-main files byte-identical, only the expected NSS/UNK main-executable marker difference, matching normalized executable hashes, Node v24.21.0 official digest, manifest, full license files, five PowerShell helpers and **0** private absolute-path matches. The publication path scan over the actual installed and ZIP-extracted payloads passed **88 files, 0 findings**. Installer SHA-256: `fcceb2565885c972c665d565cb13edea953312e000a94d05e5123a622e022f88`; portable ZIP SHA-256: `ae6f273921a9050f1e3a03106934e3673551f25e426bb052865e57740d6c2d25`. `SHA256SUMS.txt` lists exactly those two downloadable assets. Root updated the private prerelease draft to `f81886b` and verified exactly three matching assets. SHA256SUMS file SHA-256: `a7143243ef741eaf6c0ac674572a8401f7c5475da57567dc68ccabbafb17b279`. This is not a public stable release or a claim of full original-scope completion.

The Settings TEST action was submitted in English and Chinese, and ToastHistory recorded enabled generic TEST notifications, but no popup was visually observed. The localized tray context menu and tooltip were visually reviewed at the preceding `44274f3` install; the compact click was observed at `f0cd45f`. The original natural quota Goal remains **INCOMPLETE**. Physical Windows reboot/startup restoration is deferred to the next version by user direction.

Root later invoked four navigation actions from the installed tray menu (Dashboard, Threads, Widget and Diagnostics), reviewed private captures, and restored the prior language preference and single-owner state. Pause/resume, notification toggles, autostart and exit actions were not invoked by this check.

### Diagnostics and account-activity source checkpoint — based on `21016bc` (not packaged or installed)

The source-only follow-up adds a fixed-field read-only diagnostics inventory/export, explicit source timestamps/freshness/coverage, a manual `account/usage/read` view, safe current-Goal counter projection and future-only repository grouping. It is not packaged or installed; do not count its UI as Windows installed acceptance. The complete Windows `npm test` passed **185/185, 0 failures, 0 skips** with the specified protected Debug helper; the UI build passed. The native Cargo suite was not rerun. A private ignored receipt records test/helper hashes and the validation scope.

The black-box source tests cover strict read-only parameter validation, fixed-field redaction, no automatic account query from Diagnostics, preserved source timestamps, stale/future/unavailable freshness, coverage counts that do not add ledgers, same-scope concurrent request merging and 60-second cache behavior. A separate in-memory router check verified that an unavailable account read remains unobserved in Diagnostics and a later read succeeds after the cache interval. Goal projection preserves all recognized statuses and separates a missing budget, explicit null budget, and reported zero; it never returns the objective. Repository labels enrich only subsequent exact-turn token records; historical records remain Unavailable and the diagnostics export excludes repository names. Privacy-mode render tests hide repository keys while leaving provider/model/tier identifiers unchanged.

Root's separate read-only current-runtime probe passed all six Doctor checks, returned the five documented account summary fields and daily activity buckets spanning 262 days, and reported optional `threadUsage` as null. A read-only Goal counter-source probe also succeeded. No private token values, account identity, Goal/Thread identifiers, PIDs, model turn or Goal mutation are included in this report. Account activity stays a separate official source and is not added to local response/counter/inventory ledgers; raw `speed` is not treated as a confirmed served service tier. These checks do not prove a complete local/global token total or the original natural Goal terminal outcome.

### Windows owner-anchor CI timeout correction — 2026-10-08

The Windows CI run at checkpoint `07c501e` failed only while preparing a synthetic profile owner ACL fixture: its PowerShell cold-start timeout was 8 seconds. The test timeout is now 30 seconds; the SID/ACL assertions and fail-closed checks are unchanged. The Core's production owner identity, ACL, and PID-liveness PowerShell checks use bounded 20-second timeouts and retain all identity/ownership checks. The focused owner-anchor test passes **1/1** after this adjustment; the full CI rerun is still the release authority.
