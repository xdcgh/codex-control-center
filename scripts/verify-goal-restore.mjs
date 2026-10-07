// A bounded, owned fixture. Never resumes or modifies an existing desktop task.
import fs from 'node:fs';
import path from 'node:path';
import { AccountClient } from '../src/rpc.mjs';
import { goalIdentity } from '../src/policy.mjs';

const config = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const directory = path.resolve(import.meta.dirname, '../../diagnostics', `watchdog-goal-smoke-${Date.now()}`);
fs.mkdirSync(directory, { recursive: true });
const owner = new AccountClient({ ...config, timeoutMs: 30000 });
const editor = new AccountClient({ ...config, timeoutMs: 30000 });
const notifications = [];
owner.onNotification = (message) => {
  if (['turn/started', 'turn/completed', 'thread/goal/updated'].includes(message.method)) {
    notifications.push({ method: message.method, turnId: message.params?.turn?.id,
      status: message.params?.turn?.status ?? message.params?.goal?.status,
      errorCode: message.params?.turn?.error?.codexErrorInfo });
  }
};
let id;
let receipt = { directory, ok: false };
try {
  await owner.start(); await editor.start();
  const thread = await owner.raw('thread/start', { cwd: directory, model: 'gpt-6.1-sol',
    sandbox: 'read-only', approvalPolicy: 'never', threadSource: 'agent' });
  id = thread.thread.id;
  const before = (await owner.raw('thread/goal/set', { threadId: id,
    objective: 'Isolated watchdog verification: read get_goal, confirm the goal is active, then mark this goal complete and reply WATCHDOG_GOAL_OK. Do not run commands, edit files, use connectors, or do any other work.',
    status: 'usageLimited', tokenBudget: 2500 })).goal;
  console.log(JSON.stringify({ step: 'fixture-created', threadId: id, status: before.status }));
  const restored = (await editor.request('thread/goal/set', { threadId: id, status: 'active' })).goal;
  const observed = (await owner.request('thread/goal/get', { threadId: id })).goal;
  if (goalIdentity(before) !== goalIdentity(restored) || observed.status !== 'active' || restored.tokensUsed !== before.tokensUsed) throw new Error('goal-restore-did-not-preserve-identity');
  console.log(JSON.stringify({ step: 'non-owner-goal-restore-confirmed', status: observed.status }));
  await owner.raw('turn/start', { threadId: id, effort: 'low', input: [{ type: 'text',
    text: 'Complete only the isolated watchdog verification goal above. Use get_goal to verify it is active, mark it complete with update_goal, and reply exactly WATCHDOG_GOAL_OK. Do not run commands or modify files.', text_elements: [] }] });
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline && !notifications.some((n) => n.method === 'turn/completed')) await new Promise((resolve) => setTimeout(resolve, 500));
  const after = (await owner.request('thread/goal/get', { threadId: id })).goal;
  receipt = { ...receipt, threadId: id, ok: after?.status === 'complete',
    beforeStatus: before.status, restoredStatus: restored.status, afterStatus: after?.status,
    goalIdentityPreserved: goalIdentity(before) === goalIdentity(restored),
    budgetPreserved: before.tokenBudget === restored.tokenBudget,
    usagePreservedAtRestore: before.tokensUsed === restored.tokensUsed, notifications };
  if (!receipt.ok) throw new Error('goal-smoke-did-not-complete');
} catch (error) { receipt.error = error.message; process.exitCode = 1; }
finally {
  if (id) {
    try { await owner.raw('thread/goal/clear', { threadId: id }); await owner.raw('thread/archive', { threadId: id }); receipt.fixtureArchived = true; }
    catch { receipt.fixtureArchived = false; }
  }
  fs.writeFileSync(path.join(directory, 'receipt.json'), JSON.stringify(receipt, null, 2));
  await editor.close(); await owner.close();
  console.log(JSON.stringify(receipt));
}
