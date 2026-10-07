# 项目目标：将现有 codex-quota-watchdog 升级为完整的 Windows Codex Control Center

你需要把目前已经可以工作的 `codex-quota-watchdog` 继续发展为一个长期可维护、可开源、带 Windows GUI 的 Codex 管理与观测软件。

这不是简单做一个额度显示器。

最终目标是形成一个：

**Codex Desktop 线程监控 + 自动恢复 + Goal 调度 + Quota 管理 + Token/性能分析 + API 等价成本分析 + Windows 托盘 + 桌面挂件**

的一体化 Windows 桌面软件。

现有项目大致位于：

`WORKSPACE/codex-quota-watchdog`

首先检查实际目录、Git 状态、当前代码、README、runtime 状态以及已有测试，不要假定路径或现状完全没有变化。

---

# 一、必须保留现有能力

当前 watchdog 已实现的核心能力不能因为 GUI 重构而退化：

- 能读取 Codex 5 小时和 7 天额度窗口。
- 能识别普通 Thread 与 Goal。
- 能记录因 usage limit 停止的任务。
- 能在原 Thread 中继续任务。
- Goal 可以恢复原目标状态后继续执行。
- 不依赖鼠标模拟。
- 不需要关闭 Codex Desktop backend。
- 有状态持久化。
- 有重复恢复保护。
- 能区分至少以下状态：
  - working
  - waiting
  - usage limited
  - manual paused
  - completed
  - error
- Windows 登录后可自动运行。
- 当前已有单元测试和 Desktop smoke test。

重构前先给当前版本打一个明确 Git baseline/tag，保证随时能够回退。

---

# 二、修改额度恢复机制

取消现在：

`resetsAt + 120 秒`

这种固定等待机制。

改为：

```text
检测到 usageLimited
        ↓
进入 quota-wait 状态
        ↓
每 10 秒读取一次真实额度
        ↓
5h 是否恢复？
7d/其他阻塞窗口是否可用？
        ↓
NO ─────────→ 继续等待
        │
       YES
        ↓
再次确认 Thread 状态
        ↓
立即恢复
```

要求：

1. 默认恢复检测周期：10 秒。
2. GUI 可以配置，例如 5 / 10 / 30 / 60 秒。
3. 正常运行时无需以 10 秒频率写历史数据库；恢复探测和历史采样是两个独立频率。
4. Quota history 默认每 60 秒保存一次。
5. 网络/API/app-server 临时异常时采用合理退避，不能疯狂重试。
6. 一旦恢复成功立即恢复线程，不再额外等待 120 秒。
7. 如果 5h 已恢复而 7d 仍不可用，不启动。
8. 如果任务已经被用户手动暂停、完成、删除或进入“等待用户决定”状态，不得自动恢复。
9. 恢复前再次读取当前状态，防止 watchdog 与用户同时操作造成重复 Turn。
10. 同一 Thread 必须具有幂等恢复保护。

尽量维持一个持久连接或低开销的数据通道，不要每 10 秒重新启动一整套重量级进程。

---

# 三、Windows 桌面软件

将项目升级为真正的 Windows Desktop App。

技术方案先调研再确定。

优先研究：

- Tauri 2 + Rust + React/TypeScript
- .NET / WinUI / WPF
- Electron

默认倾向：

**Tauri 2 + Rust backend + Web UI**

因为需要：

- system tray
- native Windows integration
- always-on-top widget
- SQLite
- background service
- 低内存占用
- installer
- autostart
- 单实例

但是，不允许为了换技术栈而直接丢弃已经验证工作的 Node watchdog。

如果一次性移植风险高，可以：

```text
GUI/Tauri
    │
    ├─ 新 Rust core
    │
    └─ existing watchdog sidecar
```

先复用现有恢复引擎，建立行为一致性测试，再逐步移植。

在做出技术决策后创建 ADR，例如：

`docs/adr/001-desktop-stack.md`

说明为什么选它，而不是凭感觉重写。

---

# 四、主 Dashboard

主窗口至少包含：

