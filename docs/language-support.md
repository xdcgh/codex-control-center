# Language support

Language support is part of the desktop product acceptance. The interface must provide complete Simplified Chinese and English copy, choose the initial language from the Windows display language, and preserve a user's manual choice.

## Language selection

The saved preference is `auto` by default. In automatic mode, Windows' user display language selects the interface language. Every `zh-*` tag, including `zh-TW` and `zh-HK`, resolves to the Simplified Chinese catalog. Other tags, including `en-GB`, resolve to the English catalog. Browser language values may be used only as a documented fallback when Windows language information is unavailable.

A manual language choice overrides system detection and remains selected across application launches. The setting is stored with UI preferences. Every application window, the system tray menu, and native notifications use the same resolved language. Returning to `auto` resumes Windows language detection.

## Translation and data rules

All user-visible navigation, headings, field labels, actions, settings, validation feedback, errors, empty states, and accessibility names must have English and Chinese translations. A missing translation must use the English catalog for that key and must not replace the whole page with English.

Translate known protocol enum values and product-owned labels, including data-quality states such as Exact, Partial, Estimated, Unavailable, and their displayed reasons. Keep actual model IDs, provider IDs, thread IDs, protocol codes, and unknown future values unchanged. Formatting may follow the resolved locale, but formatting never changes an identifier.

## Implementation snapshot (2026-10-11)

The packaged checkpoint `44274f3` contains 397 English keys with Simplified Chinese values. The saved preference accepts `auto`, `zh-CN`, or `en`; `auto` is the default. Windows reports the user's UI locale through Win32, and the returned preference metadata includes `systemLocale` and `resolvedLocale` without saving those derived values. Updates persist the selected `language` and broadcast `preferences/updated` so every window refreshes immediately. Tray labels/tooltips and native toast titles/bodies resolve the latest preference when refreshed or shown.

Targeted evidence: `test/acceptance-i18n.test.mjs` **4/4**, bilingual production-component SSR in `test/ui-rendering.test.mjs` **2/2**, Rust/native unit suite **9/9**, UI production build **PASS**, and full source/Debug suites **160/160** each at HEAD `44274f3`. A read-only Windows language probe reported `zh-CN`. Installed acceptance used UI Automation to switch `auto` → English → Simplified Chinese → `auto`; the preference persisted as English across a GUI-only exit/relaunch and the app rendered the Dashboard in English after relaunch. The main window and topmost widget changed language together without restarting the Core. The installed Chinese Performance page rendered 1,376 turns without a blank page; model/provider IDs remained unchanged. Root visually reviewed the public Dashboard captures at [`dashboard-en.png`](screenshots/dashboard-en.png) and [`dashboard-zh-CN.png`](screenshots/dashboard-zh-CN.png).

The Settings test-notification action was invoked once in each language and reported successful submission to Windows. Read-only Windows ToastHistory verification found both generic TEST notifications stored with their setting enabled. No toast popup was visually observed, so this does not establish foreground popup appearance or event-specific notification behavior. UI Automation could not locate the current tray icon, so physical tray clicks and live tooltip localization remain unverified. Physical Windows reboot persistence is deferred to the next version by the user.

The installed `44274f3` binary still shows task reason `running`, the Token ledger label `Counter inventory (unknown attribution)`, and some ThreadDetails collaboration/runtime enum values in English. Source fixes are in progress and are not installed acceptance evidence. Rebuild and repeat the relevant language checks after those changes.

## Acceptance boundary

The acceptance test is `test/acceptance-i18n.test.mjs`. It checks locale resolution and fallback, explicit override behavior, catalog completeness for user-visible keys, quality-state translations, and preservation of unknown identifiers. Installed window/widget language synchronization and GUI-only preference persistence passed. The noted dynamic labels need rebuilt verification; actual Windows toast popup appearance and tray interaction remain open.

The follow-up source catalog has 458 keys. Field-scoped mappings translate known task reasons, Goal relation explanations, collaboration/runtime states and inventory labels; unknown identifiers stay exact. The full Node suite passes 163/163 without skips, and the targeted language/component suite passes 9/9, including real ThreadDetails rendering and identifier-preservation cases. A CSS fix makes the mini body scrollable, keeps header/footer controls visible and prevents Chinese quota labels from splitting. Rebuilt installed verification remains necessary. The current Chinese tray menu was visually verified after a real right click, with live quota/task data; no action changing task policy was selected.

Current implementation and evidence status are recorded in [`validation.md`](validation.md) and [`acceptance-audit.md`](acceptance-audit.md). Source, packaged and installed evidence remain separate.
