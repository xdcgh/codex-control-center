// Explicitly owned transport fixtures only. Never sends to a business chat.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { AccountClient } from '../src/rpc.mjs';
import { DesktopClient } from '../src/ipc.mjs';
import { inspectBundle } from '../src/bundle.mjs';
import { latestTurn, goalIdentity, isUuid } from '../src/policy.mjs';
import { randomUUID } from 'node:crypto';

const config = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (!inspectBundle(config.asarPath).compatible) throw new Error('unsupported-desktop');
const directory = path.resolve(import.meta.dirname, '../../diagnostics', `watchdog-desktop-smoke-${Date.now()}`);
fs.mkdirSync(directory, { recursive: true });
const desktop = new DesktopClient({ timeoutMs: 8000 });
const account = new AccountClient({ ...config, timeoutMs: 30000 });
const receipts = [];
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const navigate = (id) => {
  if (!isUuid(id)) throw new Error('invalid-fixture-id');
  const child = spawn(path.join(process.env.SystemRoot, 'explorer.exe'), [`codex://threads/${id}`], { windowsHide: true, stdio: 'ignore' });
  child.on('error', () => {}); child.unref();
};
try {
  await desktop.connect(); await account.start();
  for (const goal of [false, true]) {
    let creator = new AccountClient({ ...config, timeoutMs: 30000 }); let id;
    const receipt = { kind: goal ? 'goal' : 'ordinary', ok: false };
    try {
      await creator.start();
      const started = await creator.raw('thread/start', { cwd: directory, model: 'gpt-6.1-sol', sandbox: 'read-only', approvalPolicy: 'never', threadSource: 'agent', config: { model_reasoning_effort: 'low' } });
      id = started.thread.id; if (!isUuid(id)) throw new Error('fixture-id-invalid'); receipt.threadId = id;
      let before;
      if (goal) before = (await creator.raw('thread/goal/set', { threadId: id, objective: 'Owned desktop transport test: verify the current Goal with get_goal, mark it complete with update_goal, and reply WATCHDOG_DESKTOP_GOAL_OK. No commands, files, connectors, or other work.', status: 'usageLimited', tokenBudget: 1000000 })).goal;
      else {
        // thread/start alone is not persisted until it has work. A paused fixture
        // Goal materializes its settings without a model call; clearing it leaves
        // an ordinary persisted chat for the native transport test.
        await creator.raw('thread/goal/set', { threadId: id, objective: 'Owned ordinary transport fixture; no work.', status: 'paused' });
        await creator.raw('thread/goal/clear', { threadId: id });
      }
      await creator.close(); creator = null;
      navigate(id);
      let snapshot;
      for (let attempt = 0; attempt < 12; attempt++) {
        try { snapshot = await desktop.snapshot(id); if (snapshot.state.resumeState === 'resumed') break; } catch {}
        await pause(1000);
      }
      if (!snapshot || snapshot.state.id !== id || snapshot.state.threadSource !== 'agent') throw new Error('owned-fixture-not-loaded');
      receipt.nativeOwnerFound = true;
      if (goal) {
        const restored = (await account.request('thread/goal/set', { threadId: id, status: 'active' })).goal;
        receipt.goalIdentityPreserved = goalIdentity(before) === goalIdentity(restored);
        receipt.budgetPreserved = before.tokenBudget === restored.tokenBudget;
        receipt.usagePreserved = before.tokensUsed === restored.tokensUsed;
        snapshot = await desktop.snapshot(id);
      }
      const messageId = randomUUID();
      const response = await desktop.request('thread-follower-start-turn', { conversationId: id,
        turnStart: { request: { threadId: id, clientUserMessageId: messageId, effort: 'low', input: [{ type: 'text', text: goal ? 'This is only the owned transport test. Use get_goal to verify the restored Goal, then use update_goal to mark it complete and reply WATCHDOG_DESKTOP_GOAL_OK. No commands, file edits, connectors, or other work.' : 'Owned desktop transport smoke test. Reply exactly WATCHDOG_DESKTOP_OK. Do not use tools, run commands, change files or do any other work.', text_elements: [] }] }, context: { inheritThreadSettings: true } } }, snapshot.owner);
      const turnId = response.result?.result?.turn?.id;
      if (!isUuid(turnId)) throw new Error('desktop-send-unconfirmed');
      receipt.confirmedTurnId = turnId; console.log(JSON.stringify({ step: 'native-send-accepted', ...receipt }));
      const deadline = Date.now() + 90000;
      while (Date.now() < deadline) {
        await pause(1000); const { state } = await desktop.snapshot(id); const turn = latestTurn(state);
        if (turn?.turnId !== turnId || turn.status === 'inProgress') continue;
        receipt.turnStatus = turn.status; receipt.errorCode = turn.error?.codexErrorInfo;
        receipt.sameMessageId = turn.params?.clientUserMessageId === messageId;
        if (goal) {
          const persisted = (await account.request('thread/goal/get', { threadId: id })).goal;
          // Native desktop clears a completed Goal after keeping its completion
          // snapshot for the UI; null storage alone is not proof of completion.
          receipt.finalGoalStatus = persisted?.status ?? state.completedThreadGoal?.status ?? null;
          receipt.nativeClearedCompletedGoal = persisted == null && state.completedThreadGoal?.status === 'complete';
        }
        receipt.ok = turn.status === 'completed' && receipt.sameMessageId && (!goal || receipt.finalGoalStatus === 'complete'); break;
      }
      if (!receipt.ok) throw new Error('native-fixture-did-not-complete');
    } catch (error) { receipt.error = error.message; process.exitCode = 1; }
    finally {
      if (creator) await creator.close();
      if (id) {
        desktop.unfollow(id);
        try {
          // This event targets only the agent-owned fixture created above, never
          // an existing user chat. Let its native owner release the writer first.
          desktop.send({ type: 'broadcast', sourceClientId: desktop.clientId, method: 'thread-archived', version: 2, params: { hostId: 'local', conversationId: id } });
          await pause(500);
          if (goal) await account.raw('thread/goal/clear', { threadId: id });
          await account.raw('thread/archive', { threadId: id }); receipt.fixtureArchived = true;
        }
        catch (error) { receipt.fixtureArchived = false; receipt.cleanupError = error.message; }
      }
      receipts.push(receipt); fs.writeFileSync(path.join(directory, 'receipt.json'), JSON.stringify({ receipts, ok: receipts.every((r) => r.ok) }, null, 2));
      console.log(JSON.stringify(receipt));
    }
    if (!receipt.ok) break;
  }
} finally {
  if (process.argv[3] && isUuid(process.argv[3])) navigate(process.argv[3]);
  desktop.close(); await account.close();
  console.log(JSON.stringify({ directory, ok: receipts.length === 2 && receipts.every((r) => r.ok) }));
}
