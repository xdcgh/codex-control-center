# Progress

Updated: 2026-10-07 (Asia/Shanghai).

## Evidence

| Check | Result | Scope |
| --- | --- | --- |
| Legacy unit suite | PASS: 25/25 | Baseline isolated tests, no live model request |
| Legacy running state | Monitoring enabled; one watched task, three inactive records | Private runtime snapshot; no task content published |
| Legacy rollback | Commit and annotated tag saved | Local workspace baseline |
| New repository | Independent import with sanitized documentation | No earlier commits existed to preserve |
| Community research | COMPLETE: all eleven requested repositories inspected | Pinned HEADs, actual licenses, official protocol/framework sources in `docs/research.md` |
| Stack decision | Tauri 2 + Rust + React/TypeScript + existing Node sidecar | ADR accepted; no measured memory claim |
| Publication surface scan | PASS: Gitleaks 8.30.1 history and working files, private-path review | Initial source import; repeat for changed stages |
| Remote CI | PASS on `f901eab`: Windows/Linux tests and publication security | https://github.com/xdcgh/codex-control-center/actions/runs/37567110625 |
| Core v2 headless suite | PASS: 100/100, no skips, including legacy regressions and real native-helper tests | Real temporary SQLite; fixture adapters remain simulated |
| Core v2 live execution | ACTIVE: legacy gracefully stopped, disabled and backed up; records and delivery intents imported | One Core writer; original Desktop backend retained |
| Core v2 scheduler | Priority/reserve/concurrency/cooldown/retries/manual policy implemented and tested | ACK lag and new-Turn lifecycle keep concurrency slots occupied |
| Desktop GUI | Live native application opened; Dashboard, Threads, Quota, Settings and Diagnostics visually inspected | Authenticated existing owner; privacy mode, single instance and close-to-tray checked |
| Desktop widget | Live widget opened at 200% DPI; native always-on-top flag verified | Data matches Core; additional preferences/restore acceptance ongoing |
| Token/pricing/performance | Live ingestion: approximately 31,000 token rows and 4,000 call rows; UI refresh fix in progress | Missing cache writes/tier/history prices remain Partial/Unavailable |
| Windows package CI | PASS on `0567e26`: native helper tests, NSIS and portable + SHA256 artifacts | https://github.com/xdcgh/codex-control-center/actions/runs/37596823482 |
| New Desktop smoke | Not run | Existing scripts provision owned tests and consume model quota |
| Natural Core v2 quota cycle | INCOMPLETE: reset detected after 553 ms; original Goal continuation acknowledged after 5137 ms; one dispatch observed | Real service reset on 2026-10-07; resumed Turn/Goal still running |
| Public repository | Created and initial commits/tags verified remotely | https://github.com/xdcgh/codex-control-center; passed history/working-file security gate |
| Live Core v2 doctor | PASS: protocol, quota, dynamic catalog (7 models), Thread read, Goal read, dry-run resume | Existing Goal read only; no model turn initiated |
| Legacy real quota cycle | Original Goal automatically continued after natural reset | Legacy 120-second buffer; incomplete final lifecycle, separate from new acceptance |
| v0.1.0 release | Pending product acceptance and packaging | No private runtime data staged |

## Execution

The main agent coordinates implementation, integration, Git preservation, and acceptance. GPT-6.1 Sol owns architecture and complex code. GPT-6 Luna performs source research and independent validation. Agents share files with explicit ownership boundaries.

The installed legacy watchdog is gracefully stopped and its login task disabled, with source, original state and task XML backed up privately. Core v2 runs from a new owned login task with the imported send ledger and records. The GUI reuses that owner; opening a second GUI instance did not create another execution process.

Remaining release acceptance includes UI analytics refresh, preference/autostart checks, owned Normal/Goal Desktop smoke, restart/corruption reliability, final dependency notices, and natural-cycle terminal evidence. Physical Windows restart has not been performed.
