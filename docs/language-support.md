# Language support

Language support is part of the desktop product acceptance. The interface must provide complete Simplified Chinese and English copy, choose the initial language from the Windows display language, and preserve a user's manual choice.

## Language selection

The saved preference is `auto` by default. In automatic mode, Windows' user display language selects the interface language. Every `zh-*` tag, including `zh-TW` and `zh-HK`, resolves to the Simplified Chinese catalog. Other tags, including `en-GB`, resolve to the English catalog. Browser language values may be used only as a documented fallback when Windows language information is unavailable.

A manual language choice overrides system detection and remains selected across application launches. The setting is stored with UI preferences. Every application window, the system tray menu, and native notifications use the same resolved language. Returning to `auto` resumes Windows language detection.

## Translation and data rules

All user-visible navigation, headings, field labels, actions, settings, validation feedback, errors, empty states, and accessibility names must have English and Chinese translations. A missing translation must use the English catalog for that key and must not replace the whole page with English.

Translate known protocol enum values and product-owned labels, including data-quality states such as Exact, Partial, Estimated, Unavailable, and their displayed reasons. Keep actual model IDs, provider IDs, thread IDs, protocol codes, and unknown future values unchanged. Formatting may follow the resolved locale, but formatting never changes an identifier.

## Implementation snapshot (2026-10-11)

The installed candidate at source checkpoint `f81886b` contains 460 English keys with Simplified Chinese values. The saved preference accepts `auto`, `zh-CN`, or `en`; `auto` is the default. Windows reports the user's UI locale through Win32, and the returned preference metadata includes `systemLocale` and `resolvedLocale` without saving those derived values. Updates persist the selected `language` and broadcast `preferences/updated` so every window refreshes immediately. Tray labels/tooltips and native toast titles/bodies resolve the latest preference when refreshed or shown.

The Windows package CI for `f81886b` reports production helper/Core validation **163 passed, 0 failed, 0 skipped** with a fresh Debug helper; the full Node suite also passed **163/163 with 0 skips** locally at parent `f0cd45f`. The language/component suite passed **9/9**, and the UI production build passed. Installed UI Automation verified `auto` → English → Simplified Chinese → `auto`; English persisted across a GUI-only exit/relaunch, and the main window and topmost widget changed language together without restarting the Core. The final preference is `auto` on `zh-CN`. Task reasons, the Token inventory label and ThreadDetails collaboration/runtime enums were visually checked in the `f0cd45f` installed build; their source was not changed by the About-only `f81886b` patch. The Chinese Performance page rendered 1,376 turns without a blank page in that prior installed build; provider/model IDs remained unchanged. The `f81886b` installed About page was visually checked in both locales and displays “由 xudc2 与 Codex 开发” / “Developed by xudc2 and Codex”. Root visually reviewed the safe Dashboard captures at [`dashboard-en.png`](screenshots/dashboard-en.png) and [`dashboard-zh-CN.png`](screenshots/dashboard-zh-CN.png).

At `f0cd45f`, left-clicking the tray icon opened the compact topmost window; the 5h status fit on one line, and one scroll exposed the weekly reset and token-speed controls. A right-click in the preceding `44274f3` installed checkpoint displayed 13 localized live-data menu items and a localized tooltip; no menu action was invoked. Settings' TEST-notification action and read-only Windows ToastHistory verified enabled generic TEST notifications in both languages. No popup was visually observed, so foreground appearance and event-specific notification behavior remain unverified. Physical Windows reboot persistence is deferred to the next version by the user.

Commit `f81886b` implements the user-requested About developer credit naming `xudc2` and Codex and adds two localized keys (460 total). The installed 0.1.0 About panel was visually verified in English and Simplified Chinese. This credit does not change license ownership or digital certificates.

## Acceptance boundary

The acceptance test is `test/acceptance-i18n.test.mjs`. It checks locale resolution and fallback, explicit override behavior, catalog completeness for user-visible keys, quality-state translations, and preservation of unknown identifiers. At `f81886b`, field-scoped mappings translate known task reasons, Goal relation explanations, collaboration/runtime states and inventory labels; unknown identifiers stay exact. The full Node suite passes 163/163 without skips at parent `f0cd45f`, the targeted language/component suite passes 9/9, and the UI build passes. The CSS fix makes the compact body scrollable, keeps header/footer controls visible and prevents Chinese quota labels from splitting.

Both current `f81886b` CI workflows succeeded: [Core validation/publication security](https://github.com/xdcgh/codex-control-center/actions/runs/38102339382) and [Windows package build](https://github.com/xdcgh/codex-control-center/actions/runs/38102339376). The Windows workflow's production helper/Core validation reports 163/163 pass with zero failures and skips; this is CI evidence for `f81886b`, while the local full-suite result is recorded at parent `f0cd45f`. The native 9/9 test result is from the prior native checkpoint, not a new `f81886b` run. Its installed NSIS candidate and portable ZIP passed strict installed, loose-portable and ZIP checks. Root updated the private prerelease draft to `f81886b` and verified exactly three assets and their digests; it is not a public stable release.

Visible Windows toast popup appearance and event-specific notification presentation remain open. Tray left-click/compact and the localized right-click menu/tooltip were observed across the f0cd45f and 44274f3 installed checkpoints; menu actions that change task policy were not invoked. The original natural Goal remains incomplete and physical Windows reboot is deferred to the next version.

Current implementation and evidence status are recorded in [`validation.md`](validation.md) and [`acceptance-audit.md`](acceptance-audit.md). Source, packaged and installed evidence remain separate.

## Follow-up source verification — 2026-10-11

The source-only follow-up based on HEAD `21016bc` passes the complete Windows Node suite **185/185, 0 failures, 0 skips**, and the UI build. It adds localized diagnostics/account-activity/Goal/repository surfaces, but is not yet packaged, installed or visually accepted; the installed catalog and language evidence above remain tied to `f81886b`. The source tests cover English/Simplified Chinese rendering, safe identifiers, and privacy hiding. Root's read-only probe passed six Doctor checks; no model request, Goal mutation, or app restart was part of this source verification. Windows toast popup visibility and the original natural Goal terminal outcome remain open. Physical Windows reboot is deferred to the next version.
