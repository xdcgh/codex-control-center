# Observed legacy quota cycle, 2026-10-07

Status: **LEGACY / INCOMPLETE**. This is real service/legacy-watchdog evidence, not a fixture run. It does not pass the new 10-second detector or final natural-cycle acceptance.

| Field | Observation |
| --- | --- |
| Watchdog source | Preserved baseline legacy engine, with reset + 120 seconds and 30-second polling |
| CLI / Desktop | `0.160.1` / `26.930.61225` |
| Thread kind | Goal, continued in the original chat |
| Model | Original model retained by Desktop continuation parameters |
| Exhaustion first recorded | 2026-10-07 10:51:39.149 +08:00 (`waitingQuota`, `usage-limit-exceeded`) |
| Service-reported 5h reset | 2026-10-07 11:19:33 +08:00 |
| Resume dispatch recorded | 2026-10-07 11:21:43.985 +08:00 |
| Continuation accepted | 2026-10-07 11:21:44.163 +08:00 |
| Reset-to-accepted duration | 131.163 seconds; includes the legacy 120-second buffer |
| Exact detector latency | Unavailable: the legacy event log does not timestamp the first successful quota read separately |
| Continuation result | Original Goal resumed work; final completion not yet observed |
| Duplicate dispatch | No duplicate watchdog continuation observed in the inspected event sequence; full final lifecycle still pending |
| Manual intervention | No manual quota or Goal-state edit used for this continuation |
| Subagents | Both assigned agents also stopped on official usage limit and were explicitly restarted after quota recovery |
| Process restart in this cycle | Not tested |

Private state, event receipts and the current Thread ID are retained locally, outside this repository. Public timestamps were selected from the legacy state/event log and the structured app-server quota read. No private prompt, ID, account identifier or user path is included here.

The new implementation must separately observe real quota recovery, dispatch without the old buffer, and eventual task completion. See the [natural-cycle acceptance record](../../E2E-NATURAL-QUOTA-CYCLE.md).
