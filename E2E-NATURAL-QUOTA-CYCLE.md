# Natural quota-cycle acceptance record

Status: **INCOMPLETE**, updated 2026-10-08 (Asia/Shanghai). Three real Core v2 recovery episodes were recorded for the same original Goal. Two prove automatic continuation; one continued turn was subsequently interrupted. The original project Goal has not completed, so none is a complete natural acceptance cycle. Simulated quota fixtures and the separately documented Desktop Goal smoke do not satisfy this requirement.

## Latest persisted observations

CLI `0.160.1`; Desktop `26.930.61225`; model `gpt-6.1-sol`; kind `Goal`. Raw thread/turn identities, Goal content, private paths and recorder keys remain private. Same-thread and Goal identity correlations use persisted keyed fingerprints. Exact source revision at each event was not captured; do not infer it from the current checkout.

All timestamps below are Asia/Shanghai. Latencies are client observations against a server reset reported with seconds precision; clock/network/poll uncertainty applies.

| Episode | Structured failure observed | Reported reset | Recovery detected | Resume receipt | Detection latency | Detector-to-receipt | Reset-to-receipt | Outcome |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Oct 7 12:29:13.653 | Oct 7 16:29:37.000 | Oct 7 16:29:37.553 | Oct 7 16:29:42.137 | 553 ms | 4,584 ms | 5,137 ms | Continued, then naturally quota-limited again; Goal pending |
| 2 | Oct 7 17:43:14.224 | Oct 7 21:30:10.000 | Oct 7 21:30:15.448 | Oct 7 21:30:19.937 | 5,448 ms | 4,489 ms | 9,937 ms | Continued turn later interrupted; episode FAIL; Goal pending |
| 3 | Oct 7 23:03:53.045 | Oct 8 02:30:45.000 | Oct 8 02:30:47.471 | Oct 8 02:30:52.548 | 2,471 ms | 5,077 ms | 7,548 ms | Continuing at report capture; Goal pending |

Each episode has one persisted dispatch intent, an observed transport receipt, an automatic-resume event and the correlated next-turn lifecycle. No second dispatch was observed for the ended turns; duplicate outcome for the still-running third turn remains unknown until it ends. Every dispatch was gated on actual availability of all blocking quota windows and a fresh thread/Goal read. No quota values, reset times or outcome states were edited to produce these observations.

The earlier missing automatic event was backfilled from its exactly correlated persisted real recovery event, preserving that event's original timestamp. The implementation now records it directly. This repair does not create a synthetic completion or replace a failed/interrupted outcome with a pass.

`resumeLatencyMs` now means **receipt minus detection**. `resetToResumeLatencyMs` separately reports receipt minus reported reset. The initial partial report below previously mislabeled 5.137 seconds as detector-to-receipt; its correct detector-to-receipt value is 4.584 seconds. Terminal Goal completion and physical Windows-restart acceptance remain outstanding.

## Archived initial partial report

The following records the limited information available at the first capture; the latest persisted observations above supersede its unavailable fields and timing definition.

The [legacy cycle observed on 2026-10-07](docs/evidence/legacy-natural-cycle-2026-10-07.md) continued the original Goal after a real reset, with the legacy 120-second buffer. Its final lifecycle is incomplete and it does not satisfy the new 10-second detector acceptance.

## Run identity

| Field | Recorded value |
| --- | --- |
| Run ID | `<private natural-cycle evidence ID; not exported>` |
| Evidence captured at | `2026-10-07; timestamps below are +08:00` |
| Codex CLI version | `Unavailable in this partial report` |
| Codex Desktop version/build | `Unavailable in this partial report` |
| Control Center source | `Core v2 working source at observation; exact revision not captured here` |
| Adapter/protocol compatibility | `Verified for this run; version not captured here` |
| Thread kind | `Goal` |
| Thread ID | `Original thread confirmed privately; raw ID and fingerprint withheld` |
| Model ID | `Unavailable in this partial report` |
| Reasoning effort / service tier | `Unavailable in this partial report` |
| Execution environment | `Windows; private paths withheld` |

## Natural-cycle events

| Event | Timestamp | Evidence source and safe reference |
| --- | --- | --- |
| Structured usage-limit failure first observed | `Unavailable in this partial report` | `Automatic event hook missing` |
| Watcher persisted quota-wait record | `Unavailable in this partial report` | `Automatic event hook missing` |
| Exhausted window(s) and reported resetsAt | `5h reset 2026-10-07 16:29:37.000 +08:00; other window details unavailable` | `Natural report; no raw account data included` |
| Each exhausted window observed usable | `Aggregate readiness observed at 2026-10-07 16:29:37.553 +08:00` | `Detector reported all blocking windows ready` |
| Detector recognized all blocking windows usable | `2026-10-07 16:29:37.553 +08:00` | `Observed readiness receipt` |
| Fresh Thread/Goal state recheck | `Succeeded; exact timestamp unavailable` | `One continuation was accepted for the original Goal` |
| Original-thread resume accepted | `2026-10-07 16:29:42.137 +08:00` | `One dispatch / acknowledgement recorded` |
| Original task completed or final outcome | `Still running at evidence capture` | `Natural cycle remains incomplete` |

## Outcome and integrity

| Acceptance item | Result / evidence |
| --- | --- |
| Natural, non-simulated usage exhaustion and natural server reset observed | `PARTIAL; real reset/recovery observed, full event lifecycle missing` |
| Every exhausted quota window became available before dispatch | `Aggregate readiness reported; individual window detail unavailable` |
| Resume targeted the same original Thread | `Confirmed privately for the original Goal` |
| Goal identity/status/budget preserved when applicable | `Identity continuity observed; final completion not observed` |
| Detection latency (`detected all windows usable - reset/availability observed`) | `553 ms from the reported 5h reset; precision 1 ms` |
| Resume latency (`resume accepted - detection`) | `4.584 s; corrected from initial reset-to-receipt value of 5.137 s` |
| Duplicate Turn observed | `One dispatch recorded; full lifecycle duplicate check incomplete` |
| State survived process restart, if restart was part of this run | `NOT TESTED` |
| Manual intervention | `Unavailable in this partial report` |
| Errors and recovery | `Automatic lifecycle event hook missing; Goal still running at capture` |
| Final result | `INCOMPLETE; not a Core v2 natural-cycle pass` |

## Evidence rules

- A successful cycle requires naturally occurring quota exhaustion, actual server-reported recovery, fresh pre-send state verification, a confirmed same-Thread resume, and a final continuation outcome. If any part is missing, mark the cycle incomplete.
- Keep exact Thread IDs, account identifiers, thread content, prompts, credentials, private paths and raw session records out of public reports. A keyed or one-way stable fingerprint is enough to show sameness across events.
- Retain private raw evidence locally under the operator's control. Public evidence should contain only timestamps, version identifiers, model ID, window percentages/reset timestamps, safe state labels, redacted receipts and outcome.
- Record detection and resume latency separately. Do not include a polling wait in TTFT or claim server-side model timing from client notifications.
- Link any fixture/simulation run in a different report and label it `SIMULATED`; it cannot satisfy this natural-cycle acceptance record.
