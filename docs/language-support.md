# Language support

Language support is part of the desktop product acceptance. The interface must provide complete Simplified Chinese and English copy, choose the initial language from the Windows display language, and preserve a user's manual choice.

## Language selection

The saved preference is `auto` by default. In automatic mode, Windows' user display language selects the interface language. Every `zh-*` tag, including `zh-TW` and `zh-HK`, resolves to the Simplified Chinese catalog. Other tags, including `en-GB`, resolve to the English catalog. Browser language values may be used only as a documented fallback when Windows language information is unavailable.

A manual language choice overrides system detection and remains selected across application launches. The setting is stored with UI preferences. Every application window, the system tray menu, and native notifications use the same resolved language. Returning to `auto` resumes Windows language detection.

## Translation and data rules

All user-visible navigation, headings, field labels, actions, settings, validation feedback, errors, empty states, and accessibility names must have English and Chinese translations. A missing translation must use the English catalog for that key and must not replace the whole page with English.

Translate known protocol enum values and product-owned labels, including data-quality states such as Exact, Partial, Estimated, Unavailable, and their displayed reasons. Keep actual model IDs, provider IDs, thread IDs, protocol codes, and unknown future values unchanged. Formatting may follow the resolved locale, but formatting never changes an identifier.

## Implementation snapshot (2026-10-11)

The UI catalog contains 394 English keys with Simplified Chinese values. The saved preference accepts `auto`, `zh-CN`, or `en`; `auto` is the default. Windows reports the user's UI locale through Win32, and the returned preference metadata includes `systemLocale` and `resolvedLocale` without saving those derived values. Updates persist the selected `language` and broadcast `preferences/updated` so every window refreshes immediately. Tray labels/tooltip and native toast titles/bodies resolve the latest preference when refreshed or shown.

Targeted evidence: `test/acceptance-i18n.test.mjs` **4/4**, bilingual production-component SSR in `test/ui-rendering.test.mjs` **2/2**, Rust/native unit suite **9/9**, and UI production build **PASS**. A read-only Windows language probe reported `zh-CN`. Diagnostics has a user-triggered test-notification action whose content is explicitly marked TEST and does not create quota or recovery events. SSR and unit tests do not replace checking the installed windows, tray menu, and actual Windows toast presentation.

## Acceptance boundary

The acceptance test is `test/acceptance-i18n.test.mjs`. It checks locale resolution and fallback, explicit override behavior, catalog completeness for user-visible keys, quality-state translations, and preservation of unknown identifiers. The UI preference path and native tray/toast localization also need source-level or runtime acceptance; helper-only tests do not establish those integration behaviors.

Current implementation and evidence status are recorded in [`validation.md`](validation.md) and [`acceptance-audit.md`](acceptance-audit.md). This document describes required behavior, not a claim that every integration gate has passed.
