# Minecraft Dev Bridge

给 Codex 使用的 Minecraft 插件验证工具。独立测试客户端以**隐藏窗口**运行；动作由游戏内部执行，截图直接读取游戏帧缓冲区。你可以继续操作电脑或另一个游戏客户端。

源码仓库：[HappyWithMin/Minecraft-Dev-Bridge](https://github.com/HappyWithMin/Minecraft-Dev-Bridge)。仓库包含桥接模组源码、已构建的桥接 JAR、MCP 工具、技能、测试和验证样例；不包含 Minecraft 游戏依赖或本机运行配置。

## 已实现

- 本地 RCON 服务端命令和服务端日志。
- 独立客户端启动/退出、玩家命令、走跑跳潜行、视角、第一/第三人称、快捷栏、攻击/使用物品、背包与插件菜单操作。
- 默认 1080p、最高 4K 的实际渲染截图，MCP 直接返回图像；完成后自动恢复原分辨率。
- 后台连续帧采集，保存无损 PNG、逐帧时间/游戏状态、漏采统计，以及可播放和逐帧检查的离线页面。
- 场景串行执行、状态断言、失败清理和 JSON 验证记录。
- 服务端插件 JAR 暂存到 `plugins/update`，SHA-256 与旧暂存文件备份。
- 21 个 MCP 工具、一个 `minecraft-validation` 技能，无 npm 第三方依赖。

## 本机配置

配置保存在 `%USERPROFILE%\.minecraft-dev-bridge\config.json`，不打包进入插件。已连接现有本地测试服 `127.0.0.1:25577`；读取该服现有 RCON 配置。测试角色为 `CodexProbe`，游戏目录是 `%USERPROFILE%\.minecraft-dev-bridge\runtime\client`。

使用安装好的 Fabric 26.3 启动配置获取游戏和依赖，但**不复制该配置中的其他模组**。桥接 jar 只进入独立测试目录。原来的游戏目录和 1.12.2 整合包不受影响。

## 使用

安装后在新的 Codex 聊天中说：

> 用 minecraft-dev-bridge 在后台验证 PlayerModel：进入模型菜单，测试走跑跳、第三人称和持物，截图并报告。

MCP 名称可能带插件前缀。最常用的是 `mc_launch`、`mc_status`、`mc_server_command`、`mc_input`、`mc_screenshot`、`mc_run_scenario`、`mc_shutdown`。截图也能通过 `view_image` 打开返回的本地路径。

当前聊天或终端可直接运行：

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

## 构建与安装

需要 Windows、Node.js 22+、JDK 25，以及已安装且包含完整依赖的 Fabric 26.3 启动配置。源码不包含 Minecraft 游戏或账号凭证。

新机器先运行（参数换成本机路径）：

```powershell
node scripts/setup.mjs 'D:\Minecraft\.minecraft' 'Fabric 26.3' 'D:\test-server' 'C:\Program Files\Java\jdk-25'
node scripts/build.mjs
node --test tests/*.test.mjs
```

setup 不覆盖现有配置。构建直接使用该启动配置里的游戏/Fabric/Mixin 编译依赖，输出 `dist/minecraft-dev-bridge-26.3.jar`。Minecraft 26.3 已去除混淆；本构建无需映射和 Gradle。

`scripts/install-local.mjs` 把插件复制到 `%USERPROFILE%\plugins\minecraft-dev-bridge`，生成本机 MCP 启动配置。个人市场条目由 Codex `plugin-creator` 脚手架创建。然后使用 `codex plugin add minecraft-dev-bridge@personal` 安装。更新时使用 plugin-creator 的 cachebuster 工具后再安装，新聊天会加载更新后的技能和工具。

从 GitHub 克隆后，先按上面的步骤完成本机 setup，再运行 `node scripts/install-local.mjs`。仓库内的 `.mcp.json` 根据当前用户主目录定位个人安装位置；安装脚本生成的配置使用本机 Node 可执行文件和脚本绝对路径。`evidence/` 是已完成测试的历史样例，其中 JSON 路径属于执行测试的机器，不是其他机器的启动配置。

## 边界与恢复

- 当前客户端**仅支持 Java 26.3**，Fabric Loader >=0.19.5，JDK 25。1.12.2、其他版本和加载器需要单独适配。
- 启动器使用独立离线测试身份，只连接本机已配置的 offline-mode 测试服；不会修改服务器认证设置。正版服需要另外接入合法账号启动流程。
- 隐藏客户端仍需显卡和图形会话，不是无 GPU 的纯服务端机器人。默认 960×600、30 FPS、2 GiB 最大堆内存，仍会消耗 GPU/RAM。
- 控制端仅监听 127.0.0.1，使用每次启动生成的随机令牌。普通安装该 mod 但未启用 dedicated JVM 参数时不会启用接口或隐藏窗口。
- 一次输入最多 10 秒；游戏线程恢复执行时也会检查真实时间并释放过期输入。失去连接、菜单打开和场景结束都会释放。
- 首次连接看到资源包确认窗口时，先看 `mc_status.widgets`，再以当前 screen 类名和索引调用 `mc_ui_click`。
- JAR 暂存不代表已加载；不做危险的插件热卸载或通用 `/reload`。现有服务器生命周期由项目原有启动流程管理。
- 启动失败查看 `mc_logs` 的 `launcher`；已有进程尚在启动/退出时会拒绝重复启动。普通退出使用 `mc_shutdown`，无需操作桌面。
- 首次 MCP 工具加载需要新聊天；当前聊天可以使用同一实现的 CLI。

## 技术依据

- [Fabric 26.3 版本说明](https://www.fabricmc.net/2026/09/15/263.html)
- [MCP stdio 传输规范](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports)
- [Codex 插件打包说明](https://developers.openai.com/plugins/build/plugins)

实际客户端 API 以本机 26.3 jar 的 `javap` 结果和真实运行验证为准。