## Quota 区

显示：

- 5h 已使用 %
- 5h 剩余 %
- 5h resetsAt
- 倒计时
- 7d 已使用 %
- 7d 剩余 %
- 7d resetsAt
- credits / points（如果接口有）
- 当前 account/plan 可安全显示的信息
- watchdog 状态
- Codex Desktop 状态
- CLI/Desktop 版本
- 最近更新时间

不能通过 OCR 获取。

优先使用 Codex app-server / 官方协议或现有本地可靠数据源。

---

# 五、Quota 历史折线图

建立 SQLite 时序数据。

默认每 1 分钟采集一次：

```text
timestamp
limit_id
window
used_percent
remaining_percent
reset_at
credits
source
codex_version
```

GUI 提供：

- 最近 5h
- 24h
- 7d
- 30d
- 90d

折线图。

增加：

- reset marker
- quota burn rate
- 每小时消耗
- 当前窗口平均消耗速度
- 当前速度预计何时耗尽
- 与窗口时间进度进行比较

例如：

```text
5 小时过去了 40%
额度已经消耗 70%

→ 当前明显高于均匀预算速度
```

数据长期积累时考虑 downsampling，不能让 SQLite 和图表无限膨胀。

---

# 六、Thread / Goal 实时监控

增加“线程”页面。

尽可能显示：

```text
Title
Thread ID
Normal / Goal
Workspace / cwd
Repository
Current status
Model
Reasoning effort
Service tier
Fast / Standard
Last activity
Current turn
Started at
Running duration
Token usage
Quota impact
Auto resume
Priority
Retry count
Next recovery check
```

状态视觉上区分：

```text
Working
Waiting
Tool executing
Usage Limited
Waiting For Quota
Scheduled To Resume
Manual Paused
Needs User
Completed
Error
Offline
Suspected Hung
```

额度耗尽以后，即使 Codex 当前已经停止执行，该 Thread 仍然必须保留在 GUI 中：

```text
GPT-6.1 Sol
Goal
Stopped: Usage limit
5h reset: 01:16
Auto resume: ON
Next quota check: 9s
```

恢复后更新为：

```text
Resumed automatically
09:18:07
```

并保留事件历史。

---

# 七、Quota-aware Scheduler

把 watchdog 进一步升级成真正的任务调度器。

每个 Thread 支持：

- Auto resume ON/OFF
- Priority
- Allow automatic start
- Maximum retries
- Cooldown
- Manual pause
- Resume now
- Never auto resume

优先级至少：

```text
P0 Critical
P1 High
P2 Normal
P3 Background
```

增加策略：

### 最大恢复并发

额度恢复后不要默认把十几个 Goal 同时全部打出去。

允许配置：

`maxConcurrentResumes`

例如默认 1～2。

### Quota Reserve

允许设置：

```text
保留 10% 5h quota 给人工任务
```

低优先级任务达到 Reserve threshold 后暂停启动新工作。

### Resume Queue

额度恢复时按照：

```text
Priority
→ 等待时间
→ 用户指定顺序
```

恢复。

### Fail-safe

同一个任务连续自动恢复 N 次仍失败：

```text
停止自动恢复
标记 Needs Attention
通知用户
```

---

# 八、真正完成“自然额度周期”验收

当前版本虽然：

- 单元测试已通过
- 普通 Thread Desktop smoke test 通过
- Goal 恢复测试通过

但是还没有完整观察：

```text
真实使用额度耗尽
↓
官方 usage limit
↓
watchdog 自动记录
↓
等待真实 quota reset
↓
10 秒轮询发现恢复
↓
自动恢复
↓
原任务继续
↓
成功完成
```

这一项必须成为正式验收项。

建立：

`E2E-NATURAL-QUOTA-CYCLE.md`

记录：

- Codex version
- Desktop version
- Thread ID（公开日志中脱敏）
- Goal / Normal
- model
- exhaustion timestamp
- resetsAt
- detectedRecoveryAt
- resumeAt
- detection latency
- resume latency
- outcome
- duplicated turn?
- state persistence?
- manual intervention?
- errors

