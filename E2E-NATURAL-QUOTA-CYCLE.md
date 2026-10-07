# Natural quota-cycle acceptance record

Status: **INCOMPLETE**. A real Core v2 quota recovery was observed, but the Goal/turn was still running and the automatic lifecycle event hook was missing when evidence was captured. This is a partial natural observation, not a completed acceptance cycle. A simulated quota fixture, manually edited state, or mocked reset must never be recorded as a natural cycle.

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
| Resume latency (`resume accepted - detection`) | `5.137 s; precision 1 ms` |
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
