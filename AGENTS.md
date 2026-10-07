# Project working rules

Read `PROGRESS.md`, `ROADMAP.md`, and relevant architecture decisions before continuing work. Confirm the current Git/runtime state rather than assuming a previous shell or service is still active.

## Collaboration

The coordinating agent owns scope, integration, runtime handover, Git preservation, and acceptance. Use GPT-6.1 Sol for substantial architecture and implementation, and GPT-6 Luna for scoped research and independent validation when these models are available. Delegate bounded tasks with explicit file ownership; do not run redundant agent investigations or overlapping edits. Preserve user authorization and do not ask again for already authorized steps.

## Preservation and publication

Commit each stable change with its relevant evidence and push the checkpoint to the existing authenticated remote. Do not leave a completed stage as uncommitted local-only code. Check remote refs after pushes. Keep the original baseline tags and migration provenance. Do not rewrite published history or delete user/runtime data without explicit authorization.

Before public pushes, scan reachable source history and the changed publication surface for secrets and private paths. Never stage runtime/configuration, session logs, credentials, databases, raw diagnostics, private prompts, user paths, or live Thread IDs. Review dependencies and generated artifacts before packaging. Use exact lockfiles and keep failed test/build evidence privately.

## Core safety

Continue work in the existing Codex Desktop Thread owner. Never kill the Desktop backend or take its session lease to implement recovery. Re-read quota and current Thread/Goal state before sending. Preserve Goal identity and budget, manual/user-decision stops, compatibility gates, and the durable uncertain-send ledger. Two execution owners must never coexist during migration. Acknowledged resumptions occupy concurrency slots until their new Turn lifecycle is known to end.

Quota recovery polling defaults to 10 seconds; quota history defaults to 60 seconds and is independent of thread scans. Do not reintroduce reset-time buffers. Unknown versions allow read-only monitoring and disable unverified mutations.

## Evidence

Run meaningful checks for changed behavior. Keep legacy regressions, independent black-box acceptance, live read-only probes, Desktop smoke, process restart, physical Windows restart, and natural quota-cycle evidence distinct. Never use a fixture cycle as a natural-cycle pass or a successful GUI launch as release completion.

Record metric provenance and missing-data reasons. Reasoning tokens are included in output rather than added again to total. API-equivalent estimates are not subscription bills. Context pricing uses actual request input, versioned policies and exclusive cache categories. Do not call turn-level output latency model TTFT or divide turn duration into a claimed decode speed.
