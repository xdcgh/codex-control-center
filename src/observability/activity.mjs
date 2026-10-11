import { createHash } from 'node:crypto';
import { isUuid } from '../policy.mjs';

export const ACTIVITY_SOURCE = 'local-session-log';
export const ACTIVITY_FRESH_MS = 30000;
export const INACTIVITY_THRESHOLD_MS = 15 * 60 * 1000;
const hash = value => createHash('sha256').update(value).digest('hex');
const time = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const activeLimit = 64, closedLimit = 128;
const terminalTypes = new Set(['task_complete', 'turn_complete', 'turn_completed', 'task_cancelled', 'turn_cancelled', 'turn_aborted']);
const activityTypes = new Set(['task_started', 'turn_started', ...terminalTypes, 'agent_message', 'agent_message_delta', 'assistant_message', 'agent_reasoning', 'agent_reasoning_delta', 'user_message', 'token_count', 'token_usage', 'token_usage_record', 'tool_call_begin', 'tool_call_end']);
const responseTypes = new Set(['message', 'reasoning', 'function_call', 'function_call_output', 'custom_tool_call', 'custom_tool_call_output']);

// State deliberately contains no tool names, arguments, input, output or messages.
export function activityState(threadId, turnId, epoch, gap = false) {
  return { threadId, turnId, epoch, lastEventAt: null, startedAt: null, terminalAt: null, calls: {}, closed: {}, closedFloorAt: null, gap, hasEvents: false };
}
export function reduceActivity(previous, event, { threadId, turnId, epoch, now = Date.now(), legacyGap = false } = {}) {
  if (!isUuid(threadId) || !isUuid(turnId)) return previous;
  const payload = event?.payload ?? {}, timestamp = Date.parse(event?.timestamp);
  const type = event?.type === 'response_item' ? payload.type : payload.type ?? event?.type;
  const recognized = event?.type === 'response_item' ? responseTypes.has(type) : event?.type === 'event_msg' && activityTypes.has(type);
  if (!recognized) return previous;
  const state = previous?.threadId === threadId && previous?.turnId === turnId && previous?.epoch === epoch ? structuredClone(previous) : activityState(threadId, turnId, epoch, legacyGap);
  if (time(timestamp) === null || time(now) === null || timestamp > now + 1000) { state.gap = true; return state; }
  state.hasEvents = true;
  const older = state.lastEventAt !== null && timestamp < state.lastEventAt;
  state.lastEventAt = Math.max(state.lastEventAt ?? 0, timestamp);
  const start = type === 'task_started' || type === 'turn_started';
  if (start && state.startedAt === null && !older && state.terminalAt === null) { state.startedAt = timestamp; state.gap = false; }
  if (terminalTypes.has(type)) {
    state.terminalAt = Math.max(state.terminalAt ?? 0, timestamp);
    for (const key of Object.keys(state.calls)) state.closed[key] = timestamp;
    state.calls = {};
  }
  const id = typeof payload.call_id === 'string' && payload.call_id.length > 0 && payload.call_id.length <= 512 ? hash(payload.call_id) : null;
  const begin = ['function_call', 'custom_tool_call', 'tool_call_begin'].includes(type);
  const end = ['function_call_output', 'custom_tool_call_output', 'tool_call_end'].includes(type);
  if ((begin || end) && !id) state.gap = true;
  if (id && end) {
    if (state.calls[id] && timestamp < state.calls[id].at) state.gap = true;
    delete state.calls[id];
    state.closed[id] = Math.max(state.closed[id] ?? 0, timestamp);
  }
  if (id && begin && older && !Object.hasOwn(state.closed, id) && !Object.hasOwn(state.calls, id)) state.gap = true;
  if (id && begin && state.terminalAt === null && !older && !Object.hasOwn(state.closed, id) && (state.closedFloorAt === null || timestamp > state.closedFloorAt)) {
    const kind = type === 'tool_call_begin' ? 'execution' : 'request';
    if (state.calls[id]) {
      if (kind === 'execution') state.calls[id].kind = 'execution';
    } else if (Object.keys(state.calls).length < activeLimit) state.calls[id] = { at: timestamp, kind };
    else state.gap = true;
  }
  // Closed-call tombstones cannot grow with a long-lived turn; older begins are
  // additionally rejected by the monotonic event watermark after eviction.
  const closedEntries = Object.entries(state.closed).sort((a, b) => b[1] - a[1]);
  if (closedEntries.length > closedLimit) state.closedFloorAt = Math.max(state.closedFloorAt ?? 0, ...closedEntries.slice(closedLimit).map(entry => entry[1]));
  state.closed = Object.fromEntries(closedEntries.slice(0, closedLimit));
  return state;
}

