import {localizeOwnedValue} from "./i18n-core";
import {t, display, locale, numberText, dateText, errorText, useLocale, setLocalePreferences} from "./i18n";
import PageBoundary from "./PageBoundary";
import { RuntimeDiagnostics } from "./RuntimeDiagnostics";
import { DatabaseRecovery } from "./DatabaseRecovery";
import { StatisticsComparison, PerformanceComparison } from "./StatisticsComparison";
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import "./style.css";
import { quotaMetrics } from './quota-metrics.mjs';
import PricingSettings from './PricingSettings';
import ThreadDetails from './ThreadDetails';

type WindowQuota = {
  durationMinutes: number;
  usedPercent: number | null;
  remainingPercent: number | null;
  resetsAt: number | null;
};
type Policy = {
  nextAttemptAt?:number;
  allowAutomaticStart: boolean;
  cooldownSeconds: number;
  order: number;
  autoResume: boolean;
  manualPaused: boolean;
  neverAutoResume: boolean;
  priority: number;
  retryCount: number;
  maxRetries: number;
};
type Task = {
  threadId: string;
  phase: string;
  reason: string;
  kind: string;
  title: string | null;
  workspace: string | null;
  modelId: string | null;
  reasoningEffort: string | null;
  serviceTier: string | null;
  lastActivityAt: number;
  failedAt?: number;
  lastTurnId?: string;
  policy: Policy;
  repository?:string|null;currentTurnId?:string|null;currentTurnStatus?:string|null;turnStartedAt?:number|null;turnEndedAt?:number|null;modelContextWindow?:number|null;collaborationMode?:string|null;runtimeType?:string|null;runtimeFlags?:string[];metadataSource?:string;nextRecoveryCheckAt?:number;quotaAttribution?:{status:string;reason:string};
};
type Snapshot = {
  mode: string;
  settings: {
    autoResume: boolean;
    recoveryPollSeconds: number;
    historySampleSeconds: number;
    maxConcurrentResumes: number;
    reservePercent: number;
  maxRetries: number;
  nextAttemptAt?:number;
    cooldownSeconds: number;
  };
  compatibility: {
    verified: boolean;
    cliVersion: string | null;
    desktopVersion: string | null;
    status: string;
  };
  quota: {
    known: boolean;
    ready: boolean;
    reason: string;
    windows: WindowQuota[];
    planType: string | null;
    credits: Record<string, unknown> | null;
  } | null;
  tasks: Task[];
  lastQuotaPollAt: number | null;
  nextQuotaPollAt: number;
  lastError: string | null;
};
type Prefs = {
  language?: "auto" | "zh-CN" | "en";
  systemLocale?: string | null;
  resolvedLocale?: "zh-CN" | "en";
  theme: "dark" | "light";
  privacy: boolean;
  widgetExpanded: boolean;
  widgetLocked: boolean;
  widgetOpacity: number;
  widgetPinned: boolean;
  notifications: boolean;
  notificationTypes?:Record<string,boolean>;
  widgetVisible: boolean;
};
type Sample = {
  timestamp: number;
  window: number;
  used_percent: number;
  remaining_percent: number;
  reset_at: number | null;
  pointKind?: string;
  sourceCountQuality?: string;
};
const request = <T,>(method: string, params: unknown = {}): Promise<T> =>
  invoke("core_request", { method, params });
const number = (value: unknown, digits = 0) =>
  typeof value === "number" && Number.isFinite(value)
    ? numberText(value,digits)
    : t("Unavailable");
const date = (value: number | null | undefined) =>
  value ? dateText(value) : t("Unavailable");
