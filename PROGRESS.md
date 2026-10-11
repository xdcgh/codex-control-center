# Progress

Updated: 2026-10-11 (Asia/Shanghai). Source checkpoints, fixtures, installed-app probes and complete natural cycles are separate evidence claims. The user deferred physical Windows-reboot acceptance to the next version and added Chinese/English language support to this version.

## Evidence

| Check | Result | Scope |
| --- | --- | --- |
| Legacy unit suite | PASS: 25/25 | Baseline isolated tests, no live model request |
| Legacy running state | Monitoring enabled; one watched task, three inactive records | Private runtime snapshot; no task content published |
| Legacy rollback | Commit and annotated tag saved | Local workspace baseline |
| New repository | Independent import with sanitized documentation | No earlier commits existed to preserve |
| Community research | COMPLETE: all eleven requested repositories inspected | Pinned HEADs, actual licenses, official protocol/framework sources in `docs/research.md` |
| Stack decision | Tauri 2 + Rust + React/TypeScript + existing Node sidecar | ADR accepted; no measured memory claim |
| Publication surface scan | PASS on `44274f3`: Gitleaks history/working-file security workflow and installed/portable absolute-path scans (0 matches) | [Core validation + publication security](https://github.com/xdcgh/codex-control-center/actions/runs/38099490643); strict package comparison recorded below; scan again after later changes |
| Remote CI | PASS on `44274f3`: Windows/Linux tests and publication security | [Core validation](https://github.com/xdcgh/codex-control-center/actions/runs/38099490643): Ubuntu and Windows tests plus publication-security job succeeded |
| Core v2 headless suite | PASS: 160/160, no skips, at the bilingual/compatibility checkpoint | Temporary SQLite/worker/native-helper acceptance; fixture adapters remain simulated |
| Native locale/notification tests | PASS: 9/9 | System locale, overrides, eight translated events, transition deduplication, per-cycle completion and explicit TEST notification |
| Chinese / English interface | PASS for installed main/widget switching and GUI-only preference persistence: default auto Chinese, English/Chinese/auto selections, immediate widget update, English retained on relaunch | One Core retained; final preference restored to auto. Settings TEST notifications in both languages are stored in Windows ToastHistory; popup visibility and actual event-triggered notification presentation remain unverified. Current installed build has untranslated `running`, `Counter inventory (unknown attribution)`, and some collaboration/runtime enum values; source fix is in progress and not yet installed |
| Installed data pages | PASS: Dashboard, all Quota ranges, Pricing, DatabaseRecovery layout, Chinese Performance, Token page and expanded ThreadDetails | Quota axes/lines/reset markers render in all five ranges; 5h remains unavailable rather than zero. No live daily aggregates were present; older daily-mean presentation remains fixture-only. Token shows 11 model groups across response, delta and inventory ledgers with Partial/Unavailable quality; totals are not combined. ThreadDetails fields render without blanking and privacy masks IDs. DatabaseRecovery showed schema 2/review not required with actions disabled; no recovery action was invoked |
| Current Codex compatibility | PASS: six read-only Doctor checks on CLI 0.162.0-alpha.2 / Desktop internal 26.1002.52244 | Exact bundle/version registry; current service returns weekly-only with 5h unavailable, never inferred as zero |
| Frontend build | PASS | TypeScript check and embedded production assets; not a runtime acceptance substitute |
| Core v2 live execution | ACTIVE: legacy gracefully stopped, disabled and backed up; records and delivery intents imported | One Core writer; original Desktop backend retained |
| Core v2 scheduler | Priority/reserve/concurrency/cooldown/retries/manual policy implemented and tested | ACK lag and new-Turn lifecycle keep concurrency slots occupied |
| Desktop GUI | Live native application opened; Dashboard, Threads list/ThreadDetails, Quota, Settings, Pricing, Token, Performance and DatabaseRecovery surface visually inspected | Authenticated existing owner; privacy mode, single instance and close-to-tray checked. ThreadDetails was expanded without policy/resume actions. Current-binary untranslated enum strings are recorded above |
| Desktop widget | PASS for installed UI restart: expanded/locked/pinned/visible and position retained | Same Core/Desktop process identities; physical reboot and changed-monitor topology not tested |
| Token/pricing/performance | Per-model/tier/effort/collaboration/turn statistics and model/tier performance comparisons implemented and independently tested | Separate ledgers; partial response coverage is explicit; global/fork consumption and exact model timings remain unavailable |
| Windows package CI | PASS on `44274f3`: native helper/Core validation, NSIS installer, portable package and checksums built | [Windows desktop package](https://github.com/xdcgh/codex-control-center/actions/runs/38099490646): build, native validation, installer, portable assembly and hash steps succeeded |
| New Desktop smoke | PASS: one Normal and one Goal turn, two live model calls total | Owned agent fixtures, gpt-6-luna/low; Goal quota trigger was SIMULATED and cannot establish natural acceptance |
| Natural Core v2 quota cycle | INCOMPLETE: three original-Goal recovery episodes; one later interrupted and final Goal pending | Real detector latencies 553/5448/2471 ms; see corrected, separate receipt latencies in E2E-NATURAL-QUOTA-CYCLE.md |
| Public repository | Created and initial commits/tags verified remotely | https://github.com/xdcgh/codex-control-center; passed history/working-file security gate |
| Live Core v2 doctor | PASS: protocol, quota, dynamic catalog (7 models), Thread read, Goal read, dry-run resume | Existing Goal read only; no model turn initiated |
| Legacy real quota cycle | Original Goal automatically continued after natural reset | Legacy 120-second buffer; incomplete final lifecycle, separate from new acceptance |
| SQLite maintenance | PASS: v1 migration backup, bounded history aggregates, explicit offline corruption preservation and mandatory review fence | Live v1→v2 upgrade also passed: 4 tasks, 6 intents, policy and all observed history rows retained; automatic pre-upgrade backup and quick_check verified |
| Dependency notices | COMPLETE for current locked npm/Cargo/Node payload | Full license bundle and MPL source availability; no unresolved license conflict identified |
| Actual bilingual NSIS payload | PASS on `44274f3` | NSIS installer and main executable are unsigned (Authenticode NotSigned); portable ZIP is checksum-verified, not Authenticode-signed. Fresh install exited 0; installed-vs-loose-portable and installed-vs-ZIP checks both PASS at 42/42 payload files, 41 non-executable files byte-identical, expected NSS/UNK-only main executable difference, normalized hash match, zero absolute private-path matches |
| Binary publication security | PASS on current candidate; superseded artifact rejected | Earlier staged package's compiler paths were removed by the source-path remapping fix. Current installed/portable binary path scan found zero private absolute-path matches; future changes require another scan. |
| Official pricing check | HTTP 200 through existing local proxy; no prices modified | Direct fetch returned 403. Child-only proxy support and finite checker timeout added; no Windows settings changed |
| Login startup | PASS for owned-task to GUI startup migration | Disabled-but-running task status bug fixed; repeat on final build; physical Windows login not observed |
| Tray | PASS for the Chinese menu: exact icon invocation opened compact, and a real right click displayed live quota/task data and translated actions | No policy/menu action invoked; compact and menu closed afterward. English-menu check follows |
| v0.1.0 release | Private draft contains installer, portable ZIP and SHA256SUMS; remote asset digests verified | This is a private draft, not a public stable release. Natural-cycle, tray and visible-toast acceptance remain open; no full original-scope completion is claimed |

## Execution

The main agent coordinates implementation, integration, Git preservation, and acceptance. GPT-6.1 Sol owns architecture and complex code. GPT-6 Luna performs source research and independent validation. Agents share files with explicit ownership boundaries.

The installed legacy watchdog is gracefully stopped and its login task disabled, with source, original state and task XML backed up privately. Core v2 preserves the imported send ledger and records. Startup testing migrated the owned development task to the GUI login entry: the task is disabled while its current Core run continues, and the GUI reuses that owner. A second GUI instance did not create another execution process.

Token Analytics and ThreadDetails were loaded and visually inspected. A follow-up source change has 458 language keys, field-scoped translations for known task/Goal/runtime states, and a scrollable compact/widget body with unbroken quota labels. Its full Node suite passed 163/163 without skips, targeted language/component tests passed 9/9, and the UI build passed. Rebuilding and installed QA follow. Remaining product evidence includes visible Windows toast popups, terminal natural-cycle evidence, and formal release publication. Installer/portable bytes and publication CI passed at `44274f3`; re-scan subsequent changes. Physical Windows reboot is deferred to the next version.