不能用模拟测试冒充自然额度周期测试。

模拟测试和自然测试必须分开标记。

---

# 九、Codex 版本兼容层

这是高优先级。

不能假设 OpenAI 永远保持 Desktop 私有 IPC 不变。

建立类似：

```text
CodexAdapter
├─ OfficialAppServerAdapter
├─ DesktopIpcAdapter
├─ SessionLogAdapter
└─ CompatibilityProbe
```

优先级：

```text
稳定官方协议
>
公开 app-server
>
session telemetry
>
必要情况下的 Desktop 私有接口
```

不要让业务代码到处直接读取 ASAR 内部实现。

启动时检测：

- Codex CLI version
- Desktop version
- protocol version
- ASAR hash（如确有必要）
- model catalog schema
- required methods

如果发现未知版本：

```text
Compatibility not verified
```

自动恢复功能可以进入 Safe Mode，但只读监控尽量继续工作。

提供：

`Doctor`

页面和 CLI。

软件升级 Codex 后能够一键执行：

```text
Protocol probe
Quota probe
Thread read probe
Goal read probe
Dry-run resume probe
```

验证兼容性。

---

# 十、Token Telemetry

尽可能从 Codex 官方 app-server / SDK / session telemetry 获取真正 Token 数据。

至少记录：

```text
input_tokens
cached_input_tokens
cache_write_input_tokens
output_tokens
reasoning_output_tokens
total_tokens
model_context_window
```

支持以下聚合维度：

```text
per model
per turn
per thread
per Goal
per workspace/repo
per hour
per day
per 5h window
per week
```

不要重复计算 reasoning token。

明确核查：

`total_tokens`

的真实定义。

---

# 十一、模型与运行模式统计

不要硬编码只有某几个模型。

动态读取 Codex model catalog 和实际 turn metadata。

UI 可以显示友好名称，例如：

```text
GPT-6 Astra
GPT-6.1 Sol
GPT-6 Sol
GPT-6 Luna
GPT-5.6 Terra
...
```

但是数据库必须保存真实：

`model_id`

例如：

`gpt-6.1-sol`

同时记录：

```text
reasoning_effort
service_tier
Fast / Standard / other
collaboration mode
Goal / Normal
```

如果未来出现新的模型，不需要升级代码才能统计。

如果用户输入或第三方 provider 真正出现 Llama，也应该显示真实 provider/model，而不是程序自行猜测。

---

# 十二、Token Dashboard

提供模型统计页。

例如：

```text
GPT-6.1 Sol
Input              12.3M
Cached Input       10.7M
Cache Writes        0.8M
Output              1.1M
Reasoning            620K
Cache Hit Rate        87%
Turns                 126
Estimated API Cost  $XX.XX
```

并可以比较：

```text
Astra
Sol
Luna
Terra
```

显示：

- Token 总量
- Input
- Cached
- Cache write
- Output
- Reasoning
- Cache hit ratio
- Turn 数
- 平均每 Turn Token
- P50/P95
- 平均上下文长度
- >272K 请求数量
- Fast 请求数量
- Standard 请求数量

---

# 十三、长上下文统计

当前用户可能配置约 870K context。

注意：

**最大上下文配置为 870K，不代表每次请求都使用 870K。**

必须记录每次请求实际：

`input_tokens`

并判断是否跨越当前官方 Long Context pricing threshold。

当前已知 OpenAI 部分最新模型规则为：

```text
input <= 272K
→ short context pricing

input > 272K
→ long context pricing
→ 对整个请求使用对应 long-context 价格
```

但是价格和规则会变化。

因此：

不要把 `272K` 永久散落硬编码在计算代码里。

建立版本化 Pricing/Policy 数据结构：

```text
model
effective_from
short_context_threshold
short_input
short_cached_input
short_cache_write
short_output
long_input
long_cached_input
long_cache_write
long_output
fast_multiplier / explicit rates
batch
flex
regional_multiplier
source
last_verified_at
```