export function projectActivity(sources, canonical, { now = Date.now(), indexedAt, indexErrors = 0 } = {}) {
  const unavailable = reason => ({ source: ACTIVITY_SOURCE, status: 'Unavailable', reason, lastEventAt: null, pendingRequests: null, executingTools: null, authoritativeToolState: 'Unavailable', indexedAt: time(indexedAt), heuristic: { status: 'Unavailable', reason, thresholdMs: INACTIVITY_THRESHOLD_MS, automaticAction: false } });
  if (canonical?.verified !== true || !isUuid(canonical?.threadId) || !isUuid(canonical?.turnId)) return unavailable('exact-turn-unavailable');
  if (time(now) === null || time(canonical.observedAt) === null || canonical.observedAt > now + 1000 || now - canonical.observedAt > ACTIVITY_FRESH_MS) return unavailable('canonical-observation-stale');
  const matched = sources.filter(entry => entry.state?.threadId === canonical.threadId && entry.state?.turnId === canonical.turnId);
  if (!matched.length) return unavailable('no-exact-turn-events');
  const eventTimes = matched.map(entry => entry.state.lastEventAt).filter(value => time(value) !== null);
  const lastEventAt = eventTimes.length ? Math.max(...eventTimes) : null;
  if (canonical.status !== 'inProgress') return { ...unavailable('canonical-turn-not-active'), lastEventAt };
  if (time(indexedAt) === null || indexedAt > now + 1000 || now - indexedAt > ACTIVITY_FRESH_MS || indexErrors) return unavailable('event-index-stale-or-incomplete');
  if (matched.some(entry => time(entry.indexedAt) === null || entry.indexedAt > now + 1000 || now-entry.indexedAt > ACTIVITY_FRESH_MS)) return unavailable('event-source-stale-or-detached');
  if (matched.some(entry => !entry.complete || entry.state.gap || !entry.state.hasEvents || entry.state.startedAt === null)) return unavailable('event-coverage-incomplete');
  if (lastEventAt === null || lastEventAt > now + 1000 || time(canonical.startedAt) === null || matched.some(entry => Math.abs(entry.state.startedAt-canonical.startedAt)>1000)) return unavailable('event-clock-or-turn-boundary-invalid');
  const calls = {}, closed = new Set();
  for (const entry of matched) {
    if (entry.state.terminalAt !== null) return { ...unavailable('observed-turn-terminal'), lastEventAt };
    for (const id of Object.keys(entry.state.closed)) closed.add(id);
    for (const [id, call] of Object.entries(entry.state.calls)) if (!calls[id] || call.kind === 'execution') calls[id] = call;
  }
  for (const id of closed) delete calls[id];
  const pendingRequests = Object.values(calls).filter(call => call.kind === 'request').length;
  const executingTools = Object.values(calls).filter(call => call.kind === 'execution').length;
  const silenceMs = now - lastEventAt;
  const allowedHeuristic = canonical.runtimeType === 'active' && Array.isArray(canonical.runtimeFlags) && canonical.runtimeFlags.length === 0;
  const heuristic = !allowedHeuristic ? { status: 'Unavailable', reason: 'runtime-active-or-user-wait-state-unverified', thresholdMs: INACTIVITY_THRESHOLD_MS, automaticAction: false }
    : { status: silenceMs >= INACTIVITY_THRESHOLD_MS ? 'HeuristicSuspectedInactivity' : 'NoObservedInactivity', reason: 'time-since-last-observed-event', silenceMs, thresholdMs: INACTIVITY_THRESHOLD_MS, automaticAction: false };
  // Old requests may legitimately be long-running, but cannot be asserted as a
  // current execution state merely because a completion event was not indexed.
  const staleOpen = Object.values(calls).some(call => now - call.at > INACTIVITY_THRESHOLD_MS);
  return { source: ACTIVITY_SOURCE, status: staleOpen ? 'Stale' : executingTools ? 'ObservedExecuting' : pendingRequests ? 'ObservedPendingRequest' : 'NoObservedPendingTool', reason: staleOpen ? 'open-tool-observation-stale' : null, lastEventAt, pendingRequests: staleOpen ? null : pendingRequests, executingTools: staleOpen ? null : executingTools, authoritativeToolState: 'Unavailable', indexedAt, heuristic };
}
