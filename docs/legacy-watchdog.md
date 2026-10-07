# Codex Quota Watchdog（Windows）

已适配本机 Codex Desktop `26.930.61225` / Windows 包 `26.930.7945.0`，CLI `0.160.1`。运行依赖为已安装的 Node.js 24；没有 npm 第三方依赖。

## 工作方式

后台观察启用后正在执行的本地根聊天，包括普通任务和 Goal。两次轮询之间刚启动就触及额度的任务，也可通过可信的新轮次开始时间识别；启用前已经停下的历史聊天不会被自动复活。确认任务因额度耗尽而停止后，保存聊天 ID、原额度重置时间、设置指纹和一次性续跑记录；在重置时间后额外等待 **120 秒**，复核实时额度和聊天状态，再在原聊天发起继续。

Goal 的 `usageLimited` 状态通过官方 `thread/goal/set` 改回 `active`，保留目标、预算和计数。普通任务和 Goal 的新轮次均通过当前桌面进程的 `\\.\pipe\codex-ipc` 通道发送；额外的 app-server 只查询额度和管理 Goal 状态，**不接管聊天执行、不关闭桌面后端**。

监控本身不调用模型。轮询间隔为 30 秒，实际触发可能比“重置 + 120 秒”晚一个轮询周期。周额度耗尽时等待相关窗口都恢复。正常完成、手动停止、Goal 预算耗尽、模型/权限/目标改变、审批或用户输入等待均会抑制续跑。子智能体由原根任务协调，不单独注入继续消息。

## 当前使用

程序通过计划任务 `CodexQuotaWatchdog` 在本用户登录时启动，隐藏运行。Codex 桌面应用需保持运行；系统睡眠/网络中断期间等待，恢复连接后再检查。已卸载或关闭的聊天不会由程序另开一个执行宿主接管。

等待续跑的聊天如果已从内存卸载，到期会通过原聊天 ID 的深链接加载到现有桌面应用，再复核状态和额度；这可能切换当前展示的聊天。已归档、手动停止和被暂停的 Goal 保持停止。

查看当前状态：

```powershell
node "C:\Projects\codex-quota-watchdog\src\cli.mjs" status
```

暂时暂停或恢复监控（不停止已经运行的 Codex 工作）：

```powershell
node "C:\Projects\codex-quota-watchdog\src\cli.mjs" pause
node "C:\Projects\codex-quota-watchdog\src\cli.mjs" enable
```

彻底停止监控，并关闭登录自启：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Projects\codex-quota-watchdog\Stop-Watchdog.ps1"
```

重新安装/启动：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Projects\codex-quota-watchdog\Install-Watchdog.ps1"
```

## 状态和异常

配置保存在项目的 `runtime/config.json`，原子状态文件、一次性发送账本和简短日志保存在 `runtime/state/`，启动日志为 `runtime/launcher.log`。这些目录已被 Git 忽略，不保存完整聊天、源码或账户令牌。

Windows MSIX 会重定向 AppData，所以登录任务使用这些实际文件位置，并将 Codex CLI 的缓存路径解析为真实路径。首次安装留下的私有 AppData 文件保留，监控记录迁移到 runtime；程序不再依赖被重定向的配置。

`waitingQuota` 表示等待重置；`watching` 表示已观察到运行；`inactive` 表示已完成或已被人工/预算/设置变化停止。`needsAttention` 表示无法确认发送结果等异常：为避免重复任务，程序保留证据并停止重复发送。删除账本会破坏此保护，不应把删除状态当作重试方式。

安装时已做实际的桌面版本和代码哈希校验。未来桌面或 CLI 更新到其他版本时，程序停止自动发送，状态显示需要适配；不要直接改版本号绕过校验。

## 验证

```powershell
Set-Location "C:\Projects\codex-quota-watchdog"
npm test
npm run doctor
```

隔离测试使用模拟额度和时钟，覆盖等待期限、跨重启恢复、Goal 状态恢复、重复发送、用户停止、权限/目标变化、缺失额度、周窗口、IPC 分帧及进程互斥。真实桌面测试只向本次创建的 agent 测试会话发送固定验证请求，普通聊天和 Goal 均确认了原聊天、新轮次及消息 ID；完整自然额度耗尽到恢复的真实周期仍需后台运行时观察。

测试收据保存在工作区 `diagnostics/watchdog-*`。测试会话已完成；桌面写入租约暂未释放的会话留待租约释放后归档，程序不会为清理它们关闭桌面应用。

官方接口说明：[Codex App Server](https://learn.chatgpt.com/docs/app-server)。桌面 IPC 属于内部接口，故固定了实际验证版本和代码哈希。
