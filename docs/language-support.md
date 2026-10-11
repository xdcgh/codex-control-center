# Language support

Language support is part of the desktop product acceptance. The interface must provide complete Simplified Chinese and English copy, choose the initial language from the Windows display language, and preserve a user's manual choice.

## Language selection

The saved preference is `auto` by default. In automatic mode, Windows' user display language selects the interface language. Every `zh-*` tag, including `zh-TW` and `zh-HK`, resolves to the Simplified Chinese catalog. Other tags, including `en-GB`, resolve to the English catalog. Browser language values may be used only as a documented fallback when Windows language information is unavailable.

A manual language choice overrides system detection and remains selected across application launches. The setting is stored with UI preferences. Every application window, the system tray menu, and native notifications use the same resolved language. Returning to `auto` resumes Windows language detection.

## Translation and data rules

All user-visible navigation, headings, field labels, actions, settings, validation feedback, errors, empty states, and accessibility names must have English and Chinese translations. A missing translation must use the English catalog for that key and must not replace the whole page with English.

Translate known protocol enum values and product-owned labels, including data-quality states such as Exact, Partial, Estimated, Unavailable, and their displayed reasons. Keep actual model IDs, provider IDs, thread IDs, protocol codes, and unknown future values unchanged. Formatting may follow the resolved locale, but formatting never changes an identifier.

## Historical bilingual checkpoint — `f81886b` (2026-10-11)

The installed candidate at source checkpoint `f81886b` contains 460 English keys with Simplified Chinese values. The saved preference accepts `auto`, `zh-CN`, or `en`; `auto` is the default. Windows reports the user's UI locale through Win32, and the returned preference metadata includes `systemLocale` and `resolvedLocale` without saving those derived values. Updates persist the selected `language` and broadcast `preferences/updated` so every window refreshes immediately. Tray labels/tooltips and native toast titles/bodies resolve the latest preference when refreshed or shown.

The Windows package CI for `f81886b` reports production helper/Core validation **163 passed, 0 failed, 0 skipped** with a fresh Debug helper; the full Node suite also passed **163/163 with 0 skips** locally at parent `f0cd45f`. The language/component suite passed **9/9**, and the UI production build passed. Installed UI Automation verified `auto` → English → Simplified Chinese → `auto`; English persisted across a GUI-only exit/relaunch, and the main window and topmost widget changed language together without restarting the Core. The final preference is `auto` on `zh-CN`. Task reasons, the Token inventory label and ThreadDetails collaboration/runtime enums were visually checked in the `f0cd45f` installed build; their source was not changed by the About-only `f81886b` patch. The Chinese Performance page rendered 1,376 turns without a blank page in that prior installed build; provider/model IDs remained unchanged. The `f81886b` installed About page was visually checked in both locales and displays “由 xudc2 与 Codex 开发” / “Developed by xudc2 and Codex”. Root visually reviewed the safe Dashboard captures at [`dashboard-en.png`](screenshots/dashboard-en.png) and [`dashboard-zh-CN.png`](screenshots/dashboard-zh-CN.png).

At `f0cd45f`, left-clicking the tray icon opened the compact topmost window; the 5h status fit on one line, and one scroll exposed the weekly reset and token-speed controls. A right-click in the preceding `44274f3` installed checkpoint displayed 13 localized live-data menu items and a localized tooltip; no menu action was invoked. Settings' TEST-notification action and read-only Windows ToastHistory verified enabled generic TEST notifications in both languages. No popup was visually observed, so foreground appearance and event-specific notification behavior remain unverified. Physical Windows reboot persistence is deferred to the next version by the user.

Commit `f81886b` implements the user-requested About developer credit naming `xudc2` and Codex and adds two localized keys (460 total). The installed 0.1.0 About panel was visually verified in English and Simplified Chinese. This credit does not change license ownership or digital certificates.

## Current installed checkpoint — `704b256`

The installed `704b256` package contains **598** English-keyed catalog entries with Simplified Chinese values. Locale resolution, persisted manual overrides and the `auto` default are unchanged. The full Windows Node suite passed **199/199 with zero skips**, and both current Core and Windows-package CI runs passed at this exact commit. Root visually verified the About credit and current Diagnostics/account-activity/Goal/ToolActivity pages in both locales. Privacy mode remained enabled. Root restored `auto` and confirmed it persisted through a GUI-only exit/relaunch; the widget remained hidden and notification settings remained restored.

ToolActivity copy distinguishes observed execution from pending requests and exposes Unavailable/incomplete-coverage and heuristic-unavailable reasons without inventing a tool state. The user accepted the absence of a visible toast popup and the incomplete natural quota-cycle report as evidence limits for the v0.1.0 preview; neither is reported as a pass or treated as a release gate. Physical Windows reboot remains deferred to the next version.

## Acceptance boundary

The acceptance test is `test/acceptance-i18n.test.mjs`. It checks locale resolution and fallback, explicit override behavior, catalog completeness for user-visible keys, quality-state translations, and preservation of unknown identifiers. At installed `704b256`, field-scoped mappings translate known task reasons, Goal relation explanations, collaboration/runtime states and inventory labels; unknown identifiers stay exact. The full Windows Node suite passes 199/199 without skips. The CSS fix makes the compact body scrollable, keeps header/footer controls visible and prevents Chinese quota labels from splitting.

Both current `704b256` CI workflows succeeded: [Core validation](https://github.com/xdcgh/codex-control-center/actions/runs/38106024259) and [Windows package build](https://github.com/xdcgh/codex-control-center/actions/runs/38106024176). The full Windows suite passed 199/199 with zero skips on the installed source. The earlier native Rust 9/9 result is unchanged; native code was not modified in this update. The public [v0.1.0 preview prerelease](https://github.com/xdcgh/codex-control-center/releases/tag/v0.1.0) has exactly three assets matching the local `704b256` installer, portable ZIP and SHA256SUMS. It is a prerelease preview, not a production-stable release.

Visible Windows toast popup appearance and event-specific notification presentation remain unobserved. The user accepts this evidence limit for the preview; it is not reported as pass. Tray left-click/compact and the localized right-click menu/tooltip were observed across the `f0cd45f` and `44274f3` checkpoints; Root later invoked navigation, Pause, Start Windows and Exit UI/keep Core actions without sending a model turn or changing the Goal. Tray Resume Eligible and Exit All were not invoked. The natural Goal remains incomplete and physical Windows reboot is deferred to the next version.

Current implementation and evidence status are recorded in [`validation.md`](validation.md) and [`acceptance-audit.md`](acceptance-audit.md). Source, packaged and installed evidence remain separate.

## Historical source-only validation — `cbf5895` (superseded by installed `704b256`)

The source-only checkpoint based on `cbf5895` passed 199/199 Windows Node tests and UI build before packaging. Its source changes were subsequently included in the installed `704b256` package described above. The `f81886b` historical language catalog had 460 keys; the installed `704b256` catalog has 598. Root's read-only probes used no model request or Goal mutation. Physical Windows reboot remains deferred to the next version.