GUI 中显示：

```text
Current pricing snapshot:
OpenAI API
Verified: YYYY-MM-DD
```

价格更新后历史账单必须仍能用“当时价格”重算。

---

# 十四、API 等价费用计算

这里必须明确：

**Codex Plus/Pro 等订阅额度不等于 API 实际账单。**

因此 UI 中不要写：

`You spent $50`

而应该写：

`Estimated API-equivalent cost: $50`

并增加说明：

`Based on public OpenAI API pricing; this is not the amount charged by the Codex subscription.`

成本计算至少区分：

```text
Ordinary input
Cached input
Cache write
Output
```

当前 OpenAI cache billing 逻辑需要按照真实分类计算，不允许：

```text
input + cached input
```

这样重复计费。

原则上：

```text
ordinary_input =
input_tokens
- cached_input_tokens
- cache_write_input_tokens
```

然后分别乘对应 rate。

输出单独计费。

Long Context 应用实际请求级规则。

Fast 使用 Fast rate。

如果某个 telemetry 字段拿不到：

绝对不能假装精确。

显示：

```text
Estimated
Partial
Unavailable
```

并给出缺失原因。

---

# 十五、Pricing 自动维护

研究是否可以安全地从 OpenAI 官方 pricing/model metadata 获取价格。

如果没有稳定机器可读 API：

使用仓库中的：

`pricing.json`

并实现：

- last verified timestamp
- update checker
- schema validation
- manual override
- official-source link
- historical pricing snapshots

不能从第三方博客直接自动改价格。

第三方只能用来发现变化，最终以官方来源确认。

---

# 十六、性能统计

用户希望类似 DeepSeek 的性能信息。

尽可能统计：

```text
Turn start time
First visible model output time
Completion time
Turn wall time
Tool execution time
Model waiting time
Output tokens
Effective tokens/sec
TTFT
Generation duration
Decode tokens/sec
```

但必须严格区分：

### 精确指标

只有真正能拿到：

```text
request start
first model token
request completion
```

时，才允许称：

`Model TTFT`

`Decode tokens/s`

### 推算指标

如果只有：

```text
turn start
first visible assistant output
turn completion
```

只能称：

`Turn-level first-output latency`

或：

`Effective output throughput`

不能冒充 model TTFT。

因为一个 Agent Turn 中可能包含：

```text
model
→ tool
→ model
→ tool
→ model
```

整个 Turn duration 除以 output tokens 并不等于真正 decode speed。

优先研究能否通过 app-server 实时 notification / Responses stream timestamps 获得更准确数据。

如果当前 Codex 没有暴露单次 sampling timing：

把这个限制写进 Diagnostics，而不是造数据。

---

# 十七、性能统计视图

每个模型显示：

```text
Requests
Avg TTFT
Median TTFT
P95 TTFT
Fastest
Slowest

Avg generation duration
P50/P95

Avg output tok/s
Max tok/s
Min tok/s

Turn wall time
Tool time
```

Fast / Standard 分开统计。

例如：

```text
GPT-6.1 Sol Standard
GPT-6.1 Sol Fast
```

直接比较：

```text
TTFT
throughput
quota burn
token usage
API-equivalent cost
```

---

# 十八、Quota 消耗与 Token 的关联分析

这是一个非常有价值的实验功能。

将每分钟 quota sample 与真实 Token usage 关联。

尝试计算：

```text
quota_delta
tokens_generated
input_tokens
cached_tokens
output_tokens
model
service_tier
reasoning effort
```

从历史数据分析：

```text
每 1M Token 对 5h quota 的平均影响
不同模型 quota burn 差异
Fast 与 Standard 的 quota burn 差异
不同 reasoning effort 的 quota burn 差异
```

但是：

Codex subscription quota 算法如果官方没有公开，必须标记为：

`Observed / empirical`

而不是“官方公式”。

多线程并发时无法准确把 quota delta 全部分摊给一个 Thread，就标注置信度或只统计能够可靠归因的窗口。

---

# 十九、System Tray

实现 Windows 系统托盘。

