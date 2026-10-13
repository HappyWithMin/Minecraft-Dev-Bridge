# Minecraft Dev Bridge

给 Codex 和 Claude Code 使用的 Minecraft 插件验证工具。独立测试客户端以**隐藏窗口**运行；动作由游戏内部执行，截图直接读取游戏帧缓冲区。你可以继续操作电脑或另一个游戏客户端。

源码仓库：[HappyWithMin/Minecraft-Dev-Bridge](https://github.com/HappyWithMin/Minecraft-Dev-Bridge)。仓库包含桥接模组源码、已构建的桥接 JAR、MCP 工具、技能、测试和验证样例；不包含 Minecraft 游戏依赖或本机运行配置。

## 已实现

- 本地 RCON 服务端命令和服务端日志。
- 独立客户端启动/退出、玩家命令、走跑跳潜行、视角、第一/第三人称、快捷栏、攻击/使用物品、背包与插件菜单操作。
- 默认 1080p、最高 4K 的实际渲染截图，MCP 直接返回图像；完成后自动恢复原分辨率。
- 后台连续帧采集，保存无损 PNG、逐帧时间/游戏状态、漏采统计，以及可播放和逐帧检查的离线页面。
- 场景串行执行、状态断言、失败清理和 JSON 验证记录。
- 服务端插件 JAR 暂存到 `plugins/update`，SHA-256 与旧暂存文件备份。
- 21 个 MCP 工具、一个 `minecraft-validation` 技能，无 npm 第三方依赖。

## 使用

按下方 [安装](#安装) 完成安装和首次配置后，在新的 Codex 或 Claude Code 会话中说：

> 用 minecraft-dev-bridge 在后台验证 PlayerModel：进入模型菜单，测试走跑跳、第三人称和持物，截图并报告。

MCP 名称可能带插件前缀。最常用的是 `mc_launch`、`mc_status`、`mc_server_command`、`mc_input`、`mc_screenshot`、`mc_run_scenario`、`mc_shutdown`。截图也能通过 `view_image`（Codex）或 Read（Claude Code）打开返回的本地路径。Claude Code 中工具全名形如 `mcp__plugin_minecraft-dev-bridge_minecraft_dev_bridge__mc_status`。

在仓库或插件根目录的终端中也可直接运行同一实现的 CLI：

```powershell
node scripts/cli.mjs mc_launch
node scripts/cli.mjs mc_status
node scripts/cli.mjs mc_screenshot
node scripts/cli.mjs mc_stop
node scripts/cli.mjs mc_shutdown
```

有参数时建议写 JSON 文件，例如 `look.json` 为 `{"yaw":0,"pitch":0}`，执行 `node scripts/cli.mjs mc_look '@C:\path\look.json'`。这样不受 PowerShell 引号转换影响。

场景示例：

```json
{
  "name": "background-walk",
  "steps": [
    {"assert":{"path":"hidden","equals":true}},
    {"assert":{"path":"focused","equals":false}},
    {"tool":"mc_camera","args":{"mode":"THIRD_PERSON_FRONT"}},
    {"tool":"mc_input","args":{"keys":["forward"],"durationMs":800}},
    {"waitMs":1000},
    {"assert":{"path":"inputRemainingMs","equals":0}},
    {"tool":"mc_screenshot"}
  ]
}
```

传给 `mc_run_scenario` 或保存为 JSON 后通过 CLI 调用。报告位于 runtime/reports，截图位于 runtime/client/screenshots。场景中 `waitMs` 累计至多 45 秒，长测试分段进行。

## 高分辨率截图与连续帧

`mc_screenshot` 不传参数时输出 1920×1080；传 `{"width":3840,"height":2160}` 输出 4K。直接调整独立隐藏客户端的实际渲染尺寸，等待新尺寸稳定后读取帧缓冲区，保存无损 PNG，再恢复原尺寸和帧率限制。返回 `path`、`width`、`height`、`capturedAt`、`frame`、`tick`、`manifestPath` 和 `restored`。分辨率越高，细节检查越清楚，但采集开销也越高。

连续采集使用以下四个工具；开始后仍能正常发送动作与视角命令：

| 工具 | 参数示例 | 作用 |
| --- | --- | --- |
| `mc_capture_start` | `{"width":1920,"height":1080,"fps":10,"durationMs":3000}` | 异步启动，返回本次 `id` |
| `mc_capture_status` | `{"id":"返回的 UUID"}` | 等待 `state=recording` 后执行动作；等待 `terminal=true` 后检查结果 |
| `mc_capture_frame` | `{"id":"返回的 UUID","index":5}` | 读取已保存列表中的第 6 帧，直接返回 MCP 图像 |
| `mc_capture_stop` | `{"id":"返回的 UUID"}` | 提前停止，保留已有帧；继续查询直到恢复完成 |

不传采集参数时为 1080p、10 FPS、2 秒。允许宽 640–3840、高 360–2160、1–30 FPS、100–10000 ms；同时限制为最多 120 帧、累计 2.5 亿像素。例如 1080p/10 FPS/3 秒、720p/30 FPS/2 秒、4K/5 FPS/2 秒均在预算内。超限会在动作开始前拒绝，不自动降低用户指定的画质。

每次采集保存在 `runtime/client/screenshots/captures/<id>/`。`manifest.json` 包含计划帧数、实际帧数、实际采样间隔、漏采数量和每帧的渲染序号、tick、玩家位置/朝向/持物状态。完成后的 `mc_capture_status` 返回 `viewerPath`；打开 `index.html` 可按真实间隔回放、拖动时间轴、逐帧切换、查看原始像素和打开原图。保存的是 PNG 序列，可在测试客户端退出后继续读取。

一次只能有一个截图或采集任务。PNG 在后台线程编码，最多保留两帧待处理；显卡、游戏或写盘跟不上时会跳过采样点并如实记录，不复制或补出不存在的帧。设定 FPS 是采样目标，判断动画应结合实际间隔与漏帧数据；采集本身会增加负载，不能直接充当无开销的性能基准。

`mc_run_scenario` 可包含 `mc_capture_start`，结束或失败时会停止该场景启动的采集、恢复渲染设置，并把记录加入 `captures`。独立启动的采集到时自动结束；`mc_stop` 只释放输入/取消场景，提前结束独立采集请调用 `mc_capture_stop`。

## 安装

同一个仓库同时是 **Codex 插件**和 **Claude Code 插件**（各自也是一个插件市场），两边加载同一套 MCP 工具和 `minecraft-validation` 技能。

### 前置要求

- Windows、Node.js 22+、JDK 25、可用的显卡和图形会话。
- 已安装且依赖完整的 Fabric 26.3 启动配置（启动器 `versions/<名称>/<名称>.json` 必须是已解析的完整配置，不支持 `inheritsFrom`）。
- 本机测试服：`server.properties` 中 `online-mode=false`；需要 `mc_server_command` 时还要开启 `enable-rcon` 并设置 `rcon.password`。

仓库自带已构建的 `dist/minecraft-dev-bridge-26.3.jar`，普通使用无需构建。

### Claude Code

```powershell
claude plugin marketplace add HappyWithMin/Minecraft-Dev-Bridge
claude plugin install minecraft-dev-bridge@minecraft-dev-bridge
```

也可以在会话中执行 `/plugin install minecraft-dev-bridge --marketplace HappyWithMin/Minecraft-Dev-Bridge`。安装后开新会话；工具全名形如 `mcp__plugin_minecraft-dev-bridge_minecraft_dev_bridge__mc_status`，技能为 `minecraft-dev-bridge:minecraft-validation`。更新：`claude plugin marketplace update minecraft-dev-bridge` 后 `claude plugin update minecraft-dev-bridge@minecraft-dev-bridge`。

### Codex

```powershell
codex plugin marketplace add HappyWithMin/Minecraft-Dev-Bridge
codex plugin add minecraft-dev-bridge@minecraft-dev-bridge
```

安装后开新聊天。市场定义在 `.agents/plugins/marketplace.json`，MCP 定义在 `.mcp.json`（以插件根目录为工作目录运行 `node ./scripts/mcp.mjs`）。更新：`codex plugin marketplace upgrade` 后重新安装。

### 首次配置

配置保存在 `%USERPROFILE%\.minecraft-dev-bridge\config.json`（`MCBRIDGE_CONFIG` 可指定其他文件），与插件安装位置无关，两个宿主共用。未配置时，任一工具都会返回 `Run setup first`，并给出插件内 `setup.mjs` 的完整命令；技能会引导 agent 向你询问路径后执行。也可以在任意一份仓库副本中手动运行（参数换成本机路径）：

```powershell
node scripts/setup.mjs 'D:\Minecraft\.minecraft' 'Fabric 26.3' 'D:\test-server' 'C:\Program Files\Java\jdk-25'
```

setup 不覆盖现有配置。默认测试角色为 `CodexProbe`，独立游戏目录为 `%USERPROFILE%\.minecraft-dev-bridge\runtime\client`；需要时直接编辑配置文件。启动时只借用该 Fabric 配置的游戏和依赖，**不加载其中的其他模组**，原游戏目录不受影响。

## 从源码构建与本地开发

```powershell
node scripts/build.mjs
node --test tests/*.test.mjs
```

构建直接使用 Fabric 26.3 启动配置里的游戏/Fabric/Mixin 编译依赖，输出 `dist/minecraft-dev-bridge-26.3.jar`。Minecraft 26.3 已去除混淆；本构建无需映射和 Gradle。

本地克隆可直接作为市场安装：`claude plugin marketplace add <克隆目录>` 或 `codex plugin marketplace add <克隆目录>`，安装命令同上。Claude Code 对本地目录市场直接读取该目录（`claude plugin list` 显示 `Read from`），Codex 会复制到自己的缓存；修改后把 `.claude-plugin/plugin.json` 与 `.codex-plugin/plugin.json` 的 `version` 一起加一，再执行各自的更新命令。从 GitHub 安装时两边都使用缓存副本。Claude Code 也可用 `claude --plugin-dir <克隆目录>` 临时试用。在仓库中打开 Claude Code 时，`.claude/settings.json` 会屏蔽根目录 `.mcp.json` 的项目级加载，避免与已安装插件重复。

`scripts/install-local.mjs` 是旧的 Codex 个人安装方式：复制到 `%USERPROFILE%\plugins\minecraft-dev-bridge` 并生成绝对路径 MCP 配置，配合 `~/.agents/plugins/marketplace.json` 个人市场使用；`scripts/verify-live.mjs` 依赖该安装位置。`evidence/` 是已完成测试的历史样例，其中 JSON 路径属于执行测试的机器。

## 边界与恢复

- 当前客户端**仅支持 Java 26.3**，Fabric Loader >=0.19.5，JDK 25。1.12.2、其他版本和加载器需要单独适配。
- 启动器使用独立离线测试身份，只连接本机已配置的 offline-mode 测试服；不会修改服务器认证设置。正版服需要另外接入合法账号启动流程。
- 隐藏客户端仍需显卡和图形会话，不是无 GPU 的纯服务端机器人。默认 960×600、30 FPS、2 GiB 最大堆内存，仍会消耗 GPU/RAM。
- 控制端仅监听 127.0.0.1，使用每次启动生成的随机令牌。普通安装该 mod 但未启用 dedicated JVM 参数时不会启用接口或隐藏窗口。
- 一次输入最多 10 秒；游戏线程恢复执行时也会检查真实时间并释放过期输入。失去连接、菜单打开和场景结束都会释放。
- 首次连接看到资源包确认窗口时，先看 `mc_status.widgets`，再以当前 screen 类名和索引调用 `mc_ui_click`。
- JAR 暂存不代表已加载；不做危险的插件热卸载或通用 `/reload`。现有服务器生命周期由项目原有启动流程管理。
- 启动失败查看 `mc_logs` 的 `launcher`；已有进程尚在启动/退出时会拒绝重复启动。普通退出使用 `mc_shutdown`，无需操作桌面。
- 首次 MCP 工具加载需要新会话；当前会话可以使用同一实现的 CLI（`node <插件根目录>/scripts/cli.mjs`）。

## 技术依据

- [Fabric 26.3 版本说明](https://www.fabricmc.net/2026/09/15/263.html)
- [MCP stdio 传输规范](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports)
- [Codex 插件打包说明](https://developers.openai.com/plugins/build/plugins)
- [Claude Code 插件说明](https://code.claude.com/docs/en/plugins/manifest-reference)

实际客户端 API 以 26.3 jar 的 `javap` 结果和真实运行验证为准。