const time = (value: number | null | undefined) =>
  value
    ? new Date(value).toLocaleTimeString(locale(), {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : t("Unavailable");
function countdown(reset: number | null | undefined, now: number) {
  if (!reset) return t("Unavailable");
  const seconds = Math.max(0, Math.floor((reset - now) / 1000));
  return t("{hours}h {minutes}m {seconds}s",{hours:numberText(Math.floor(seconds/3600)),minutes:numberText(Math.floor((seconds%3600)/60)),seconds:numberText(seconds%60)});
}
const phases: Record<string, string> = {
  watching: "Working",
  waitingQuota: "Waiting for quota",
  needsAttention: "Needs attention",
  needsUser: "Needs user",
  inactive: "Stopped",
  dispatching: "Resuming",
};
function status(task: Task) {
  if(task.reason==='goal-paused'||task.reason==='manually-interrupted')return t("Manual paused");
  if(task.reason==='non-quota-error')return t("Error");
  if(task.reason==='goal-user-confirmation')return t("Needs user");
  if(task.reason==='goal-complete'||task.reason==='goal-completed')return t("Completed");
  if(task.phase==='watching'&&['runtime-waiting','goal-between-turns','desktop-loading','latest-turn-unavailable'].includes(task.reason))return t("Waiting");
  if (task.phase === "inactive" && task.reason === "completed")
    return t("Completed");
  return display(phases[task.phase] ?? task.phase);
}

function App() {
  useLocale();
  const view = new URLSearchParams(location.search).get("view");
  const small = !!view;
  const [s, setSnapshot] = useState<Snapshot | null>(null),
    [prefs, setPrefs] = useState<Prefs | null>(null),
    [page, setPage] = useState("Dashboard"),
    [error, setError] = useState<string | null>(null),
    [now, setNow] = useState(Date.now()),
    [busy, setBusy] = useState(false);
  const action = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      setError(null);
      const latest = await request<Snapshot>("snapshot");
      setSnapshot(latest);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  const preference = async (update: Partial<Prefs>) => {
    try {
      const value = await invoke<Prefs>("ui_preferences", { update });setLocalePreferences(value);setPrefs(value);
    } catch (e) {
      setError(String(e));
    }
  };
  useEffect(() => {
    void (async()=>{for(let i=0;i<200;i++){try{return await invoke<Prefs>('ui_preferences');}catch(e){if(!String(e).includes('app-starting'))throw e;await new Promise(resolve=>setTimeout(resolve,50));}}throw new Error('app-starting-timeout');})().then(value=>{setLocalePreferences(value);setPrefs(value);}).catch(e=>setError(String(e)));
    void request<Snapshot>("snapshot")
      .then(setSnapshot)
      .catch((e) => {const reason=String(e);setError(reason);if(/owner-anchor|configuration|binding|resources-unavailable/.test(reason))setPage('Diagnostics');});
    const registrations = [
      listen<Snapshot>("core/snapshot", (event) => {
        setSnapshot(event.payload);
        setError(null);
      }),
      listen<{ reason: string }>("core/disconnected", (event) =>
        setError(event.payload.reason),
      ),
      listen<Prefs>("preferences/updated", (event) => {setLocalePreferences(event.payload);setPrefs(event.payload);}),
      listen<string>("navigate", (event) => setPage(event.payload)),
    ];
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(clock);
      for (const registration of registrations)
        void registration.then((unlisten) => unlisten());
    };
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = prefs?.theme ?? "dark";
    document.documentElement.dataset.view = view ?? "main";
    if (small && prefs) {
      void getCurrentWindow().setAlwaysOnTop(prefs.widgetPinned).catch(e=>setError(String(e)));
      if (view === "widget")
        void getCurrentWindow().setSize(
          new LogicalSize(310, prefs.widgetExpanded ? 360 : 260),
        );
    }
  }, [prefs, view, small]);
  const quota = (minutes: number) =>
    s?.quota?.windows?.find((w) => w.durationMinutes === minutes);
  const running = s?.tasks.filter(
    (t) =>
      t.phase === "watching" &&
      ["running", "continuation-accepted"].includes(t.reason),
  ).length;
  const waiting = s?.tasks.filter((t) => t.phase === "waitingQuota").length;
  const open = (label: string) => invoke("show_window", { label });
  if (small)
    return (
      <main className="mini" style={{ opacity: prefs?.widgetOpacity ?? 1 }}>
        <header
          className="mini-header"
          onMouseDown={(event) => {
            if((event.target as Element).closest('button'))return;
            if (event.button === 0 && !prefs?.widgetLocked)
              void getCurrentWindow().startDragging().catch(e=>setError(String(e)));
          }}
        >
          <span className="logo">C</span>
          <strong>Codex</strong>
          <span className={`dot ${s?.quota?.ready ? "good" : "amber"}`} />
          <button
            title={t("Hide widget")}
            onClick={() => {
              void getCurrentWindow().hide();
              void preference({ widgetVisible: false });
            }}
          >
            ×
          </button>
        </header>
        <div className="mini-body">
          {[300, 10080].map((minutes) => (
            <MiniQuota
              key={minutes}
              q={quota(minutes)}
              label={minutes === 300 ? "5h" : "7d"}
            />
          ))}
          <div className="mini-counts">
            <span>
              <b>{number(running)}</b> {t("Running")}
            </span>
            <span>
              <b>{number(waiting)}</b> {t("Waiting")}
            </span>
          </div>
          <p className="caption ellipsis">{s?.tasks.find(t=>t.phase==='watching')?.modelId??t("Model unavailable")} {t("· Turn output: Unavailable")}</p>
          {prefs?.widgetExpanded || view === "compact" ? (
            <>
              <p className="caption">
                {t("5h reset in")} {countdown(quota(300)?.resetsAt, now)}
              </p>
              <p className="caption">
                {t("7d reset in")} {countdown(quota(10080)?.resetsAt, now)}
              </p>
              <p className="mini-task">
                {s?.tasks.find((t) => t.phase === "watching")?.modelId ??
                  t("Model unavailable")}
              </p>
              {!prefs?.privacy && s?.tasks[0]?.title && (
                <p className="caption ellipsis">{s.tasks[0].title}</p>
              )}
              <span className="quality">{t("Token rate: Unavailable")}</span>
            </>
          ) : null}
          {error && <p className="error small">{errorText(error)}</p>}
        </div>
        <footer className="mini-footer">
          <button onClick={() => void open("main").catch(e=>setError(String(e)))}>{t("Dashboard ↗")}</button>
          <button
            title={t("Expand")}
            onClick={() =>
              void preference({ widgetExpanded: !prefs?.widgetExpanded })
            }
          >
            {prefs?.widgetExpanded?t("Compact"):t("Expand")}
          </button>
          <button
            title={t("Lock position")}
            onClick={() =>
              void preference({ widgetLocked: !prefs?.widgetLocked })
            }
          >
            {prefs?.widgetLocked ? t("Locked") : t("Drag")}
          </button>
          <button
            title={t("Pin on top")}
            onClick={() =>
              void preference({ widgetPinned: !prefs?.widgetPinned })
            }
          >
            {prefs?.widgetPinned ? t("Pinned") : t("Pin")}
          </button>
        </footer>
      </main>
    );
  return (
    <div className="shell">
      <aside>
        <a className="brand">
          <span className="logo">C</span>
          <span>
            Codex
            <br />
            <small>{t("Control Center")}</small>
          </span>
        </a>
        <div className="nav-label">{t("WORKSPACE")}</div>
        <nav>
          {[
            "Dashboard",
            "Threads",
            "Quota",
            "Tokens",
            "Performance",
            "Pricing",
            "Settings",
            "Diagnostics",
          ].map((name, i) => (
            <button
              className={page === name ? "selected" : ""}
              key={name}
              onClick={() => setPage(name)}
            >
              <span>{["◈", "☷", "⌁", "◇", "◴", "⚙", "⌘"][i]}</span>
              {display(name)}
              {name === "Threads" && waiting ? <small>{number(waiting)}</small> : null}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <span className="local-badge">{t("● LOCAL FIRST")}</span>
          <p>
            {t("No cloud analytics.")}
            <br />
            {t("Your data stays on this PC.")}
          </p>
          <small>{t("Unofficial · Not affiliated with OpenAI")}</small>
        </div>
      </aside>
      <section className="workspace">
        <header className="topbar">
          <span>
            <span className={`dot ${s && !error ? "good" : "amber"}`} />
            {s && !error
              ? t("Background owner connected")
              : t("Connecting to background owner")}
          </span>
          <div>
            <button
              onClick={() => void preference({ privacy: !prefs?.privacy })}
            >
              {prefs?.privacy ? t("Privacy on") : t("Privacy mode")}
            </button>
            <button
              onClick={() => {
                void open("widget").catch(e=>setError(String(e)));
                void preference({ widgetVisible: true });
              }}
            >
              {t("Show widget")}
            </button>
            <button
              disabled={busy}
              onClick={() => void action(() => request("refresh"))}
            >
              {t("↻ Refresh")}
            </button>
          </div>
        </header>
        <div className="content"><PageBoundary key={page} page={display(page)}>
          <div className="page-heading">
            <div>
              <p className="eyebrow">CODEX / {display(page)}</p>
              <h1>{display(page)}</h1>
            </div>
            <span className="updated">
              {t("Last quota check")} {time(s?.lastQuotaPollAt)}
            </span>
          </div>
          {error && <div className="banner error">{errorText(error)}</div>}
          {s?.compatibility && !s.compatibility.verified && (
            <div className="banner warning">
              {t("Compatibility not verified. Quota monitoring continues; automatic recovery is in safe mode.")}
            </div>
          )}
          {page === "Dashboard" && (
            <>
              <div className="quota-grid">
                {[300, 10080].map((minutes) => (
                  <QuotaCard
                    key={minutes}
                    q={quota(minutes)}
                    title={minutes === 300 ? t("5-hour window") : t("7-day window")}
                    now={now}
                  />
                ))}
              </div>
              <div className="metric-grid">
                <Metric
                  label={t("Running threads")}
                  value={number(running)}
                  note={t("Observed in Codex Desktop")}
                />
                <Metric
                  label={t("Waiting for quota")}
                  value={number(waiting)}
                  note={t("Next check in {seconds}s",{seconds:s?numberText(Math.max(0,Math.ceil((s.nextQuotaPollAt-now)/1000))):"—"})}
                />
                <Metric
                  label={t("Recovery engine")}
                  value={
                    s?.settings.autoResume
                      ? t("Enabled")
                      : s
                        ? t("Paused")
                        : t("Unavailable")
                  }
                  note={
                    s?.mode === "execute"
                      ? t("Fresh state checked before every resume")
                      : t("Read-only observation mode")
                  }
                />
                <Metric
                  label={t("Account plan")}
                  value={s?.quota?.planType ?? t("Unavailable")}
                  note={
                    s?.quota?.credits
                      ? t("Credits: {credits}",{credits:typeof s.quota.credits.balance==="number"?numberText(s.quota.credits.balance):String(s.quota.credits.balance??t("Unavailable"))})
                      : t("Account identity remains private")
                  }
                />
              </div>
              <section className="panel">
                <div className="panel-heading">
                  <h2>{t("Active work")}</h2>
                  <button onClick={() => setPage("Threads")}>
                    {t("All threads →")}
                  </button>
                </div>
                <ThreadList
                  tasks={s?.tasks ?? []}
                  prefs={prefs}
                  s={s}
                  action={action}
                  compact
                />
              </section>
              <div className="version-strip">
                <span>
                  Codex CLI {s?.compatibility.cliVersion ?? t("Unavailable")}
                </span>
                <span>
                  Desktop {s?.compatibility.desktopVersion ?? t("Unavailable")}
                </span>
                <span>
                  {display(s?.compatibility.status ?? t("Compatibility not checked"))}
                </span>
              </div>
            </>
          )}
          {page === "Threads" && (
            <section className="panel">
              <div className="panel-heading">
                <h2>{t("Thread & Goal registry")}</h2>
                <span className="quality">
                  {t("Original threads · No mouse automation")}
                </span>
              </div>
              <ThreadList
                tasks={s?.tasks ?? []}
                prefs={prefs}
                s={s}
                action={action}
              />
            </section>
          )}
          {page === "Quota" && <QuotaHistory now={now} />}
          {page === 'Pricing' && <PricingSettings/>}
            {page === "Tokens" && (
            <TokenAnalytics privacy={prefs?.privacy ?? false} />
          )}
          {page === "Performance" && <Performance />}
          {page === "Settings" && (
            <Settings
              s={s}
              prefs={prefs}
              preference={preference}
              action={action}
            />
          )}
          {page === "Diagnostics" && <Diagnostics s={s} action={action} />}
        </PageBoundary>
        </div>
      </section>
    </div>
  );
}

function MiniQuota({
  q,
  label,
}: {
  q: WindowQuota | undefined;
  label: string;
}) {
  return (
    <div className="mini-quota">
      <b>{display(label)}</b>
      <div className={`meter ${q?.remainingPercent==null?"unknown":""}`} aria-label={q?.remainingPercent==null?t("Unavailable"):undefined}>
        <i style={{ width: q?.remainingPercent == null ? undefined : `${q.remainingPercent}%` }} />
      </div>
      <span>
        {q?.remainingPercent != null ? `${number(q.remainingPercent)}%` : "—"}
      </span>
    </div>
  );
}
function QuotaCard({
  q,
  title,
  now,
}: {
  q: WindowQuota | undefined;
  title: string;
  now: number;
}) {
  const remaining = q?.remainingPercent;
  const elapsed =
    q?.resetsAt && q.resetsAt > now
      ? Math.max(
          0,
          Math.min(
            100,
            100 - ((q.resetsAt - now) / (q.durationMinutes * 60000)) * 100,
          ),
        )
      : null;
  return (
    <section className="quota-card">
      <div className="panel-heading">
        <h2>{title}</h2>
        <span
          className={`pill ${remaining != null && remaining <= 10 ? "amber" : ""}`}
        >
          {remaining == null
            ? t("Unavailable")
            : remaining <= 0
              ? t("Exhausted")
              : t("Available")}
        </span>
      </div>
      <div className="quota-main">
        <div>
          <span className="big-number">
            {remaining == null ? "—" : number(remaining)}
            {remaining != null && <small>%</small>}
          </span>
          <p>{remaining == null ? t("Unavailable") : t("remaining")}</p>
        </div>
        <div
          className="ring"
          style={{
            background:
              remaining == null
                ? "var(--border)"
                : `conic-gradient(var(--accent) ${remaining * 3.6}deg,var(--border) 0deg)`,
          }}
        >
          <div>
            <b>{q?.usedPercent != null ? `${number(q.usedPercent)}%` : "—"}</b>
            <small>{t("used")}</small>
          </div>
        </div>
      </div>
      <p className="caption">
        {elapsed == null
          ? t("Window progress unavailable")
          : t("{percent}% of window time elapsed",{percent:number(elapsed)})}
        {elapsed != null &&
          q?.usedPercent != null &&
          q.usedPercent > elapsed + 10 && (
            <span className="budget-ahead">
              {" "}
              {t("· Usage ahead of uniform time budget")}
            </span>
          )}
      </p>
      <div className="card-footer">
        <span>
          {t("Resets in")} <b>{countdown(q?.resetsAt, now)}</b>
        </span>
        <small>{date(q?.resetsAt)}</small>
      </div>
    </section>
  );
}
function Metric({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note: string;
}) {
  return (
    <section className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </section>
  );
}
function ThreadList({
  tasks,
  prefs,
  s,
  action,
  compact = false,
}: {
  tasks: Task[];
  prefs: Prefs | null;
  s: Snapshot | null;
  action: (fn: () => Promise<unknown>) => Promise<void>;
  compact?: boolean;
}) {
  const displayed=(compact?tasks.filter(task=>task.phase!=='inactive'):[...tasks]).sort((a,b)=>{const order=['watching','dispatching','waitingQuota','needsUser','needsAttention','inactive'];return order.indexOf(a.phase)-order.indexOf(b.phase)||(b.lastActivityAt??0)-(a.lastActivityAt??0);});
  if (!displayed.length)
    return (
      <div className="empty">
        <span>☷</span>
        <h3>{t("No enrolled threads yet")}</h3>
        <p>
          {t("Active local root threads and quota-stopped work appear here when observed.")}
        </p>
      </div>
    );
  return (
    <div className="thread-list">
      {displayed.map((task) => (
        <article className="thread" key={task.threadId}>
          <div className="thread-icon">{task.kind === "goal" ? "◎" : "↳"}</div>
          <div className="thread-main">
            <h3>
              {prefs?.privacy
                ? t("Private task")
                : (task.title ?? t("Title unavailable"))}
              <span className="kind">
                {task.kind === "goal" ? t("Goal") : t("Thread")}
              </span>
            </h3>
            <div className="thread-meta">
              <span>{task.modelId ?? t("Model unavailable")}</span>
              <span>{task.reasoningEffort ?? t("Effort unavailable")}</span>
              <span>{task.serviceTier ?? t("Tier unavailable")}</span>
              {!prefs?.privacy && (
                <span className="ellipsis">
                  {task.workspace ?? t("Workspace unavailable")}
                </span>
              )}
            </div>
            <span className="thread-id">
              {prefs?.privacy ? t("ID hidden") : task.threadId}
            </span>
            {!compact && (
              <p className="caption">
                {t("Last observed")} {time(task.lastActivityAt)} {t("· Retries")}{" "}
                {number(task.policy.retryCount)}/{number(task.policy.maxRetries)} ·{" "}
                {localizeOwnedValue("taskReason",task.reason,locale())}
              </p>
            )}
            {!compact&&<ThreadDetails task={task} privacy={prefs?.privacy??true}/>}
          </div>
          <div className="thread-controls">
            <span
              className={`pill ${task.phase === "waitingQuota" ? "amber" : task.phase === "needsAttention" ? "red" : ""}`}
            >
              {status(task)}
            </span>
            {!compact && (
              <>
                <span className="quality">
                  {task.policy.neverAutoResume?t("Automatic recovery forbidden"):task.policy.manualPaused?t("Automatic recovery paused"):!task.policy.autoResume?t("Automatic recovery off"):!task.policy.allowAutomaticStart?t("Automatic starts blocked"):t("Automatic recovery allowed")}
                </span>
                <select
                  aria-label={t("Priority")}
                  value={task.policy.priority}
                  onChange={(e) =>
                    void action(() =>
                      request("thread/policy", {
                        threadId: task.threadId,
                        update: { priority: Number(e.target.value) },
                      }),
                    )
                  }
                >
                  {[t("P0 Critical"), t("P1 High"), t("P2 Normal"), t("P3 Background")].map(
                    (p, i) => (
                      <option key={p} value={i}>
                        {display(p)}
                      </option>
                    ),
                  )}
                </select>
                <div className="button-row">
                  <button
                    onClick={() =>
                      void action(() =>
                        request("thread/policy", {
                          threadId: task.threadId,
                          update: { autoResume: !task.policy.autoResume },
                        }),
                      )
                    }
                  >
                    {t("Auto")} {task.policy.autoResume ? t("on") : t("off")}
                  </button>
                  <button
                    onClick={() =>
                      void action(() =>
                        request("thread/policy", {
                          threadId: task.threadId,
                          update: { manualPaused: !task.policy.manualPaused },
                        }),
                      )
                    }
                  >
                    {task.policy.manualPaused
                      ? t("Unpause auto recovery")
                      : t("Pause auto recovery")}
                  </button>
                  <button
                    disabled={
                      task.phase !== "waitingQuota" ||
                      !s?.quota?.ready ||
                      s.mode !== "execute"
                    }
                    onClick={() =>
                      void action(() =>
                        request("thread/resume", { threadId: task.threadId }),
                      )
                    }
                  >
                    {t("Resume now")}
                  </button>
                  <button
                    onClick={() =>
                      void action(() =>
                        request("thread/policy", {
                          threadId: task.threadId,
                          update: {
                            neverAutoResume: !task.policy.neverAutoResume,
                          },
                        }),
                      )
                    }
                  >
                    {task.policy.neverAutoResume ? t("Allow auto") : t("Never auto")}
                  </button>
                </div>
                <details className="thread-policy-details"><summary>{t("Recovery policy")}</summary><label>{t("Allow automatic start")} <input type="checkbox" checked={task.policy.allowAutomaticStart} onChange={e=>void action(()=>request('thread/policy',{threadId:task.threadId,update:{allowAutomaticStart:e.target.checked}}))}/></label><label>{t("Max retries")} <input type="number" min="1" defaultValue={task.policy.maxRetries} onBlur={e=>void action(()=>request('thread/policy',{threadId:task.threadId,update:{maxRetries:Number(e.target.value)}}))}/></label><label>{t("Cooldown seconds")} <input type="number" min="0" defaultValue={task.policy.cooldownSeconds} onBlur={e=>void action(()=>request('thread/policy',{threadId:task.threadId,update:{cooldownSeconds:Number(e.target.value)}}))}/></label><label>{t("Queue order")} <input type="number" defaultValue={task.policy.order} onBlur={e=>void action(()=>request('thread/policy',{threadId:task.threadId,update:{order:Number(e.target.value)}}))}/></label></details>
              </>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}

function QuotaHistory({ now }: { now: number }) {
  const [range, setRange] = useState(5),
    [samples, setSamples] = useState<Sample[]>([]),
    [error, setError] = useState<string | null>(null);
  useEffect(() => {
    request<{ samples: Sample[] }>("quota/chart", {
      since: Date.now() - range * 3600000,
      until: Date.now(),
      maxPoints: 2000,
    })
      .then((value) => setSamples(value.samples))
      .catch((e) => setError(String(e)));
  }, [range, Math.floor(now / 60000)]);
  const duration = 300;
  const series = samples
    .filter((s) => s.window === duration)
    .sort((a, b) => a.timestamp - b.timestamp);
  const start = now - range * 3600000;
  const points = (window: number) =>
    samples
      .filter((s) => s.window === window)
      .map(
        (s) =>
          `${50 + ((s.timestamp - start) / (range * 3600000)) * 900},${250 - s.remaining_percent * 2}`,
      )
      .join(" ");
  let burn = 0,
    span = 0;
  for (let i = 1; i < series.length; i++) {
    const a = series[i - 1],
      b = series[i];
    if (a.reset_at === b.reset_at && b.used_percent >= a.used_percent) {
      burn += b.used_percent - a.used_percent;
      span += b.timestamp - a.timestamp;
    }
  }
  const hourly = span > 0 ? (burn / span) * 3600000 : null,
    latest = series.at(-1);
  const metrics=quotaMetrics(samples.filter(s=>s.pointKind!=="daily-mean"),duration,now);
  const resetMarkers = [300, 10080].flatMap((window) => {
    const rows = samples.filter((s) => s.window === window);
    return rows.filter(
      (s, i) =>
        i > 0 &&
        (s.used_percent < rows[i - 1].used_percent ||
          s.reset_at !== rows[i - 1].reset_at),
    );
  });
  return (
    <>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>{t("Quota history")}</h2>
            <p className="caption">
              {t("Real local samples · 1-minute default cadence; older retained points are daily means")}
            </p>
          </div>
          <div className="tabs">
            {[
              [5, "5h"],
              [24, "24h"],
              [168, "7d"],
              [720, "30d"],
              [2160, "90d"],
            ].map(([hours, label]) => (
              <button
                key={label}
                className={range === hours ? "active" : ""}
                onClick={() => setRange(Number(hours))}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {error && <p className="error">{error}</p>}
        {samples.some(s=>s.pointKind==="daily-mean")&&<p className="banner">{t("Partial historical precision: daily means summarize whole retained days, including days partially outside this range. They are not exact observations or current-speed inputs.")}</p>}
        {samples.length ? (
          <>
            <svg
              viewBox="0 0 1000 300"
              className="history-chart"
              role="img"
              aria-label={t("Observed remaining quota over time")}
            >
              {[0, 25, 50, 75, 100].map((v) => (
                <g key={v}>
                  <line
                    x1="50"
                    x2="950"
                    y1={250 - v * 2}
                    y2={250 - v * 2}
                    className="gridline"
                  />
                  <text x="8" y={255 - v * 2}>
                    {number(v)}%
                  </text>
                </g>
              ))}
              {resetMarkers.map((s) => (
                <line
                  key={`${s.window}:${s.timestamp}`}
                  x1={50 + ((s.timestamp - start) / (range * 3600000)) * 900}
                  x2={50 + ((s.timestamp - start) / (range * 3600000)) * 900}
                  y1="40"
                  y2="260"
                  className="reset-marker"
                />
              ))}
              {samples.filter(s=>s.pointKind==="daily-mean").map(s=><circle key={`mean:${s.window}:${s.timestamp}`} cx={50+((s.timestamp-start)/(range*3600000))*900} cy={250-s.remaining_percent*2} r="4" fill="none" stroke="currentColor"><title>{t("Daily mean ·")} {s.sourceCountQuality??t("aggregate precision")}</title></circle>)}
              <polyline points={points(300)} className="series five" />
              <polyline points={points(10080)} className="series week" />
              <text x="50" y="290">
                {date(start)}
              </text>
              <text x="760" y="290">
                {t("Now")}
              </text>
            </svg>
            <div className="legend">
              <span className="five">{t("● 5h remaining")}</span>
              <span className="week">{t("● 7d remaining")}</span>
              <span>{t("┆ Observed reset or window change")}</span>
            </div>
          </>
        ) : (
          <div className="empty">
            <span>⌁</span>
            <h3>{t("No history in this range yet")}</h3>
            <p>
              {t("Samples accumulate locally while the background owner reads real quota.")}
            </p>
          </div>
        )}
      </section>
      <div className="metric-grid">
        <Metric
          label={t("Current 5h window average / hour")}
          value={metrics.currentAverage == null ? t("Unavailable") : `${number(metrics.currentAverage, 2)}%`}
          note={t("Used quota divided by elapsed current-window time")}
        />
        <Metric
          label={t("Projected exhaustion")}
          value={
            metrics.resetFirst?t("Reset expected first"):metrics.forecastAt?date(metrics.forecastAt):t("Unavailable")
          }
          note={t("Estimated from the current reset segment; reset caps the projection")}
        />
        <Metric
          label={t("Recent 15-minute burn / hour")}
          value={metrics.recentRate==null?t("Unavailable"):`${number(metrics.recentRate,2)}%`}
          note={t("Latest observed trend within the same reset segment")}
        />
        <Metric
          label={t("Selected-range average / hour")}
          value={metrics.selectedRangeBurn==null?t("Unavailable"):`${number(metrics.selectedRangeBurn,2)}%`}
          note={t("{samples} retained samples · {changes} window changes",{samples:number(samples.length),changes:number(resetMarkers.length)})}
        />
      </div>
    </>
  );
}

function Settings({
  s,
  prefs,
  preference,
  action,
}: {
  s: Snapshot | null;
  prefs: Prefs | null;
  preference: (v: Partial<Prefs>) => Promise<void>;
  action: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const [autostart, setAutostart] = useState(false);
  const [notificationResult,setNotificationResult]=useState<"sent"|"disabled"|null>(null),[notificationBusy,setNotificationBusy]=useState(false);
  useEffect(() => {
    void action(async()=>setAutostart(await invoke<boolean>("get_autostart")));
  }, []);
  const set = (key: string, value: unknown) =>
    action(() => request("settings/update", { [key]: value }));
  return (
    <div className="settings-grid">
      <section className="panel">
        <h2>{t("Recovery & scheduling")}</h2>
        <Setting
          title={t("Automatic recovery")}
          detail={t("Resume eligible quota-stopped work after a fresh quota and thread check")}
        >
          <input
            type="checkbox"
            checked={s?.settings.autoResume ?? false}
            onChange={(e) => void set("autoResume", e.target.checked)}
          />
        </Setting>
        <Setting
          title={t("Quota check interval")}
          detail={t("Independent from history sampling")}
        >
          <select
            value={s?.settings.recoveryPollSeconds ?? 10}
            onChange={(e) =>
              void set("recoveryPollSeconds", Number(e.target.value))
            }
          >
            {[5, 10, 30, 60].map((v) => (
              <option key={v} value={v}>
                {number(v)} {t("seconds")}
              </option>
            ))}
          </select>
        </Setting>
        <Setting title={t("History sample interval")} detail={t("Default 60 seconds")}>
          <input
            type="number"
            min="60"
            defaultValue={s?.settings.historySampleSeconds ?? 60}
            onBlur={(e) =>
              void set("historySampleSeconds", Number(e.target.value))
            }
          />
        </Setting>
        <Setting
          title={t("Maximum simultaneous recoveries")}
          detail={t("Running resumes occupy a slot until a terminal turn is observed")}
        >
          <input
            type="number"
            min="1"
            max="20"
            defaultValue={s?.settings.maxConcurrentResumes ?? 1}
            onBlur={(e) =>
              void set("maxConcurrentResumes", Number(e.target.value))
            }
          />
        </Setting>
        <Setting
          title={t("Reserve for manual work")}
          detail={t("Quota reserve (five-hour window when reported; otherwise reported windows)")}
        >
          <input
            type="number"
            min="0"
            max="99"
            defaultValue={s?.settings.reservePercent ?? 10}
            onBlur={(e) => void set("reservePercent", Number(e.target.value))}
          />
        </Setting>
        <Setting
          title={t("Maximum safe retries")}
          detail={t("An uncertain delivery is never replayed")}
        >
          <input
            type="number"
            min="1"
            defaultValue={s?.settings.maxRetries ?? 3}
            onBlur={(e) => void set("maxRetries", Number(e.target.value))}
          />
        </Setting>
        <Setting
          title={t("Retry cooldown")}
          detail={t("Applies only to confirmed pre-send failures")}
        >
          <input
            type="number"
            min="0"
            defaultValue={s?.settings.cooldownSeconds ?? 30}
            onBlur={(e) => void set("cooldownSeconds", Number(e.target.value))}
          />
        </Setting>
      </section>
      <section className="panel">
        <h2>{t("Desktop preferences")}</h2>
        <Setting title={t("Language")} detail={t("Apply immediately to all windows, tray and notifications")}><select value={prefs?.language??"auto"} onChange={e=>void preference({language:e.target.value as Prefs["language"]})}><option value="auto">{t("Automatic (system language)")}</option><option value="zh-CN">中文</option><option value="en">English</option></select></Setting>
        <Setting
          title={t("Start with Windows")}
          detail={t("Start the tray app at login")}
        >
          <input
            type="checkbox"
            checked={autostart}
            onChange={(e) =>
              void action(async()=>setAutostart(await invoke<boolean>("set_autostart", {enabled:e.target.checked})))
            }
          />
        </Setting>
        <Setting title={t("Theme")} detail={t("Applies to dashboard and widget")}>
          <select
            value={prefs?.theme ?? "dark"}
            onChange={(e) =>
              void preference({ theme: e.target.value as Prefs["theme"] })
            }
          >
            <option value="dark">{t("Dark")}</option>
            <option value="light">{t("Light")}</option>
          </select>
        </Setting>
        <Setting
          title={t("Privacy mode")}
          detail={t("Hide task names and private workspace paths")}
        >
          <input
            type="checkbox"
            checked={prefs?.privacy ?? false}
            onChange={(e) => void preference({ privacy: e.target.checked })}
          />
        </Setting>
        <Setting
          title={t("Windows notifications")}
          detail={t("Meaningful state changes; no repeat every poll")}
        >
          <input
            type="checkbox"
            checked={prefs?.notifications ?? true}
            onChange={(e) =>
              void preference({ notifications: e.target.checked })
            }
          />
        </Setting>
        <button disabled={notificationBusy} onClick={()=>void action(async()=>{setNotificationBusy(true);setNotificationResult(null);try{const sent=await invoke<boolean>("send_test_notification");setNotificationResult(sent?"sent":"disabled");}finally{setNotificationBusy(false);}})}>{t("Send test notification")}</button>
        {notificationResult&&<p className="caption" role="status">{notificationResult==="sent"?t("Test notification submitted to Windows. This is not a recovery event."):t("Notifications are disabled. No test notification was sent.")}</p>}
        {Object.entries({quotaExhausted:t("Quota exhausted"),taskWaiting:t("Task waiting"),quotaRecovered:t("Quota recovered"),threadResumed:t("Thread auto resumed"),resumeFailed:t("Resume failed / needs attention"),unknownVersion:t("Unknown Codex version"),weeklyLow:t("Weekly quota low"),naturalCycle:t("Completed natural cycle")}).map(([key,title])=><Setting key={key} title={title} detail={t("Notify once on meaningful evidence changes")}><input type="checkbox" disabled={prefs?.notifications===false} checked={prefs?.notificationTypes?.[key]??true} onChange={e=>void preference({notificationTypes:{...prefs?.notificationTypes,[key]:e.target.checked}})}/></Setting>)}
        <Setting title={t("Widget opacity")} detail={t("Compact status transparency")}>
          <input
            type="range"
            min="0.35"
            max="1"
            step="0.05"
            value={prefs?.widgetOpacity ?? 0.95}
            onChange={(e) =>
              void preference({ widgetOpacity: Number(e.target.value) })
            }
          />
        </Setting>
        <Setting title={t("Lock widget position")} detail={t("Prevent dragging")}>
          <input
            type="checkbox"
            checked={prefs?.widgetLocked ?? false}
            onChange={(e) =>
              void preference({ widgetLocked: e.target.checked })
            }
          />
        </Setting>
        <Setting
          title={t("Always on top")}
          detail={t("Pin the widget over other windows")}
        >
          <input
            type="checkbox"
            checked={prefs?.widgetPinned ?? true}
            onChange={(e) =>
              void preference({ widgetPinned: e.target.checked })
            }
          />
        </Setting>
        <p className="caption">
          {t("Closing a window hides it to the tray. Use the tray menu to exit the UI or stop the background service.")}
        </p>
      </section>
    </div>
  );
}
function Setting({
  title,
  detail,
  children,
}: {
  title: string;
  detail: string;
  children: React.ReactNode;
}) {
  return (
    <label className="setting">
      <span>
        <strong>{title}</strong>
        <small>{detail}</small>
      </span>
      {children}
    </label>
  );
}
function Diagnostics({
  s,
  action,
}: {
  s: Snapshot | null;
  action: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const [report, setReport] = useState<unknown>(null),
    [natural, setNatural] = useState<unknown>(null),
    [saved, setSaved] = useState<string | null>(null);
  return (
    <>
      <DatabaseRecovery request={request} />
      <RuntimeDiagnostics request={request}/>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>{t("Compatibility doctor")}</h2>
            <p className="caption">
              {t("Read-only protocol, quota, model and selected thread probes")}
            </p>
          </div>
          <button
            className="primary"
            onClick={() =>
              void action(async () =>
                setReport(
                  await request("doctor", { threadId: s?.tasks[0]?.threadId }),
                ),
              )
            }
          >
            {t("Run doctor")}
          </button>
        </div>
        <div className="diagnostic-grid">
          {Object.entries({
            CLI: s?.compatibility.cliVersion ?? t("Unavailable"),
            Desktop: s?.compatibility.desktopVersion ?? t("Unavailable"),
            Compatibility: display(s?.compatibility.status ?? t("Unavailable")),
            Adapter: t("Official app-server + verified Desktop IPC"),
            QuotaSource: t("Official account/rateLimits/read"),
            Database: t("Local SQLite · WAL"),
            LastQuotaPoll: date(s?.lastQuotaPollAt),
            RecoveryMode: display(s?.mode ?? t("Unavailable")),
          }).map(([key, value]) => (
            <div key={key}>
              <small>{display(key)}</small>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
        {report != null && <pre>{JSON.stringify(report, null, 2)}</pre>}
      </section>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>{t("Export diagnostics")}</h2>
            <p className="caption">
              {t("Safe aggregates only. No auth, prompts, account identity, thread IDs or private paths.")}
            </p>
          </div>
          <button
            onClick={() =>
              void action(async () => {
                const value = await request("diagnostics/export");
                setSaved(await invoke("save_diagnostics", { value }));
              })
            }
          >
            {t("Export redacted report")}
          </button>
        </div>
        {saved && <p className="caption">{t("Saved locally:")} {saved}</p>}
      </section>
      <section className="panel"><div className="panel-heading"><div><h2>{t("Natural quota cycle evidence")}</h2><p className="caption">{t("Recovery episodes and final Goal outcome are separate. An active Goal remains pending even when its recovery succeeded.")}</p></div><button onClick={()=>void action(async()=>setNatural(await request('natural/report')))}>{t("Read real cycle report")}</button></div>{natural!=null&&<pre>{JSON.stringify(natural,null,2)}</pre>}</section>
    </>
  );
}

type AnalyticsGroup = {
  key: unknown;
  ledger: string;
  samples: number;
  tokens: Record<string, number | null>;
  missing: Record<string, number>;
  estimatedUsd: number | null;
  pricingStatus: string;
  pricingReasons: Record<string, number>;
  inputP50?: number;
  inputP95?: number;
  turns?: number;
  cacheHitRatio?: number;
  tokenTotalStatus?: string;
};
const analyticsQuality = (g: AnalyticsGroup) =>
  [
    ...Object.entries(g.pricingReasons ?? {}),
    ...Object.entries(g.missing ?? {}),
  ]
    .filter(([, count]) => count > 0)
    .map(([reason, count]) => `${display(reason)} (${number(count)})`)
    .join(", ") ||
  (g.tokenTotalStatus?display(g.tokenTotalStatus):"") ||
  t("Observed");
const baselineGroup=(g:AnalyticsGroup)=>g.ledger.includes('baseline')||String(g.key).startsWith('Unknown (initial thread counter)');
function TokenAnalytics({ privacy }: { privacy: boolean }) {
  const [groupBy, setGroupBy] = useState("model"),
    [data, setData] = useState<{ groups: AnalyticsGroup[] } | null>(null),
    [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active=true;setData(null);setError(null);
    const load=()=>request<{groups:AnalyticsGroup[]}>('analytics/summary',{groupBy}).then(value=>{if(active){setData(value);setError(null);}}).catch(e=>{if(active)setError(String(e));});
    void load();const timer=setInterval(()=>void load(),30000);return()=>{active=false;clearInterval(timer);};
  }, [groupBy]);
  return (
    <>
      <div className="banner">
        {t("Estimated API-equivalent cost uses public API pricing. It is not the amount charged by the Codex subscription.")}
      </div>
      <StatisticsComparison groups={data?.groups??[]} privacy={privacy} groupBy={groupBy}/>
      <section className="panel">
        <div className="panel-heading">
          <h2>{t("Token usage")}</h2>
          <select value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
            {[
              "model",
              "tier",
              "effort",
              "collaboration",
              "turn",
              "thread",
              "goal",
              "workspace",
              "hour",
              "day",
              "5h",
              "week",
            ].map((value) => (
              <option key={value} value={value}>{display(value)}</option>
            ))}
          </select>
        </div>
        {error ? (
          <p className="error">{error}</p>
        ) : !data ? (<div className="empty"><h3>{t("Loading local token observations…")}</h3><p>{t("Reading real indexed telemetry. No empty result is assumed while the request is pending.")}</p></div>) : data.groups.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{t("Group / ledger")}</th>
                  <th>{t("Input")}</th>
                  <th>{t("Cached")}</th>
                  <th>{t("Cache write")}</th>
                  <th>{t("Output")}</th>
                  <th>{t("Reasoning")}</th>
                  <th>{t("Total")}</th>
                  <th>{t("API equivalent")}</th>
                  <th>{t("Quality")}</th>
                </tr>
              </thead>
              <tbody>
                {data.groups.map((g, i) => (
                  <tr key={i}>
                    <td>
                      {privacy &&
                      ["workspace", "thread", "goal"].includes(groupBy)
                        ? t("Private group")
                        : typeof g.key === "object"
                          ? JSON.stringify(g.key)
                          : baselineGroup(g)?localizeOwnedValue("inventory",String(g.key),locale()):groupBy==="collaboration"?localizeOwnedValue("collaboration",String(g.key),locale()):String(g.key)}
                      <small>{g.ledger}</small>
                    </td>
                    {[
                      "input_tokens",
                      "cached_input_tokens",
                      "cache_write_input_tokens",
                      "output_tokens",
                      "reasoning_output_tokens",
                      "total_tokens",
                    ].map((key) => (
                      <td key={key}>
                        {baselineGroup(g)?t("Not additive"):(g.missing?.[key]??0)>0?t("Unavailable"):number(g.tokens?.[key])}
                        {g.missing?.[key] > 0 && g.missing[key] < g.samples && (
                          <small>{t("Known subtotal")} {number(g.tokens?.[key])}; {number(g.missing[key])}/{number(g.samples)} {t("samples unavailable")}</small>
                        )}
                      </td>
                    ))}
                    <td>
                      {baselineGroup(g)||g.estimatedUsd == null
                        ? t("Unavailable")
                        : `$${number(g.estimatedUsd, 4)}`}
                    </td>
                    <td>
                      <b>{baselineGroup(g)?t("Non-additive inventory"):display(g.pricingStatus)}</b>
                      <small>{baselineGroup(g)?t("Inherited or replayed historical counters; excluded from token consumption and costs"):analyticsQuality(g)}</small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty">
            <h3>{t("No token observations yet")}</h3>
            <p>
              {t("Only actual complete telemetry is counted. Different accounting ledgers remain separate.")}
            </p>
          </div>
        )}
      </section>
    </>
  );
}
type PerformanceData = {
  samples: number;
  metrics: Record<
    string,
    {
      label: string;
      p50: number | null;
      p95: number | null;
      samples: number;
      missing: number;
    }
  >;
  ttft: { status: string; reason: string };
  decode: { status: string; reason: string };
  clock: string;
};
function Performance() {
  const [data, setData] = useState<PerformanceData | null>(null),
    [error, setError] = useState<string | null>(null);
  useEffect(() => {
    request<PerformanceData>("analytics/performance")
      .then(setData)
      .catch((e) => setError(String(e)));
  }, []);
  const metric = (key: string) => data?.metrics[key];
  const value = (key: string) => {
    const amount = metric(key)?.p50;
    return amount == null
      ? t("Unavailable")
      : `${number(key === "effectiveThroughput" ? amount : amount / 1000, 2)} ${key === "effectiveThroughput" ? t("tok/s") : t("s")}`;
  };
  return (
    <>
      <div className="banner">
        {t("Turn-level first-output latency and end-to-end throughput describe the whole agent turn, including model calls and tools. Exact model TTFT and decode speed are unavailable.")}
      </div>
      <div className="metric-grid">
        <Metric
          label={t("Median turn wall time")}
          value={value("wall")}
          note={t("{turns} observed turns",{turns:number(metric("wall")?.samples)})}
        />
        <Metric
          label={t("Median first visible output")}
          value={value("firstVisible")}
          note={t("Turn-level latency · Recorded timestamps")}
        />
        <Metric
          label={t("Median effective throughput")}
          value={value("effectiveThroughput")}
          note={t("Rough end-to-end output · Includes tool time")}
        />
        <Metric
          label={t("Median observed tool time")}
          value={value("tool")}
          note={t("Overlapping tool intervals counted once")}
        />
      </div>
      <PerformanceComparison data={data}/>
      <section className="panel">
        <h2>{t("Observed performance distribution")}</h2>
        {error && <p className="error">{error}</p>}
        {data ? (
          <table>
            <thead>
              <tr>
                <th>{t("Measure")}</th>
                <th>{t("Median")}</th>
                <th>P95</th>
                <th>{t("Observed")}</th>
                <th>{t("Missing")}</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(data.metrics).map(([key, m]) => (
                <tr key={key}>
                  <td>{display(m.label)}</td>
                  <td>
                    {m.p50 == null
                      ? t("Unavailable")
                      : `${number(key === "effectiveThroughput" ? m.p50 : m.p50 / 1000, 2)} ${key === "effectiveThroughput" ? t("tok/s") : t("s")}`}
                  </td>
                  <td>
                    {m.p95 == null
                      ? t("Unavailable")
                      : `${number(key === "effectiveThroughput" ? m.p95 : m.p95 / 1000, 2)} ${key === "effectiveThroughput" ? t("tok/s") : t("s")}`}
                  </td>
                  <td>{number(m.samples)}</td>
                  <td>{number(m.missing)}</td>
                </tr>
              ))}
              <tr>
                <td>{t("Exact model TTFT")}</td>
                <td colSpan={2}>{t("Unavailable")}</td>
                <td colSpan={2}>
                  {t("Inference start and first sampled token are not exposed")}
                </td>
              </tr>
              <tr>
                <td>{t("Exact decode speed")}</td>
                <td colSpan={2}>{t("Unavailable")}</td>
                <td colSpan={2}>
                  {t("Individual model decode timing is not exposed")}
                </td>
              </tr>
            </tbody>
          </table>
        ) : (
          <div className="empty">
            <h3>{t("Waiting for real performance samples")}</h3>
          </div>
        )}
        <p className="caption">{data?.clock?display(data.clock):t("No timing observations yet")}</p>
      </section>
    </>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