左键：

打开 compact status。

右键至少显示：

```text
5h: 37% remaining · reset 01:16
7d: 62% remaining · reset Friday

Running: 3
Waiting quota: 2

Open Dashboard
Open Threads
Show Widget
Refresh
Pause Auto Resume
Resume Eligible Tasks
Start with Windows
Diagnostics
Exit
```

菜单信息必须实时刷新。

低额度可以改变托盘状态，但不要做夸张干扰。

---

# 二十、桌面挂件

实现一个独立 compact widget。

要求：

- Always on top
- 可拖动
- 多显示器
- Windows DPI scaling
- Light/Dark
- 透明度
- Lock position
- Compact/Expanded
- Pin/Unpin
- 开机恢复位置

Compact 示例：

```text
Codex
5h   ███████░░ 73%
7d   █████░░░░ 52%

2 Running
1 Waiting quota

Sol Fast · 42 tok/s
```

Expanded 可以显示：

- reset countdown
- 当前主要线程
- 当前模型
- token rate
- quota burn

支持隐藏任务名称的 Privacy Mode。

---

# 二十一、通知系统

Windows Toast notifications：

- Quota exhausted
- Task waiting
- Quota recovered
- Thread auto resumed
- Resume failed
- Unknown Codex version
- Weekly quota low
- Natural E2E cycle successfully observed

可以单独开关。

避免每 10 秒重复通知。

---

# 二十二、本地数据库

建议 SQLite。

至少设计：

```text
threads
turns
goals
quota_samples
token_usage
model_calls
performance_samples
recovery_events
pricing_snapshots
app_versions
settings
```

考虑 schema migration。

不能因为软件升级导致旧历史丢失。

---

# 二十三、隐私与安全

这是公开仓库前的硬性门槛。

绝对禁止上传：

- auth.json
- access token
- refresh token
- session cookie
- email
- account ID
- 原始私人 prompt
- 私有 Thread 内容
- 用户绝对路径
- thread id 测试日志
- runtime database
- diagnostic dump
- `.codex` 敏感数据

默认：

**local-first / no telemetry**

应用自己的 analytics 不上传云端。

在公开 GitHub 前：

1. 检查 Git history。
2. secret scan。
3. 检查测试 fixture。
4. 检查 diagnostics。
5. 检查 README screenshot。
6. 检查绝对路径。
7. 检查用户名。
8. 检查 auth/token。
9. 检查第三方代码 license。

如果曾经 commit 过 secret，要清理 Git history 后再公开。

---

# 二十四、社区参考项目

不要从零造轮子。

调研并按当前最新版本查看这些项目：

### Quota / Windows

- `VictorZakharov/codex-usage`
- `Martinweiting/CodexUsageMonitor`
- `upstream-ray/codex-usage-monitor`
- `Moolmool114/codex-quota`
- `abhuri/windowscodexmonitor`

重点学习：

- tray
- quota source
- history charts
- widget
- autostart
- native Windows UI
- SQLite/history
- packaging

### Token / Dashboard

- `manuelsh/codex-monitor`
- `harveyxiacn/codex-usage-monitor`

重点研究：

- session JSONL parsing
- token attribution
- per-task usage
- cost calculation
- watcher
- hooks

### Auto Resume

- `progressrdx/codex-auto-resume`
- `awslew/codex-auto-resume-trio`

研究：

- resume detection
- app-server interaction
- session locking
- recovery policy

但不要照搬会：

```text
杀掉 Codex Desktop backend
→ 自己抢占 session
```

的设计。

### macOS UX

- `steipete/CodexBar`

学习：

- compact usage UX
- reset presentation
- multi-provider abstraction
- menu-bar/tray interaction

### 最重要

- `openai/codex`

直接读取当前版本：

- app-server protocol
- token usage schemas
- model catalog
- service tier
- thread/turn protocol
- Goal
- notifications

官方源码优先级高于第三方项目。

---

# 二十五、第三方代码使用规则

可以 clone 参考项目。

建议放：

`research/references/`

