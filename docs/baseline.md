# Legacy baseline and migration

Date: 2026-10-07.

The source project was an untracked directory inside a workspace Git repository with no commits. The baseline was committed before any changes, containing the watchdog source, original 25 tests, PowerShell launch/install scripts, and owned Desktop smoke helpers. Runtime files were excluded.

- Local legacy commit: `56175194b7c4896c64636d161ecab4d0457beacc`.
- Local annotated tag: `legacy-watchdog-baseline-2026-10-07`.
- Tests: all 25 passed, zero failures.
- Validated baseline versions: CLI `0.160.1`, Desktop `26.930.61225`, Windows package `26.930.7945.0` (source compatibility pins; recheck before live use).
- Runtime: existing daemon and its login task were running; monitoring enabled. A private copy of configuration/state/ledger/logs was saved outside this repository.

This repository imports that source through an explicit migration commit. No prior contribution history existed before the local baseline. The original repository and rollback tag remain intact. Public documentation replaces private user paths with generic examples; private runtime and diagnostics are never imported. The public repository does not publish the original workspace history containing private documentation paths.

The retained baseline tests cover the original engine; Core v2 adds live quota probing through adapters while retaining freshness checks, original-thread dispatch, Goal identity, and uncertain-send suppression. Baseline tests do not prove a real quota reset or reboot.
