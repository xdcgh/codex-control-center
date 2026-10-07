# ADR 001: Tauri 2 shell with the verified Node recovery core

Status: accepted for implementation, 2026-10-07.

## Context

The existing Node engine has original-thread Desktop recovery, Goal restoration, fresh-state checks, and a durable send ledger. Replacing all of it together with the GUI would discard useful behavioral evidence. The product needs a Windows tray, a separate always-on-top widget, startup integration, one app instance, SQLite, and distributable packages.

## Decision

Use Tauri 2 with a Rust Windows shell and React/TypeScript UI. Retain the Node.js 24 recovery core as a managed sidecar with a structured local control channel. Node's built-in SQLite avoids an extra native Node database dependency. The shell owns windows, tray, widget, notifications and startup; the Node core owns compatibility-aware Codex adapters, quota polling, persistence, scheduling and telemetry. Package a pinned Node runtime with the installer/portable build so end users need no development toolchain.

Official app-server reads take priority. Desktop private IPC remains isolated in a version-gated adapter when continuing work in the existing Desktop owner requires it. An unknown version must not prevent read-only quota/session monitoring.

## Alternatives

| Stack | Strengths | Consequences for this project |
| --- | --- | --- |
| Tauri 2 | OS WebView, Rust native integration, official tray/autostart/single-instance plugins | Rust/MSVC/WebView2 build prerequisites; sidecar packaging must be tested |
| WPF/WinUI | Strong Windows integration and mature desktop APIs | Reusing the web dashboard adds another host layer; still needs the Node recovery process |
| Electron | Straightforward Node integration and tray/window/startup APIs | Bundles Chromium/Node; larger shipped runtime for a background utility |

We choose Tauri because its shell directly covers the native requirements while the verified recovery core can be retained. We do not claim benchmarked memory advantages until packages are measured. A Rust core migration is a later decision requiring behavior equivalence tests.

## Sources

- [Tauri tray](https://v2.tauri.app/learn/system-tray/), [autostart](https://v2.tauri.app/plugin/autostart/), [single instance](https://v2.tauri.app/plugin/single-instance/).
- [Microsoft Windows app overview](https://learn.microsoft.com/en-us/windows/apps/get-started/) and [Windows App SDK](https://learn.microsoft.com/en-us/windows/apps/windows-app-sdk/).
- [Electron Tray](https://www.electronjs.org/docs/latest/api/tray) and [BrowserWindow](https://www.electronjs.org/docs/latest/api/browser-window/).
- [Codex app-server](https://learn.chatgpt.com/docs/app-server).