或者仓库外临时目录。

但：

不要直接复制 GPL/AGPL 等不兼容代码进入我们的仓库。

先检查：

`LICENSE`

再决定：

```text
reference only
reuse architecture
reuse code with attribution
do not reuse
```

建立：

`THIRD_PARTY_NOTICES.md`

记录真正复用的代码。

---

# 二十六、Git 与开源仓库

为这个桌面软件创建新的 Git 仓库。

建议名称：

`codex-control-center`

如果名称冲突，可以选择合理替代名称。

目标：

```text
Codex Control Center
```

保留原 watchdog 的贡献历史。

不要简单把旧项目删除后复制成一堆新文件。

优先考虑：

- 保留 Git history
- subtree/import history
- 或有清晰 migration commit

开发过程中必须积极 commit。

建议 commit 粒度：

```text
chore: snapshot legacy watchdog
research: evaluate community monitors
refactor: isolate codex adapter
feat: quota polling engine
feat: sqlite telemetry
feat: thread registry
feat: desktop dashboard
feat: tray integration
feat: quota history chart
feat: token analytics
feat: pricing engine
feat: performance metrics
feat: quota scheduler
feat: desktop widget
test: natural quota cycle instrumentation
docs: open source documentation
```

完成稳定节点就 push。

不要攒几天最后只做一个巨大 commit。

---

# 二十七、GitHub 发布

使用当前已经认证的 GitHub 身份。

创建新的公开 repository。

公开前必须经过 Security Gate。

仓库至少包含：

```text
README.md
LICENSE
CHANGELOG.md
CONTRIBUTING.md
SECURITY.md
THIRD_PARTY_NOTICES.md
docs/
src/
tests/
```

提供：

- Windows installer
- portable build
- SHA256
- GitHub Release
- screenshots
- build instructions

尽量配置 GitHub Actions：

```text
build
test
lint
package
release
```

不要把签名证书、token 放入仓库。

---

# 二十八、阶段划分

按下面顺序推进，不要一次重写全部系统。

## Phase 0 — Baseline

- 读取现有 watchdog
- 全部测试
- 保存当前运行状态
- Git baseline/tag
- 架构文档

## Phase 1 — Research

- 调研社区项目
- 调研最新 Codex protocol
- 调研 token telemetry
- 调研 timing 可观测性
- 调研 Windows framework
- License review
- ADR

## Phase 2 — Core v2

- adapter abstraction
- quota poller
- 10 秒 recovery detection
- scheduler
- durable state
- SQLite
- version compatibility

必须先无 GUI 地完整通过测试。

## Phase 3 — Desktop MVP

完成：

- Dashboard
- Threads
- Quota
- Tray
- Settings
- Diagnostics

## Phase 4 — Observability

完成：

- quota history
- token history
- per-model statistics
- Fast/Standard
- reasoning effort
- API-equivalent cost
- long-context pricing

## Phase 5 — Performance

完成尽可能真实的：

- TTFT
- first visible output latency
- wall time
- tool time
- tokens/s

明确 exact vs estimated。

## Phase 6 — Scheduler

完成：

- priority
- reserve quota
- max concurrency
- retry limits
- resume queue
- manual controls

## Phase 7 — Widget

- desktop widget
- tray menu
- notification
- privacy mode

## Phase 8 — Reliability

重点测试：

- Codex restart
- Desktop restart
- Windows restart
- network failure
- app-server crash
- unknown Codex version
- duplicated event
- database corruption/recovery
- user manually pauses
- user manually resumes
- multiple Goal
- multiple normal Threads
- weekly limit exhausted
- 5h limit exhausted

## Phase 9 — Natural E2E

完成一次真正：

`额度耗尽 → reset → 自动恢复`

并保存验收报告。

## Phase 10 — Open Source Release

- clean repo
- secret scan
- docs
- tests
- installer
- GitHub repo
- v0.1.0 release

---

# 二十九、测试要求

不能只做 happy path。

至少包含：

### Unit tests

