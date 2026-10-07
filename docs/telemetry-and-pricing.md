# Token telemetry, timing, and API-equivalent pricing

Research checked 2026-10-07. This document records data semantics and a versioned pricing policy shape; it does not implement a pricing engine. Official OpenAI API prices are only a comparison estimate and are not a Codex subscription charge, quota conversion, or invoice.

## Sources and contract pins

- OpenAI official moving pages: [models catalog](https://developers.openai.com/api/docs/models), [all models](https://developers.openai.com/api/docs/models/all), [pricing](https://developers.openai.com/api/docs/pricing), [GPT-6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol), [GPT-6 Astra](https://developers.openai.com/api/docs/models/gpt-6-astra), [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna), [prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching), [Agents observability and usage](https://developers.openai.com/api/docs/guides/agents-api/observability), and [token counting](https://developers.openai.com/api/docs/guides/token-counting).
- Codex source contract pinned to [`openai/codex` commit `e95abcdf4939f37f11f00f984efdbbf8b088346`](https://github.com/openai/codex/tree/e95abcdf4939f37f11f00f984efdbbf8b088346): [`TokenUsage`, `TokenUsageInfo`, and per-response `TokenUsageRecord`](https://github.com/openai/codex/blob/e95abcdf4939f37f11f00f984efdbbf8b088346/codex-rs/protocol/src/protocol.rs), [app-server token notifications](https://github.com/openai/codex/blob/e95abcdf4939f37f11f00f984efdbbf8b088346/codex-rs/app-server-protocol/src/protocol/v2/thread.rs), [model metadata/catalog](https://github.com/openai/codex/blob/e95abcdf4939f37f11f00f984efdbbf8b088346/codex-rs/protocol/src/openai_models.rs).

Official pages can change without a Git SHA. Persist the retrieval date, source URL and captured rate rows with every price snapshot. The Codex commit is a protocol observation, not a promise that Desktop ships the same build.

## Token field meaning

The Codex protocol's `TokenUsage` includes `input_tokens`, `cached_input_tokens`, `cache_write_input_tokens`, `output_tokens`, `reasoning_output_tokens`, and `total_tokens`. `TokenUsageInfo` has a cumulative `total_token_usage`, a latest `last_token_usage`, and optional `model_context_window`. A per-response `TokenUsageRecord` also carries thread, turn, response identifiers and response/turn/thread scopes.

Use these rules:

| Field | Meaning and treatment |
| --- | --- |
| `input_tokens` | Input processed for that usage scope. Cached and cache-write input are categories within input, not additions on top. |
| `cached_input_tokens` | Cached subset of input. Report separately; do not add it again to input or total. |
| `cache_write_input_tokens` | Cache-write input category when supplied. Treat it as another mutually exclusive input billing category, not an additive surcharge. It may be absent or zero because some surfaces/models do not expose it. |
| `output_tokens` | Generated output, including non-visible generated tokens and reasoning. It can exceed visible text tokenization. |
| `reasoning_output_tokens` | Output subset reported separately for analysis. Never add it to output or total again. |
| `total_tokens` | Codex's usage total is input plus output; reasoning is already inside output. Keep the source value and validate it against `input_tokens + output_tokens`; on a mismatch retain raw evidence and flag it instead of silently rewriting it. |
| `model_context_window` | Context capacity metadata, not the number of tokens used by a request. Never treat the configured maximum as actual request input. |

OpenAI's public Agents usage schema explicitly says cached tokens are included in `input_tokens`, reasoning is included in `output_tokens`, and `total_tokens` is input plus output. That public usage is best-effort, may be null or change as accounting arrives, is not a final bill, and does not expose cache-write count. Codex's local schema having a cache-write field does not prove that every model response carries a trustworthy value; preserve null/unknown separately from zero.

## Sampling versus request usage

`last_token_usage` is the most recent usage sample appended to the current aggregate. It is useful as the latest reported request/context point, but a turn can contain multiple model responses, retries, compactions, or delegated work. Therefore it is not a substitute for a ledger of every request/response.

For per-request attribution, prefer `TokenUsageRecord.usage` keyed by its stable response identity and scope. If that record is unavailable, retain each raw event/snapshot and label derived turn totals as best-effort. Never sum repeated `last_token_usage` snapshots. `total_token_usage` is cumulative; do not add successive cumulative readings together.

Recommended ingestion and aggregation:

1. Persist source, observed timestamp, raw scope, thread/turn/response IDs, model ID, and all available token fields before deriving aggregates.
2. Dedupe exact event/response identities. For JSONL snapshots without a unique response ID, use a stable source record key/content hash and retain the original snapshot; do not dedupe only on token values because two real responses can have identical counts.
3. Derive cumulative deltas only within one known counter epoch and attribution scope. A decrease, thread fork, compaction-related rewrite, missing page, or scope change starts an explicit discontinuity; do not turn a counter reset into negative usage or blindly carry the previous baseline across it.
4. Keep root and subagent/child scopes distinct. Only roll a child into a parent when the protocol's root-turn attribution proves the relationship, and dedupe by response ID so child usage is not counted twice.
5. Preserve raw `total_tokens` and separately record any consistency check. Synthetic context-window fills or markers that lack actual input/output components are not measured request usage.

These are accounting safeguards derived from the protocol's cumulative and per-response shapes. They do not establish that every Codex model/backend emits a complete response ledger.

## Long-context classification

As of this research, the official pages for GPT-6 Astra, GPT-6.1 Sol and GPT-6 Luna state a 272K input-token threshold: a request with more than 272K input tokens is priced at 2x input and cache rates and 1.5x output for the **whole request**. The model catalog lists a 1.05M context window for those models. This is a dated pricing rule, not a constant to scatter through code.

Classify a request only when its own per-response `input_tokens` is available and its exact model/price policy is known. `model_context_window`, session cumulative totals, and a UI context percentage cannot establish that request crossed the threshold. If the only data is `last_token_usage`, classify only that latest sample and label the coverage as incomplete; do not infer the long-context class of earlier responses. Save the threshold and rule in the price snapshot so historical estimates use the rule effective at the event time.

## Versioned pricing snapshot

The current official pricing page separates model rates by processing tier and short/long context. A snapshot should store at least:

```text
snapshot_id
source_url
retrieved_at
effective_from                 # only when OpenAI publishes it; otherwise unknown
model_id                       # exact observed/API identifier
model_alias_of                 # only when official source defines an alias
processing_tier                # standard, batch, flex, fast, ultrafast, or other
context_threshold_tokens       # nullable when not stated
short_input_per_mtok
short_cached_input_per_mtok
short_cache_write_per_mtok
short_output_per_mtok
long_input_per_mtok
long_cached_input_per_mtok
long_cache_write_per_mtok
long_output_per_mtok
regional_or_fedramp_adjustment
eligibility_notes
source_retrieved_at
```

Capture the rates published for each model and tier rather than applying a universal multiplier in code. The dated 2026-10-07 standard snapshot below is a small reference set; it is not the full catalog and must not constrain the UI/model database.

| Model ID | Context | Input / cached input / cache write / output, USD per 1M tokens | Source |
| --- | --- | --- | --- |
| `gpt-6-astra` | ≤272K | 10 / 1 / 12.5 / 50 | [Astra model page](https://developers.openai.com/api/docs/models/gpt-6-astra), [pricing](https://developers.openai.com/api/docs/pricing) |
| `gpt-6-astra` | >272K | 20 / 2 / 25 / 75 | same |
| `gpt-6.1-sol` | ≤272K | 2 / 0.10 / 2.5 / 10 | [Sol model page](https://developers.openai.com/api/docs/models/gpt-6.1-sol), [pricing](https://developers.openai.com/api/docs/pricing) |
| `gpt-6.1-sol` | >272K | 4 / 0.20 / 5 / 15 | same |
| `gpt-6-luna` | ≤272K | 0.10 / 0.01 / 0.125 / 0.50 | [Luna model page](https://developers.openai.com/api/docs/models/gpt-6-luna), [pricing](https://developers.openai.com/api/docs/pricing) |
| `gpt-6-luna` | >272K | 0.20 / 0.02 / 0.25 / 0.75 | same |
| `gpt-5.6-sol` | ≤272K | 4 / 0.40 / 5 / 20 | [pricing](https://developers.openai.com/api/docs/pricing) |
| `gpt-5.6-sol` | >272K | 8 / 0.80 / 10 / 30 | same |
| `gpt-5.6-cyber` | ≤272K | 12.5 / 1.25 / 15.625 / 75 | [pricing](https://developers.openai.com/api/docs/pricing); long-context rates shown unavailable |

The pricing page also lists Standard, Batch, Flex, Fast and (for eligible models) Ultrafast rates. The model pages describe Batch/Flex as 50% of Standard and Fast as 2x applicable rates where supported. Eligibility and regional rules vary by model; store the published tier row and eligibility, do not multiply estimates when the exact tier or rate is missing. The current pricing page notes a 10% regional-processing uplift for eligible models released on/after 2026-03-05 and a FedRAMP uplift. Keep those as policy entries with applicability and dates, not a blanket adjustment.

### Cost estimate semantics

For a request with mutually exclusive input categories, estimate:

```text
uncached_input = input_tokens - cached_input_tokens - cache_write_input_tokens
input_cost = (uncached_input * input_rate
            + cached_input_tokens * cached_rate
            + cache_write_input_tokens * cache_write_rate) / 1_000_000
output_cost = output_tokens * output_rate / 1_000_000
api_equivalent = input_cost + output_cost + separately priced tools/services
```

Validate that categories are nonnegative and partition the reported input before computing. When cache-write usage is missing for a model whose price includes cache writes, report a range or `incomplete estimate`; do not silently assume zero. If a model ID, processing tier, context class, or applicable price row is unknown, report `Unavailable` for the estimate. API-equivalent cost excludes Codex subscription pricing/benefits, undisclosed quota weights, non-token charges unless separately observed, and any hidden billing coefficients.

## Dynamic model inventory

Read the current Codex app-server model catalog and actual turn metadata; persist the exact `model_id` even when the UI uses a friendly label. The official API model catalog is also dynamic, and API availability does not prove subscription/Codex availability. Do not hardcode the present three flagship models as an enum. A newly observed model must be recordable immediately; until a dated source-backed price row exists, show its token counts and mark API-equivalent cost unavailable. If an official alias points to a specific model, preserve both requested ID and resolved ID with source evidence.

Store the observed `reasoning_effort`, `service_tier`, and any available collaboration/Goal metadata with each turn. “Fast” is a display concept derived from actual tier metadata and current official naming; do not infer it from latency.

## Timing and performance labels

The public Codex app-server protocol exposes lifecycle and output events, but the inspected protocol does not expose an authoritative model-side prefill start, first sampled token timestamp, or exact decode duration. Do not claim exact TTFT or model tokens/second from local session logs.

| Metric | Defensible meaning | Label |
| --- | --- | --- |
| Turn wall time | Locally observed monotonic elapsed time between turn-start and turn-finished notifications. Includes queueing, transport, tools, waits and any subagent overlap. | `Observed turn wall time` |
| First visible output latency | Local elapsed time from turn start until the UI/stream observer receives first user-visible text. It includes client/network/scheduling delay and may omit hidden model output. | `Observed first-visible-output latency` |
| Model TTFT | Time from server inference start to first sampled model token. Start point and server-side token timestamp are not exposed by the inspected public protocol. | `Unavailable` |
| Decode tokens/s | Model decode duration and exact generated-token timing are not exposed. Output tokens divided by total turn time mixes tool and wait time. | `Unavailable`; any derived rate must be labeled `rough end-to-end estimate` |
| Tool duration | Local begin/end observations for an identified tool call. Parallel calls and nested agents need separate IDs and overlap-safe aggregation. | `Observed tool wall time` |

Report sample counts and missing-data coverage beside P50/P95. Do not present client-observed timing as an OpenAI model-performance measurement.
