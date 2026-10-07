import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import "./style.css";

type WindowQuota = {
  durationMinutes: number;
  usedPercent: number | null;
  remainingPercent: number | null;
  resetsAt: number | null;
};
type Policy = {
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
  theme: "dark" | "light";
  privacy: boolean;
  widgetExpanded: boolean;
  widgetLocked: boolean;
  widgetOpacity: number;
  widgetPinned: boolean;
  notifications: boolean;
  widgetVisible: boolean;
};
type Sample = {
  timestamp: number;
  window: number;
  used_percent: number;
  remaining_percent: number;
  reset_at: number | null;
};
const request = <T,>(method: string, params: unknown = {}): Promise<T> =>
  invoke("core_request", { method, params });
const number = (value: unknown, digits = 0) =>
  typeof value === "number" && Number.isFinite(value)
    ? value.toLocaleString(undefined, { maximumFractionDigits: digits })
    : "Unavailable";
const date = (value: number | null | undefined) =>
  value ? new Date(value).toLocaleString() : "Unavailable";
const time = (value: number | null | undefined) =>
  value
    ? new Date(value).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : "Unavailable";
function countdown(reset: number | null | undefined, now: number) {
  if (!reset) return "Unavailable";
  const seconds = Math.max(0, Math.floor((reset - now) / 1000));
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m ${seconds % 60}s`;
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
  if(task.reason==='goal-paused'||task.reason==='manually-interrupted')return 'Manual paused';
  if(task.reason==='non-quota-error')return 'Error';
  if(task.reason==='goal-user-confirmation')return 'Needs user';
  if(task.reason==='goal-complete'||task.reason==='goal-completed')return 'Completed';
  if(task.phase==='watching'&&['runtime-waiting','goal-between-turns','desktop-loading','latest-turn-unavailable'].includes(task.reason))return 'Waiting';
  if (task.phase === "inactive" && task.reason === "completed")
    return "Completed";
  return phases[task.phase] ?? task.phase;
}

function App() {
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
      setPrefs(await invoke("ui_preferences", { update }));
    } catch (e) {
      setError(String(e));
    }
  };
  useEffect(() => {
    void invoke<Prefs>("ui_preferences")
      .then(setPrefs)
      .catch((e) => setError(String(e)));
    void request<Snapshot>("snapshot")
      .then(setSnapshot)
      .catch((e) => {setError(String(e));setPage('Diagnostics');});
    const registrations = [
      listen<Snapshot>("core/snapshot", (event) => {
        setSnapshot(event.payload);
        setError(null);
      }),
      listen<{ reason: string }>("core/disconnected", (event) =>
        setError(event.payload.reason),
      ),
      listen<Prefs>("preferences/updated", (event) => setPrefs(event.payload)),
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
      void getCurrentWindow().setAlwaysOnTop(prefs.widgetPinned);
      if (view === "widget")
        void getCurrentWindow().setSize(
          new LogicalSize(310, prefs.widgetExpanded ? 390 : 275),
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
            if (event.button === 0 && !prefs?.widgetLocked)
              void getCurrentWindow().startDragging();
          }}
        >
          <span className="logo">C</span>
          <strong>Codex</strong>
          <span className={`dot ${s?.quota?.ready ? "good" : "amber"}`} />
          <button
            title="Hide widget"
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
              <b>{number(running)}</b> Running
            </span>
            <span>
              <b>{number(waiting)}</b> Waiting
            </span>
          </div>
          {prefs?.widgetExpanded || view === "compact" ? (
            <>
              <p className="caption">
                5h reset in {countdown(quota(300)?.resetsAt, now)}
              </p>
              <p className="caption">
                7d reset in {countdown(quota(10080)?.resetsAt, now)}
              </p>
              <p className="mini-task">
                {s?.tasks.find((t) => t.phase === "watching")?.modelId ??
                  "Model unavailable"}
              </p>
              {!prefs?.privacy && s?.tasks[0]?.title && (
                <p className="caption ellipsis">{s.tasks[0].title}</p>
              )}
              <span className="quality">Token rate: Unavailable</span>
            </>
          ) : null}
          {error && <p className="error small">{error}</p>}
        </div>
        <footer className="mini-footer">
          <button onClick={() => void open("main")}>Dashboard ↗</button>
          <button
            title="Expand"
            onClick={() =>
              void preference({ widgetExpanded: !prefs?.widgetExpanded })
            }
          >
            ↕
          </button>
          <button
            title="Lock position"
            onClick={() =>
              void preference({ widgetLocked: !prefs?.widgetLocked })
            }
          >
            {prefs?.widgetLocked ? "Locked" : "Drag"}
          </button>
          <button
            title="Pin on top"
            onClick={() =>
              void preference({ widgetPinned: !prefs?.widgetPinned })
            }
          >
            {prefs?.widgetPinned ? "Pinned" : "Pin"}
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
            <small>Control Center</small>
          </span>
        </a>
        <div className="nav-label">WORKSPACE</div>
        <nav>
          {[
            "Dashboard",
            "Threads",
            "Quota",
            "Tokens",
            "Performance",
            "Settings",
            "Diagnostics",
          ].map((name, i) => (
            <button
              className={page === name ? "selected" : ""}
              key={name}
              onClick={() => setPage(name)}
            >
              <span>{["◈", "☷", "⌁", "◇", "◴", "⚙", "⌘"][i]}</span>
              {name}
              {name === "Threads" && waiting ? <small>{waiting}</small> : null}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <span className="local-badge">● LOCAL FIRST</span>
          <p>
            No cloud analytics.
            <br />
            Your data stays on this PC.
          </p>
          <small>Unofficial · Not affiliated with OpenAI</small>
        </div>
      </aside>
      <section className="workspace">
        <header className="topbar">
          <span>
            <span className={`dot ${s && !error ? "good" : "amber"}`} />
            {s && !error
              ? "Background owner connected"
              : "Connecting to background owner"}
          </span>
          <div>
            <button
              onClick={() => void preference({ privacy: !prefs?.privacy })}
            >
              {prefs?.privacy ? "Privacy on" : "Privacy mode"}
            </button>
            <button
              onClick={() => {
                void open("widget");
                void preference({ widgetVisible: true });
              }}
            >
              Show widget
            </button>
            <button
              disabled={busy}
              onClick={() => void action(() => request("refresh"))}
            >
              ↻ Refresh
            </button>
          </div>
        </header>
        <div className="content">
          <div className="page-heading">
            <div>
              <p className="eyebrow">CODEX / {page.toUpperCase()}</p>
              <h1>{page}</h1>
            </div>
            <span className="updated">
              Last quota check {time(s?.lastQuotaPollAt)}
            </span>
          </div>
          {error && <div className="banner error">{error}</div>}
          {s?.compatibility && !s.compatibility.verified && (
            <div className="banner warning">
              Compatibility not verified. Quota monitoring continues; automatic
              recovery is in safe mode.
            </div>
          )}
          {page === "Dashboard" && (
            <>
              <div className="quota-grid">
                {[300, 10080].map((minutes) => (
                  <QuotaCard
                    key={minutes}
                    q={quota(minutes)}
                    title={minutes === 300 ? "5-hour window" : "7-day window"}
                    now={now}
                  />
                ))}
              </div>
              <div className="metric-grid">
                <Metric
                  label="Running threads"
                  value={number(running)}
                  note="Observed in Codex Desktop"
                />
                <Metric
                  label="Waiting for quota"
                  value={number(waiting)}
                  note={`Next check in ${s ? Math.max(0, Math.ceil((s.nextQuotaPollAt - now) / 1000)) : "—"}s`}
                />
                <Metric
                  label="Recovery engine"
                  value={
                    s?.settings.autoResume
                      ? "Enabled"
                      : s
                        ? "Paused"
                        : "Unavailable"
                  }
                  note={
                    s?.mode === "execute"
                      ? "Fresh state checked before every resume"
                      : "Read-only observation mode"
                  }
                />
                <Metric
                  label="Account plan"
                  value={s?.quota?.planType ?? "Unavailable"}
                  note={
                    s?.quota?.credits
                      ? `Credits: ${String(s.quota.credits.balance ?? "Unavailable")}`
                      : "Account identity remains private"
                  }
                />
              </div>
              <section className="panel">
                <div className="panel-heading">
                  <h2>Active work</h2>
                  <button onClick={() => setPage("Threads")}>
                    All threads →
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
                  Codex CLI {s?.compatibility.cliVersion ?? "Unavailable"}
                </span>
                <span>
                  Desktop {s?.compatibility.desktopVersion ?? "Unavailable"}
                </span>
                <span>
                  {s?.compatibility.status ?? "Compatibility not checked"}
                </span>
              </div>
            </>
          )}
          {page === "Threads" && (
            <section className="panel">
              <div className="panel-heading">
                <h2>Thread & Goal registry</h2>
                <span className="quality">
                  Original threads · No mouse automation
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
      <b>{label}</b>
      <div className="meter">
        <i style={{ width: `${q?.remainingPercent ?? 0}%` }} />
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
            ? "Unavailable"
            : remaining <= 0
              ? "Exhausted"
              : "Available"}
        </span>
      </div>
      <div className="quota-main">
        <div>
          <span className="big-number">
            {remaining == null ? "—" : number(remaining)}
            {remaining != null && <small>%</small>}
          </span>
          <p>{remaining == null ? "Unavailable" : "remaining"}</p>
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
            <small>used</small>
          </div>
        </div>
      </div>
      <p className="caption">
        {elapsed == null
          ? "Window progress unavailable"
          : `${number(elapsed)}% of window time elapsed`}
        {elapsed != null &&
          q?.usedPercent != null &&
          q.usedPercent > elapsed + 10 && (
            <span className="budget-ahead">
              {" "}
              · Usage ahead of uniform time budget
            </span>
          )}
      </p>
      <div className="card-footer">
        <span>
          Resets in <b>{countdown(q?.resetsAt, now)}</b>
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
  if (!tasks.length)
    return (
      <div className="empty">
        <span>☷</span>
        <h3>No enrolled threads yet</h3>
        <p>
          Active local root threads and quota-stopped work appear here when
          observed.
        </p>
      </div>
    );
  return (
    <div className="thread-list">
      {tasks.map((task) => (
        <article className="thread" key={task.threadId}>
          <div className="thread-icon">{task.kind === "goal" ? "◎" : "↳"}</div>
          <div className="thread-main">
            <h3>
              {prefs?.privacy
                ? "Private task"
                : (task.title ?? "Title unavailable")}
              <span className="kind">
                {task.kind === "goal" ? "Goal" : "Thread"}
              </span>
            </h3>
            <div className="thread-meta">
              <span>{task.modelId ?? "Model unavailable"}</span>
              <span>{task.reasoningEffort ?? "Effort unavailable"}</span>
              <span>{task.serviceTier ?? "Tier unavailable"}</span>
              {!prefs?.privacy && (
                <span className="ellipsis">
                  {task.workspace ?? "Workspace unavailable"}
                </span>
              )}
            </div>
            <span className="thread-id">
              {prefs?.privacy ? "ID hidden" : task.threadId}
            </span>
            {!compact && (
              <p className="caption">
                Last observed {time(task.lastActivityAt)} · Retries{" "}
                {task.policy.retryCount}/{task.policy.maxRetries} ·{" "}
                {task.reason}
              </p>
            )}
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
                  {task.policy.neverAutoResume?'Automatic recovery forbidden':task.policy.manualPaused?'Automatic recovery paused':!task.policy.autoResume?'Automatic recovery off':!task.policy.allowAutomaticStart?'Automatic starts blocked':'Automatic recovery allowed'}
                </span>
                <select
                  aria-label="Priority"
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
                  {["P0 Critical", "P1 High", "P2 Normal", "P3 Background"].map(
                    (p, i) => (
                      <option key={p} value={i}>
                        {p}
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
                    Auto {task.policy.autoResume ? "on" : "off"}
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
                      ? "Unpause auto recovery"
                      : "Pause auto recovery"}
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
                    Resume now
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
                    {task.policy.neverAutoResume ? "Allow auto" : "Never auto"}
                  </button>
                </div>
                <details className="thread-policy-details"><summary>Recovery policy</summary><label>Allow automatic start <input type="checkbox" checked={task.policy.allowAutomaticStart} onChange={e=>void action(()=>request('thread/policy',{threadId:task.threadId,update:{allowAutomaticStart:e.target.checked}}))}/></label><label>Max retries <input type="number" min="1" defaultValue={task.policy.maxRetries} onBlur={e=>void action(()=>request('thread/policy',{threadId:task.threadId,update:{maxRetries:Number(e.target.value)}}))}/></label><label>Cooldown seconds <input type="number" min="0" defaultValue={task.policy.cooldownSeconds} onBlur={e=>void action(()=>request('thread/policy',{threadId:task.threadId,update:{cooldownSeconds:Number(e.target.value)}}))}/></label><label>Queue order <input type="number" defaultValue={task.policy.order} onBlur={e=>void action(()=>request('thread/policy',{threadId:task.threadId,update:{order:Number(e.target.value)}}))}/></label></details>
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
  const duration = range <= 24 ? 300 : 10080;
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
            <h2>Quota history</h2>
            <p className="caption">
              Real local samples · 1-minute default cadence
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
        {samples.length ? (
          <>
            <svg
              viewBox="0 0 1000 300"
              className="history-chart"
              role="img"
              aria-label="Observed remaining quota over time"
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
                    {v}%
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
              <polyline points={points(300)} className="series five" />
              <polyline points={points(10080)} className="series week" />
              <text x="50" y="290">
                {date(start)}
              </text>
              <text x="760" y="290">
                Now
              </text>
            </svg>
            <div className="legend">
              <span className="five">● 5h remaining</span>
              <span className="week">● 7d remaining</span>
              <span>┆ Observed reset or window change</span>
            </div>
          </>
        ) : (
          <div className="empty">
            <span>⌁</span>
            <h3>No history in this range yet</h3>
            <p>
              Samples accumulate locally while the background owner reads real
              quota.
            </p>
          </div>
        )}
      </section>
      <div className="metric-grid">
        <Metric
          label="Observed burn / hour"
          value={hourly == null ? "Unavailable" : `${number(hourly, 2)}%`}
          note={`Same-window positive deltas · ${duration === 300 ? "5h" : "7d"}`}
        />
        <Metric
          label="Projected exhaustion"
          value={
            hourly && latest
              ? date(now + (latest.remaining_percent / hourly) * 3600000)
              : "Unavailable"
          }
          note="Estimated from observed average; usage may change"
        />
        <Metric
          label="Stored samples"
          value={number(samples.length)}
          note="Actual samples in selected range"
        />
        <Metric
          label="Window changes"
          value={number(resetMarkers.length)}
          note="Observed quota drop or changed reset time"
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
  useEffect(() => {
    void invoke<boolean>("get_autostart").then(setAutostart);
  }, []);
  const set = (key: string, value: unknown) =>
    action(() => request("settings/update", { [key]: value }));
  return (
    <div className="settings-grid">
      <section className="panel">
        <h2>Recovery & scheduling</h2>
        <Setting
          title="Automatic recovery"
          detail="Resume eligible quota-stopped work after a fresh quota and thread check"
        >
          <input
            type="checkbox"
            checked={s?.settings.autoResume ?? false}
            onChange={(e) => void set("autoResume", e.target.checked)}
          />
        </Setting>
        <Setting
          title="Quota check interval"
          detail="Independent from history sampling"
        >
          <select
            value={s?.settings.recoveryPollSeconds ?? 10}
            onChange={(e) =>
              void set("recoveryPollSeconds", Number(e.target.value))
            }
          >
            {[5, 10, 30, 60].map((v) => (
              <option key={v} value={v}>
                {v} seconds
              </option>
            ))}
          </select>
        </Setting>
        <Setting title="History sample interval" detail="Default 60 seconds">
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
          title="Maximum simultaneous recoveries"
          detail="Running resumes occupy a slot until a terminal turn is observed"
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
          title="Reserve for manual work"
          detail="P2/P3 work waits at this 5h remaining threshold"
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
          title="Maximum safe retries"
          detail="An uncertain delivery is never replayed"
        >
          <input
            type="number"
            min="1"
            defaultValue={s?.settings.maxRetries ?? 3}
            onBlur={(e) => void set("maxRetries", Number(e.target.value))}
          />
        </Setting>
        <Setting
          title="Retry cooldown"
          detail="Applies only to confirmed pre-send failures"
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
        <h2>Desktop preferences</h2>
        <Setting
          title="Start with Windows"
          detail="Start the tray app at login"
        >
          <input
            type="checkbox"
            checked={autostart}
            onChange={(e) =>
              void invoke<boolean>("set_autostart", {
                enabled: e.target.checked,
              }).then(setAutostart)
            }
          />
        </Setting>
        <Setting title="Theme" detail="Applies to dashboard and widget">
          <select
            value={prefs?.theme ?? "dark"}
            onChange={(e) =>
              void preference({ theme: e.target.value as Prefs["theme"] })
            }
          >
            <option value="dark">Dark</option>
            <option value="light">Light</option>
          </select>
        </Setting>
        <Setting
          title="Privacy mode"
          detail="Hide task names and private workspace paths"
        >
          <input
            type="checkbox"
            checked={prefs?.privacy ?? false}
            onChange={(e) => void preference({ privacy: e.target.checked })}
          />
        </Setting>
        <Setting
          title="Windows notifications"
          detail="Meaningful state changes; no repeat every poll"
        >
          <input
            type="checkbox"
            checked={prefs?.notifications ?? true}
            onChange={(e) =>
              void preference({ notifications: e.target.checked })
            }
          />
        </Setting>
        <Setting title="Widget opacity" detail="Compact status transparency">
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
        <Setting title="Lock widget position" detail="Prevent dragging">
          <input
            type="checkbox"
            checked={prefs?.widgetLocked ?? false}
            onChange={(e) =>
              void preference({ widgetLocked: e.target.checked })
            }
          />
        </Setting>
        <Setting
          title="Always on top"
          detail="Pin the widget over other windows"
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
          Closing a window hides it to the tray. Use the tray menu to exit the
          UI or stop the background service.
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
    [saved, setSaved] = useState<string | null>(null);
  return (
    <>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Compatibility doctor</h2>
            <p className="caption">
              Read-only protocol, quota, model and selected thread probes
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
            Run doctor
          </button>
        </div>
        <div className="diagnostic-grid">
          {Object.entries({
            CLI: s?.compatibility.cliVersion ?? "Unavailable",
            Desktop: s?.compatibility.desktopVersion ?? "Unavailable",
            Compatibility: s?.compatibility.status ?? "Unavailable",
            Adapter: "Official app-server + verified Desktop IPC",
            QuotaSource: "Official account/rateLimits/read",
            Database: "Local SQLite · WAL",
            LastQuotaPoll: date(s?.lastQuotaPollAt),
            RecoveryMode: s?.mode ?? "Unavailable",
          }).map(([key, value]) => (
            <div key={key}>
              <small>{key}</small>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
        {report != null && <pre>{JSON.stringify(report, null, 2)}</pre>}
      </section>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Export diagnostics</h2>
            <p className="caption">
              Safe aggregates only. No auth, prompts, account identity, thread
              IDs or private paths.
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
            Export redacted report
          </button>
        </div>
        {saved && <p className="caption">Saved locally: {saved}</p>}
      </section>
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
    .map(([reason, count]) => `${reason} (${count})`)
    .join(", ") ||
  g.tokenTotalStatus ||
  "Observed";
function TokenAnalytics({ privacy }: { privacy: boolean }) {
  const [groupBy, setGroupBy] = useState("model"),
    [data, setData] = useState<{ groups: AnalyticsGroup[] } | null>(null),
    [error, setError] = useState<string | null>(null);
  useEffect(() => {
    request<{ groups: AnalyticsGroup[] }>("analytics/summary", { groupBy })
      .then(setData)
      .catch((e) => setError(String(e)));
  }, [groupBy]);
  return (
    <>
      <div className="banner">
        Estimated API-equivalent cost uses public API pricing. It is not the
        amount charged by the Codex subscription.
      </div>
      <section className="panel">
        <div className="panel-heading">
          <h2>Token usage</h2>
          <select value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
            {[
              "model",
              "tier",
              "effort",
              "turn",
              "thread",
              "goal",
              "workspace",
              "hour",
              "day",
              "5h",
              "week",
            ].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </div>
        {error ? (
          <p className="error">{error}</p>
        ) : data?.groups.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Group / ledger</th>
                  <th>Input</th>
                  <th>Cached</th>
                  <th>Cache write</th>
                  <th>Output</th>
                  <th>Reasoning</th>
                  <th>Total</th>
                  <th>API equivalent</th>
                  <th>Quality</th>
                </tr>
              </thead>
              <tbody>
                {data.groups.map((g, i) => (
                  <tr key={i}>
                    <td>
                      {privacy &&
                      ["workspace", "thread", "goal"].includes(groupBy)
                        ? "Private group"
                        : typeof g.key === "object"
                          ? JSON.stringify(g.key)
                          : String(g.key)}
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
                        {g.missing?.[key] === g.samples
                          ? "Unavailable"
                          : number(g.tokens?.[key])}
                        {g.missing?.[key] > 0 && g.missing[key] < g.samples && (
                          <small>{g.missing[key]} samples unavailable</small>
                        )}
                      </td>
                    ))}
                    <td>
                      {g.estimatedUsd == null
                        ? "Unavailable"
                        : `$${number(g.estimatedUsd, 4)}`}
                    </td>
                    <td>
                      <b>{g.pricingStatus}</b>
                      <small>{analyticsQuality(g)}</small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty">
            <h3>No token observations yet</h3>
            <p>
              Only actual complete telemetry is counted. Different accounting
              ledgers remain separate.
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
      ? "Unavailable"
      : `${number(key === "effectiveThroughput" ? amount : amount / 1000, 2)} ${key === "effectiveThroughput" ? "tok/s" : "s"}`;
  };
  return (
    <>
      <div className="banner">
        Turn-level first-output latency and end-to-end throughput describe the
        whole agent turn, including model calls and tools. Exact model TTFT and
        decode speed are unavailable.
      </div>
      <div className="metric-grid">
        <Metric
          label="Median turn wall time"
          value={value("wall")}
          note={`${number(metric("wall")?.samples)} observed turns`}
        />
        <Metric
          label="Median first visible output"
          value={value("firstVisible")}
          note="Turn-level latency · Recorded timestamps"
        />
        <Metric
          label="Median effective throughput"
          value={value("effectiveThroughput")}
          note="Rough end-to-end output · Includes tool time"
        />
        <Metric
          label="Median observed tool time"
          value={value("tool")}
          note="Overlapping tool intervals counted once"
        />
      </div>
      <section className="panel">
        <h2>Observed performance distribution</h2>
        {error && <p className="error">{error}</p>}
        {data ? (
          <table>
            <thead>
              <tr>
                <th>Measure</th>
                <th>Median</th>
                <th>P95</th>
                <th>Observed</th>
                <th>Missing</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(data.metrics).map(([key, m]) => (
                <tr key={key}>
                  <td>{m.label}</td>
                  <td>
                    {m.p50 == null
                      ? "Unavailable"
                      : `${number(key === "effectiveThroughput" ? m.p50 : m.p50 / 1000, 2)} ${key === "effectiveThroughput" ? "tok/s" : "s"}`}
                  </td>
                  <td>
                    {m.p95 == null
                      ? "Unavailable"
                      : `${number(key === "effectiveThroughput" ? m.p95 : m.p95 / 1000, 2)} ${key === "effectiveThroughput" ? "tok/s" : "s"}`}
                  </td>
                  <td>{number(m.samples)}</td>
                  <td>{number(m.missing)}</td>
                </tr>
              ))}
              <tr>
                <td>Exact model TTFT</td>
                <td colSpan={2}>Unavailable</td>
                <td colSpan={2}>
                  Inference start and first sampled token are not exposed
                </td>
              </tr>
              <tr>
                <td>Exact decode speed</td>
                <td colSpan={2}>Unavailable</td>
                <td colSpan={2}>
                  Individual model decode timing is not exposed
                </td>
              </tr>
            </tbody>
          </table>
        ) : (
          <div className="empty">
            <h3>Waiting for real performance samples</h3>
          </div>
        )}
        <p className="caption">{data?.clock ?? "No timing observations yet"}</p>
      </section>
    </>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
