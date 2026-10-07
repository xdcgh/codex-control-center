# Contributing

Use Node.js 24 or newer and run `npm test` before proposing core changes. Desktop development will also require the pinned Tauri/Rust toolchain documented by the packaging instructions.

Keep Codex protocol access behind adapters and preserve the original-thread owner, Goal identity, freshness checks and idempotent send ledger. Unknown versions must fail closed for mutations. Unit/integration fixtures use synthetic identifiers and generic paths; never commit session data or runtime state.

Record data source and quality for all metrics. Model TTFT/decode throughput require per-request timing evidence. API-equivalent pricing is not subscription billing, and reasoning tokens must not be added again to output/total tokens.

Use small commits with relevant validation. Changes to protocol compatibility, safety policy, database migrations or pricing need tests covering failure cases. Natural quota-cycle acceptance must remain separate from simulated tests.
