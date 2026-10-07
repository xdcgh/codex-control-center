# Installed Windows application and restart acceptance

Observed on 2026-10-08 (Asia/Shanghai), against the staged unsigned v0.1.0 installer built from the `2facad5` source stage. This is a product acceptance record, separate from natural quota-cycle evidence. Later rebuilt artifacts require another installed-payload check.

| Check | Result | Evidence boundary |
| --- | --- | --- |
| Fresh NSIS installation | PASS | New task-owned target; no pre-existing installation or matching uninstall registration. Silent installer exited 0. |
| Installed payload | PASS | `verify-installed-payload.mjs` compared 38 payload files with portable; 37 resources were byte-identical. The executable differs only by the unique Tauri NSIS/unknown bundle-type marker. |
| Private installation contents | PASS | No auth/config, user database, session JSONL, logs or private profile paths in redistributed payload. All four license/notice documents and pinned Node runtime present. |
| Installed dashboard | PASS | Actual WebView rendered live quota, reset countdowns, account plan and one active task; privacy mode hid task title, ID and workspace. Existing authenticated Core was reused. |
| Core lifecycle | PASS | Core gracefully stopped for installation, state backed up privately, and restarted through its owned task. Persisted records and send intents survived. Codex Desktop backend remained running throughout. |
| UI-only restart | PASS | Installed application exited through its own single-instance command, then relaunched. Core and Codex Desktop process identities did not change. |
| Expanded widget restore | PASS | Expanded, locked, visible and pinned preferences survived UI restart. Native widget bounds before/after were equal: position `(1720,159)`, size `326×369`; always-on-top style remained set. This does not test a changed monitor arrangement. |
| Login startup migration | PASS with follow-up fix | Turning startup off disabled the owned task without stopping its current Core run. Turning it on created the GUI login entry; task remained disabled, preventing two login writers. The probe found that a disabled running task keeps `State=Running`; source was corrected to read `Settings.Enabled`. Repeat on final build. |
| Tray data | PASS for read-only surface | UI Automation found the exact application tray icon, with live five-hour and weekly remaining percentages and reset labels. |
| Actual tray clicks/menu | NOT RUN | Native cursor APIs returned failure in the tool execution context. An accessibility invocation did not establish a physical tray click; no left/right-click pass is claimed. No unrelated application was clicked. |
| Physical Windows reboot | NOT RUN | Awaiting a user-selected reboot time; no automatic system restart performed. |

Installer SHA-256: `3658fe49d349476e92263b32abe409a6be7c0715961d8b5192acbc1d8a7b5f78`.

Portable ZIP SHA-256: `5639a4badf20df817fb7e24e93841ce390a18d4fa14765820a9ddab4ac60511b`.

Screenshots, state backups and raw process/window receipts remain private. No model calls or artificial quota consumption were needed for these checks.
