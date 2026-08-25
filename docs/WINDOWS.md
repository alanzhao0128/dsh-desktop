# Windows 支持（构建与运行）

> **当前状态**：代码层已就绪（进程启动/清理、菜单、图标 `.ico`、electron-builder `nsis` 配置均已预留），但**尚未在真实 Windows 机器上验证和打包**。下面步骤基于代码逻辑，请在 Windows 机器上实测后反馈问题。

## 前置要求

- Windows 10/11（x64 或 arm64）
- [Node.js LTS](https://nodejs.org)（含 `npm` / `npx`，会把 `npx.cmd` 加入 PATH）
- Git（可选，用于 clone）

## 运行（开发模式）

```powershell
git clone https://github.com/alanzhao0128/dsh-desktop.git
cd dsh-desktop
npm install
npm start
```

壳会执行 `npx --yes --prefer-online @deepseek-ai/dsh web --no-open` 并加载 `http://127.0.0.1:3080`（`--no-open` 阻止 dsh 额外打开默认浏览器）。

## 打包 Windows 安装包

```powershell
npx electron-builder --win
```

产物在 `dist/`：

| 文件 | 说明 |
|---|---|
| `DeepSeek Harness Setup 0.1.x.exe` | NSIS 安装包（默认目标） |
| `DeepSeek Harness 0.1.x-win.exe`（若配 portable） | 免安装便携版 |

> 必须在 **Windows** 上打包（macOS 无法交叉编译 nsis）。图标已用 `build/icon.ico`（16–256 多尺寸，与 mac 版同一设计）。

## Windows 特有行为说明

- **进程启动**：`server-manager.js` 通过 `cmd.exe /d /s /c "npx ..."` 启动；`npx.cmd` 由 cmd 从 PATH 解析。
- **进程清理**：关闭壳时用 `taskkill /pid <pid> /T /F` 杀掉整个进程树（含 dsh 派生的子进程）。
- **复用逻辑与 mac 一致**：只探测 `127.0.0.1:3080` 是否有 dsh web 指纹，**不区分版本**；手动跑在 3080 的 dsh（任何版本）会被直接复用。
- **日志路径**：`%APPDATA%\dsh-desktop\logs\`（`shell.log` + `dsh.log`），帮助菜单可打开。
- **已知差异**：Windows 控制台默认编码下 dsh 中文日志可能显示乱码，不影响功能（shell 窗口内的 UI 由 dsh 前端渲染，不受影响）。

## 待实测清单（拿到 Windows 机器后）

- [ ] `npm start` 能否正常拉起 dsh web 并加载 UI
- [ ] `npx @deepseek-ai/dsh web` 在 Windows 上沙箱/工具链是否完整可用
- [ ] 关闭壳时 `taskkill` 是否正确清掉进程树
- [ ] 3080 已有手动 dsh 进程时是否正确复用（含 next 版本场景）
- [ ] `electron-builder --win` 打包与安装、图标显示、开始菜单快捷方式

## 如何反馈问题

在 [GitHub Issues](https://github.com/alanzhao0128/dsh-desktop/issues) 提交，附上：

1. Windows 版本（`winver`）
2. `%APPDATA%\dsh-desktop\logs\shell.log` 内容
3. 复现步骤
