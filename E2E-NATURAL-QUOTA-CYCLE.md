# Natural quota-cycle acceptance record

Status: **NOT OBSERVED**. This file is an acceptance template, not evidence that a natural quota reset has been tested. A simulated quota fixture, manually edited state, or mocked reset must never be recorded as a natural cycle.

The [legacy cycle observed on 2026-10-07](docs/evidence/legacy-natural-cycle-2026-10-07.md) continued the original Goal after a real reset, with the legacy 120-second buffer. Its final lifecycle is incomplete and it does not satisfy the new 10-second detector acceptance.

## Run identity

| Field | Recorded value |
| --- | --- |
| Run ID | `<unique run id>` |
| Evidence captured at | `<ISO-8601 with timezone>` |
| Codex CLI version | `<version or unavailable>` |
| Codex Desktop version/build | `<version/build or unavailable>` |
| Control Center commit | `<full SHA>` |
| Adapter/protocol compatibility | `<verified version and probe result>` |
| Thread kind | `<Normal / Goal>` |
| Thread ID | `<redacted stable fingerprint; never public raw ID>` |
| Model ID | `<exact recorded ID>` |
| Reasoning effort / service tier | `<observed values or unavailable>` |
| Execution environment | `<Windows version; no private paths>` |

## Natural-cycle events

| Event | Timestamp | Evidence source and safe reference |
| --- | --- | --- |
| Structured usage-limit failure first observed | `<ISO-8601>` | `<redacted event/run reference>` |
| Watcher persisted quota-wait record | `<ISO-8601>` | `<state-transition receipt>` |
| Exhausted window(s) and reported resetsAt | `<window + ISO-8601>` | `<structured quota snapshot; percentages only>` |
| Each exhausted window observed usable | `<per-window ISO-8601>` | `<structured quota snapshot>` |
| Detector recognized all blocking windows usable | `<ISO-8601>` | `<poll receipt>` |
| Fresh Thread/Goal state recheck | `<ISO-8601>` | `<status and compatibility result only>` |
| Original-thread resume accepted | `<ISO-8601>` | `<send receipt; redacted IDs>` |
| Original task completed or final outcome | `<ISO-8601>` | `<completion status only>` |

## Outcome and integrity

| Acceptance item | Result / evidence |
| --- | --- |
| Natural, non-simulated usage exhaustion and natural server reset observed | `<PASS / FAIL / NOT OBSERVED; evidence>` |
| Every exhausted quota window became available before dispatch | `<PASS / FAIL; window evidence>` |
| Resume targeted the same original Thread | `<PASS / FAIL; compare private ID locally, publish only fingerprint>` |
| Goal identity/status/budget preserved when applicable | `<PASS / FAIL / N/A; safe metadata only>` |
| Detection latency (`detected all windows usable - reset/availability observed`) | `<duration; disclose timestamp precision>` |
| Resume latency (`resume accepted - detection`) | `<duration; disclose timestamp precision>` |
| Duplicate Turn observed | `<YES / NO / UNKNOWN; evidence>` |
| State survived process restart, if restart was part of this run | `<PASS / FAIL / NOT TESTED>` |
| Manual intervention | `<NONE / describe without content>` |
| Errors and recovery | `<safe error codes only; no prompts/tokens>` |
| Final result | `<PASS / FAIL / INCOMPLETE>` |

## Evidence rules

- A successful cycle requires naturally occurring quota exhaustion, actual server-reported recovery, fresh pre-send state verification, a confirmed same-Thread resume, and a final continuation outcome. If any part is missing, mark the cycle incomplete.
- Keep exact Thread IDs, account identifiers, thread content, prompts, credentials, private paths and raw session records out of public reports. A keyed or one-way stable fingerprint is enough to show sameness across events.
- Retain private raw evidence locally under the operator's control. Public evidence should contain only timestamps, version identifiers, model ID, window percentages/reset timestamps, safe state labels, redacted receipts and outcome.
- Record detection and resume latency separately. Do not include a polling wait in TTFT or claim server-side model timing from client notifications.
- Link any fixture/simulation run in a different report and label it `SIMULATED`; it cannot satisfy this natural-cycle acceptance record.
