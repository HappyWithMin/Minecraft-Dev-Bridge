# 本机验证记录

验证日期：2026-10-02。客户端 Minecraft Java 26.3、Fabric Loader 0.19.5、JDK 25.0.2；服务端为现有本地 Paper 26.3 / PlayerModel，测试身份 `CodexProbe`。

## 已实际完成

- Java 模组编译成功，产物 `dist/minecraft-dev-bridge-26.3.jar`。
- 九项 Node 自动化测试通过：原有六项 RCON、参数、场景、断言、JAR 暂存与 MCP 测试，以及采集预算、文件路径/HTML 转义、Java 采样计划/无损 PNG 像素往返检查。
- 安装到个人市场并启用，Codex MCP 配置中 `minecraft_dev_bridge.enabled=true`。
- 经安装配置指定的 MCP 进程完成 initialize、21 个工具枚举、真实服务端 `list`、单张和连续帧的 MCP 图片返回。
- 客户端真实进服。SDL 状态：`hidden=true`、`focused=false`；游戏状态：`mouseGrabbed=false`。正常渲染为 960×600、约 30 FPS。
- 未带令牌请求返回 401；带浏览器 Origin 的请求返回 403。
- 后台确认资源包；服务端 `pmodel status CodexProbe` 报告 `pack=loaded (client: successfully_loaded)`，第三人称截图中可见酒狐。
- 前进+疾跑+跳跃持续 1000 ms，z 从 -0.5 到约 6.50；结束后 `inputRemainingMs=0`。
- `/pmodel` 打开“模型衣橱”；通过容器槽位操作切换至“动作舞台”。
- 拉弓期间 `usingItem=true`，释放后恢复 false，保存实际持物画面。
- 故意制造断言失败后，输入被清理；报告中的 `passed=false` 是该负向测试的预期结果。
- MCP 中途停止可抢先于场景等待执行，取消其余步骤，并确认输入归零。
- 正常关闭并重新启动测试客户端成功；交付前已通过 `mc_shutdown` 关闭测试客户端。原有服务器保持运行。
- 插件 manifest 和 skill 验证器通过。

## 高分辨率与连续帧升级

- 实际渲染 3840×2160 PNG 成功，核对文件尺寸并检查画面；保存后恢复至 960×600、30 FPS。
- 1920×1080、10 FPS、3 秒：保存 30/30 帧，实际约 9.97 FPS，无漏采和写盘背压丢帧。连续帧包含拉弓、释放和改变视角，逐帧时间与渲染序号单调递增。
- 1280×720、30 FPS、2 秒：保存 60/60 帧，实际约 29.84 FPS。
- 在采集中请求另一个截图会明确拒绝；提前停止保留已有帧，并恢复渲染设置。
- 故意让含采集步骤的场景断言失败，确认其采集停止、输入归零、原渲染尺寸和 FPS 限制恢复。
- 全程仍为 `hidden=true`、`focused=false`、`mouseGrabbed=false`，没有操作全局鼠标键盘。
- 输出逐帧 PNG、manifest.json 和离线 index.html。回放页浏览器交互未实测：浏览器工具安全策略禁止打开本地 file:// 地址；截图内容、帧数据和 MCP 图片返回已实际验证。

以上帧率为本机本次测试场景结果；复杂模型、资源包和其他 GPU 负载可能造成漏采，应以每次 manifest 的时间与计数为准。

## 证据

- [安装后 MCP 验证与停止测试](evidence/installed-mcp-check.json)
- [移动/自动松开报告](evidence/movement.json)
- [拉弓/释放报告](evidence/bow-use.json)
- [预期失败与清理报告](evidence/expected-failure-cleanup.json)
- [隐藏客户端第三人称截图](evidence/hidden-third-person.png)
- [插件动作菜单截图](evidence/plugin-menu.png)
- [拉弓截图](evidence/bow-use.png)
- [本次 4K 截图](evidence/capture-upgrade/screenshot-4k.png)
- [本次逐帧回放](evidence/capture-upgrade/sequence/index.html)
- [高分辨率与连续帧验证报告](evidence/capture-upgrade/verification.json)

这些验证证明后台控制与截图流程可用，不代表 PlayerModel 的全部动画、多人同步、光影兼容和延迟已完成回归。未将桥接客户端模组放进用户正在玩的 1.12.2 整合包，也未重启或替换测试服现有 PlayerModel。
