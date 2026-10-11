# Codex Control Center

**简体中文** | [English](README.en.md)

面向 OpenAI Codex 的本地优先 Windows 控制中心，集成额度监控、线程与 Goal 恢复、任务调度、Token 分析、性能观测和 API 等价费用估算。

由 **xudc2 与 Codex** 开发。

本项目为非官方项目，与 OpenAI 没有关联。应用分析数据保存在本机，不发送应用遥测。API 等价费用依据公开 API 价格估算，不代表 Codex 订阅账单。Desktop 私有协议的兼容性可能变化；遇到未验证版本时，程序保持只读安全模式。

软件支持简体中文和英文，默认按照 Windows 界面语言自动切换，也可在设置中手动选择。托盘、悬浮窗和通知使用相同的语言。中文区域语言使用简体中文，不支持的语言回退到英文。

开发按照[路线图](ROADMAP.md)推进。[进度与验证记录](PROGRESS.md)分别记录已实现功能、隔离测试、真实 Desktop 检查和自然额度周期的证据。界面能够打开不等于完成全部发布验收。

![已安装的中文概览，任务身份已隐藏](docs/screenshots/dashboard-zh-CN.png)

[查看英文概览](docs/screenshots/dashboard-en.png)

截图来自隐私模式下实际安装的 Windows 版本。额度数值是截图时的观测记录，不是示例数据，也不代表订阅额度与 Token 的换算。

## 开发与验证

保留的恢复引擎和内置 SQLite 集成需要 Node.js 24 或更高版本。

```powershell
npm install
npm test
```

原恢复引擎位于 `src/`，原测试套件位于 `test/`。开发期间，原先安装的 watchdog 单独保留。[迁移基线](docs/baseline.md)记录来源和回滚信息；[历史 watchdog 指南](docs/legacy-watchdog.md)说明基线行为，包括旧版重置等待缓冲。

Core v2 默认每 10 秒查询实际额度，每 60 秒独立保存额度历史，恢复符合条件的任务时不再添加固定重置等待。所有阻塞的短周期和周额度窗口都必须可用。发送前重新核对状态与 Goal，配合持久化发送记录防止不安全的重复恢复；优先级、额度预留、并发限制和手动控制共同管理恢复队列。遇到未知 Desktop 版本时，监控继续可用，自动写入关闭。

桌面应用提供额度概览与历史图表、线程与 Goal 策略、Token 与性能页面、诊断、托盘和悬浮窗。费用估算使用带版本的公开价格快照；缺失的观测数据明确显示为“部分可用”或“不可用”。独立测试、真实 Desktop 冒烟测试和安装版验证记录在[验证文档](docs/validation.md)中，并保留各自的版本和证据范围。

当前已安装的 `704b256` 预览版包含诊断来源清单、按需读取的官方账户活动、当前 Goal 计数、后续事件的仓库分组以及有界的工具活动观测。账户活动与本地 Token 账本分别展示，覆盖不足时显示不可用。Windows Node 测试 199 项全部通过，两个 GitHub CI 工作流也已通过。实际安装版和解压后的便携版通过了 45 文件验证，新增页面已在中英文界面中检查。

## 下载与发布

[下载 v0.1.0 预览版](https://github.com/xdcgh/codex-control-center/releases/tag/v0.1.0)，包含已验证的 Windows 安装包、便携 ZIP 和 SHA256 校验文件。当前安装包尚未签名。

公开仓库以及 Windows/Linux CI 已启用，安装版托盘导航也已验证。真实额度恢复闭环的完整证据和可见通知弹窗仍未验证；项目负责人已接受这两项作为本版的证据边界。按照用户要求，Windows 实际重启相关工作留到下一版。[完整需求验收记录](docs/acceptance-audit.md)注明每项检查的范围与协议限制；本预览版不宣称完成全部生产环境验收。

原生构建和包验证请参阅[Windows 构建说明](docs/build.md)。用户运行状态、会话和认证文件不包含在源码或发布包中。便携版将应用数据保存在用户本地配置目录，不复制 Codex 凭据或私有线程。

另请参阅[任务需求](docs/requirements.md)、[架构决策](docs/adr/001-desktop-stack.md)、[安全策略](SECURITY.md)和[第三方声明](THIRD_PARTY_NOTICES.md)。已发布的包通过了源码历史安全检查以及安装版、解压后发布文件的检查。
