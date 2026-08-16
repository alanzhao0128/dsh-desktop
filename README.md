# dsh-desktop — DeepSeek Harness 桌面壳

一个极薄的 Electron 壳：打开后自动执行 `npx @deepseek-ai/dsh web`，然后用窗口内嵌的 Chromium 内核加载 `http://127.0.0.1:3080`。**完全不修改 dsh 本身的任何东西**——dsh 仍然以原生命令 `npx @deepseek-ai/dsh web` 运行，只是多了一个原生窗口。

## 特性

- **每次启动都从 npx 拉取最新版本**：内部执行 `npx --yes --prefer-online @deepseek-ai/dsh web`（`--yes` 避免交互卡住，`--prefer-online` 强制每次联网校验 registry，取最新发布版；核心命令就是 `npx @deepseek-ai/dsh web` 不变）。
- **智能复用**：如果 `3080` 端口已经有 dsh web 在跑（比如浏览器里已经开着一个），壳直接复用，不会重复启动；只有端口空闲时才自己拉起一个。
- **macOS 惯例的窗口行为**：点窗口的 ✕ 只关窗口，app 进程和 dsh web 服务都继续运行（Dock 里还在，点图标重新开窗会直接复用仍在跑的服务）；**Cmd+Q**（或菜单退出）才真正退出 app，并只杀掉**自己拉起**的 dsh 进程树；复用的外部实例保持不动。Windows/Linux 上保持"关窗口即退出"的惯例。
- **启动过程可见**：npx 首次下载可能较慢，窗口内显示进度；失败时显示原因和日志路径，可一键重试。
- **日志**：写到 `~/Library/Application Support/dsh-desktop/logs/`（shell.log + dsh.log），帮助菜单可直接打开日志目录。
- **外链走系统浏览器**：窗口内只允许访问本机 dsh 服务，其他链接交给默认浏览器。

## 运行（开发模式）

```sh
npm install
npm start
```

## 打包为 macOS App

```sh
npm run pack:mac          # 产出 dist/*.zip
npm run pack:mac:dir      # 仅产出 dist/mac-arm64/*.app（最快）
npm run pack:mac:dmg      # 用系统 hdiutil 产出 dist/*.dmg（需先跑 pack:mac:dir）
```

未签名的本地构建首次打开若被 Gatekeeper 拦截，执行：

```sh
xattr -cr dist/mac-arm64/DeepSeek\ Harness.app
```

## 配置

| 环境变量 | 作用 | 默认 |
|---|---|---|
| `DSH_DESKTOP_PORT` | 壳探测/加载/启动 dsh 用的端口 | `3080` |
| `DSH_NPM_CACHE` | 透传给 npx 的 npm 缓存目录（一般不需要） | 无（用 npm 默认缓存） |

例：`DSH_DESKTOP_PORT=3090 npm start` 会用 `--port 3090` 启动 dsh 并加载该端口。

## 项目结构

```
src/
  main.js           Electron 主进程：窗口、生命周期、菜单、启动编排
  server-manager.js 纯 Node 模块：spawn npx / 端口探活 / 复用检测 / 进程树清理
  preload.js        壳本地页面的最小桥（loading/error 页用）
  logger.js         文件日志
  pages/shell.html  启动中/错误/重试 页
scripts/
  smoke.js          无窗口全链路测试：node scripts/smoke.js
```

## 测试

```sh
npm run smoke
```

smoke 会真实执行一次「npx 拉最新包 → 启动 dsh web → 探活就绪 → 关闭并确认端口释放」的完整链路（使用独立端口 `3090` 和独立的 `DSH_HOME`，不影响你的真实环境），并检查默认端口 `3080` 上已有实例的复用检测。

## 平台支持

当前面向 **macOS**。结构上已为 Windows 预留：

- `server-manager.js` 的进程启动/清理按平台分支（Windows 走 `cmd.exe /c` + `taskkill /T /F`）；
- `electron-builder` 已配置 `win.nsis` 目标（在 Windows 机器上执行 `npx electron-builder --win` 即可出包，macOS 上无法交叉打包 Windows 安装包）。

## 已知限制

- dsh 与壳是**两个进程**：关掉壳的窗口（不退出 app）时服务继续运行，浏览器里已打开的 dsh 页面不受影响（那只影响 UI，不影响服务）；只有 Cmd+Q 退出 app 才会停掉由壳拉起的服务。
- 打包后的 .app 双击启动时没有终端，npx 的输出只进日志文件；出错时窗口会显示日志路径。
