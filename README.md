# dsh-closure-pet-overlay

可露希尔桌宠 · **桌面浮窗版**（DeepSeek Harness 插件）。

原版 [dsh-closure-pet](https://github.com/fengshiyangrouguan/dsh-closure-pet) 把桌宠画在 DSH 页面里，只能待在浏览器窗口内。本插件保留原版的全部动画、交互、气泡与右键设置面板，但把桌宠搬到一个**独立的透明置顶窗口**里：

- 可以出现在任意显示器的任意位置（包括 DSH 窗口之外）
- **随 DSH 启停**：DSH 打开时自动出现，DSH 关闭时自动退出，不需要单独启动一个软件
- 跨屏自由拖动（默认不吸附）
- 点击穿透：只有鼠标落在桌宠 / 气泡 / 设置面板上时窗口才接收点击，其余区域完全交给下层窗口

## 功能

- **自由拖动**：按住桌宠拖到任何位置，跨显示器不卡顿；位置持久化（见下文「位置记忆」）
- **点击穿透**：渲染进程做命中测试（`pointermove` 的 client 坐标），命中时通过 IPC 关闭穿透，移开后恢复
- **右键设置面板**：大小、镜像、气泡开关、气泡缩放、透明度、音效、音量
- **运行中助手**：AI 开始思考/输出时自动弹一句
  `可露希尔正在思考… · 已 N 分钟 / 今日 21M tokens`；点击桌宠可看余额、今日/本轮花费、今日 token、来源脚注（provider / model / cost）与峰谷倒计时
- **谷价贴画**：谷时点击桌宠弹出 −99% 像素贴画，尺寸跟随桌宠大小缩放
- **配置隔离**：设置写入 `$DSH_HOME/.dshcl-overlay.json`，与原页面版插件的 `.dshcl.json` 互不干扰

## 安装

```bash
# 从 GitHub 安装（推荐）
dsh plugin --profile desktop add github:loffeat/dsh-closure-pet-overlay

# 或从本地目录安装（开发用）
dsh plugin --profile desktop add "file:D:/path/to/dsh-closure-pet-overlay"
```

安装后**重启 DSH Desktop** 生效（插件宿主代码不会热重载）。

环境要求：

- DeepSeek Harness Desktop `>= 0.2.0`（实测 0.2.2-rc.5）
- Windows 10 / 11
- 需要 `$DSH_HOME/electron/electron.exe`（DSH Desktop 自带，`dsh-pet-lite` 也会下载同一个；缺失时插件日志会提示）

## 工作原理

```
DSH 核心进程
  └── dsh-closure-pet-overlay (Cordis 插件, lib/index.js)
        ├── 本地 HTTP 服务 (127.0.0.1:39143)：/pet.html /pet.js /dsh-closure/state /dsh-closure/config /dsh-closure/assets/*
        └── spawn electron.exe lib/helper/main.cjs
              └── 透明置顶窗口（覆盖所有显示器并集）
                    ├── 加载 /pet.html -> 复用原版前端（assets/src）
                    ├── 渲染进程命中测试 -> IPC pet:interact-mode -> setIgnoreMouseEvents
                    └── 父进程看门狗（process.ppid 轮询），DSH 退出后自动结束
```

几个关键实现点（踩过的坑）：

1. **多屏覆盖**：Windows 会把初始 `BrowserWindow` 尺寸夹到主屏，需要在 `ready-to-show` 前调用 `win.setBounds(所有屏幕并集)` 才能覆盖多屏。
2. **点击穿透**：不要在主进程用 `screen.getCursorScreenPoint()` 和渲染进程的 CSS rect 做坐标换算（混合 DPI 下会对不上），直接让渲染进程用 `pointermove` 的 `clientX/clientY` 做命中测试，再通过 IPC 切换 `setIgnoreMouseEvents`。
3. **helper 不能监听 stdin**：Electron 在 Windows GUI 模式下启动后 stdin 会立刻 EOF，`process.stdin.on('end', () => app.quit())` 会导致浮窗 0.6 秒就退出（exit code 0）。现在改为轮询 `process.ppid` 判断宿主是否存活。
4. **pnpm 对 `file:` 依赖是复制而不是软链**：本地开发时改 `D:\...\plugins\...` 不会影响已安装到 profile 的副本，需要同步复制到 `~/.dsh/profiles/<profile>/node_modules/<plugin>/`，或重装插件。

## 配置

`$DSH_HOME/.dshcl-overlay.json`：

```jsonc
{
  "version": 1,
  "settings": {
    "mirror": "auto",        // auto | never | always
    "size": 0.6,             // 桌宠大小
    "bubble": true,          // 气泡 / 贴画总开关
    "bubbleScale": 50,       // 气泡缩放 50-200
    "bubbleTiers": true,     // 分级字号
    "snapStrength": 0,       // 0 = 自由拖动；越大越靠近边缘吸附
    "opacity": 1,
    "sound": true,
    "volume": 0.7
  },
  "spend": { /* 宿主半记账，运行时写入 */ }
}
```

> 注意：运行中的宿主会周期性回写 `settings`，手工改文件请在**杀掉 DSH 进程之后、启动之前**改；或直接右键面板里改。

### 位置记忆

桌宠位置存在前端 `localStorage`（按 origin 分区），因此固定端口 `39143` 才能跨重启记住位置；如果端口被占用会回退到随机端口，此时位置仅在本次运行有效。可用环境变量 `DSH_PET_OVERLAY_PORT` 指定端口。

## 开发

```bash
npm i
npm run build     # esbuild 打包 assets/src/desktop-entry.js -> assets/client.js
```

注意 esbuild 必须带 `charset: 'utf8'`（脚本已带），否则中文字符串会被转义成 `\uXXXX`，页面里显示为乱码。

改完前端后：

```powershell
Copy-Item assets\client.js "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-closure-pet-overlay\assets\client.js" -Force
Get-Process electron | Stop-Process -Force   # 插件 5s 后自动拉起新 helper
```

改 `lib/index.js`（宿主半）则需要重启 DSH。

## 已知限制

- 仅 Windows（多屏合并窗口 + 鼠标穿透基于 Win32 行为）
- 位置记忆依赖固定端口
- 首次启动时窗口显示大约需要 1 秒（Electron 冷启动）

## 致谢与许可

- 原项目：[fengshiyangrouguan/dsh-closure-pet](https://github.com/fengshiyangrouguan/dsh-closure-pet)（MIT License, Copyright (c) 2026 FSYRG）。本插件的动画素材（WebM）、音效、像素字体与大部分前端逻辑来自原项目。
- 本仓库为 MIT License，见 [LICENSE](LICENSE)。