- quota parser
- pricing
- long context
- token calculation
- cache accounting
- state machine
- resume policy
- retry
- priority
- deduplication

### Integration tests

- app-server
- Thread read
- Goal read
- Token event
- quota read
- SQLite
- Desktop IPC compatibility

### Desktop smoke

- normal thread
- Goal
- tray
- widget
- restore

### Restart

测试：

```text
watchdog waiting quota
↓
Windows/app restart
↓
state recovered
↓
task still scheduled
```

### Natural quota

最终真实 E2E。

---

# 三十、不可伪造的数据

如果 Codex 当前协议不能提供某个数据：

不要猜。

例如：

- exact model TTFT
- exact decode duration
- exact subscription-to-token conversion
- exact quota weight
- hidden billing coefficient

显示：

`Unavailable`

或者：

`Estimated`

并记录数据来源。

Observability 软件最重要的是可信。

---

# 三十一、诊断页面

提供 Diagnostics：

```text
Codex CLI version
Desktop version
Protocol version
Adapter
Account rate limit source
Session source
Token source
Model metadata source
Pricing snapshot
Database
Last quota poll
Last event
Last auto resume
Compatibility
```

提供：

`Export Diagnostics`

但导出前必须自动脱敏：

- auth
- username
- email
- thread content
- absolute private path
- tokens/secrets

---

# 三十二、README 最终定位

README 不要把项目只描述成 quota monitor。

定位为：

> A local-first Windows control center for OpenAI Codex — quota monitoring, thread/Goal recovery, scheduling, token analytics, performance telemetry, and API-equivalent cost analysis.

明确：

- unofficial project
- not affiliated with OpenAI
- API-equivalent cost ≠ subscription bill
- private Codex protocol compatibility may change
- local-first
- no telemetry by default

---

# 三十三、完成标准

不要因为 GUI 能打开就宣布完成。

至少满足：

```text
[ ] 原 watchdog 功能无回归
[ ] 10 秒额度恢复检测
[ ] Normal Thread 自动恢复
[ ] Goal 自动恢复
[ ] 多 Thread 管理
[ ] Resume queue
[ ] 防重复恢复
[ ] Windows restart persistence
[ ] Quota dashboard
[ ] 1-minute history
[ ] history chart
[ ] Token telemetry
[ ] per-model aggregation
[ ] Fast/Standard aggregation
[ ] reasoning effort aggregation
[ ] long-context detection
[ ] cache read/write accounting
[ ] API-equivalent pricing
[ ] performance telemetry
[ ] exact/estimated distinction
[ ] tray
[ ] right-click menu
[ ] desktop widget
[ ] autostart
[ ] diagnostics
[ ] version compatibility check
[ ] unit/integration tests
[ ] Desktop smoke tests
[ ] natural quota E2E observed
[ ] secret scan
[ ] public GitHub repository
[ ] installer
[ ] v0.1.0 release
```

---

# 三十四、执行方式

这是一个长期 Goal，不要只给我设计方案。

你需要持续：

```text
Research
→ Design
→ Implement
→ Test
→ Commit
→ Push
→ Verify
→ Continue
```

每完成一个阶段：

1. 更新 `ROADMAP.md`
2. 更新 `PROGRESS.md`
3. 更新测试状态
4. 提交 Git commit
5. 推送远程
6. 再进入下一阶段

遇到技术问题时优先自己调查：

- OpenAI 官方文档
- openai/codex 当前源码
- GitHub issue
- 上述社区项目

普通技术选择不要频繁停下来询问用户。

只有以下情况才需要停下来要求用户决定：

- 会破坏/删除用户数据
- 需要付费
- 需要公开敏感信息
- License 冲突无法安全处理
- 需要不可逆 Git 操作
- 需要改变核心产品目标

否则自行选择合理方案继续。

最重要的原则：

**不要为了新 GUI 破坏已经验证工作的恢复能力。先建立稳定 Core，再增加界面。**

最终目标不是做一个漂亮 Demo，而是做成一个用户真的可以长期挂在 Windows 后台使用的 Codex Control Center。