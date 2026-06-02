# 开发者说明

## 开发环境

需要安装：

- **Node.js** ≥ 18 + npm
- **Python** ≥ 3.10 + uv（本项目用 uv 管理）
- Windows 10/11（视觉感知功能依赖 win32gui）

若不适用 uv，请自行更改 electron/package.json 的 `backend` 启动命令为 `python -m uvicorn main:app --reload --port 8000`，并确保安装了 `uvicorn`。

```bash
# 克隆项目
git clone <repo-url>
cd testvtuber

# 后端
cd backend
uv sync

# 前端依赖
cd ../electron
npm install
```

## 项目结构（三层）

```
testvtuber/
├── backend/           ← Python FastAPI :8000
│   ├── main.py        ← 配置加载、路由、SSE 推送、模块初始化
│   ├── llm_client.py   ← OpenAI 兼容客户端（单函数 ask_llm，由 main 注入模型名）
│   ├── vision.py       ← 统一感知模块（后台线程：句柄轮询→截屏→视觉识别→主动消息）
│   ├── config.json     ← 所有可调参数（窗口尺寸、模型路径、冷却时间等）
│   ├── .env            ← API 密钥（不入版本控制）
│   ├── .env.template   ← .env 模板（可入库）
│   └── build.spec      ← PyInstaller 配置
├── frontend/          ← 纯静态页面
│   ├── index.html     ← PixiJS + pixi-live2d-display CDN 引入
│   ├── main.js        ← 核心逻辑：DOM 引用、Live2D 加载、消息发送、SSE 监听、气泡穿透
│   ├── styles.css     ← 透明窗口布局、气泡动画、菜单面板
│   └── live2d-models/  ← Live2D 模型文件（.model3.json + 贴图 + 动作）
├── electron/          ← 桌面壳
│   ├── main.js        ← BrowserWindow 创建（透明置顶无边框）、Tray 托盘、IPC、spawn 后端
│   ├── preload.js     ← contextBridge 暴露 electronAPI（exit/getConfig/showWindow/穿透）
│   └── package.json   ← electron-builder 打包配置、dev 依赖
├── README.md          ← 公开说明
├── INSTALL.md         ← 用户安装指南
├── CONFIG.md          ← config.json 字段说明
└── DEVELOPMENT.md     ← 本文件
```

## 开发模式运行

### 方式一：一键启动

```bash
cd electron
npm start
```

内部用 concurrently 同时启动：
- `uvicorn main:app --reload --port 8000`（后端热重载）
- `electron .`（桌面窗口）

### 方式二：分别启动（调试方便）

```bash
# 终端 1：后端
cd backend
uvicorn main:app --reload --port 8000

# 终端 2：Electron
cd electron
npx electron .
```

前端页面由 Electron 通过 `loadFile` 直接加载 `frontend/index.html`，不走 HTTP 服务器。

## 前后端通信

```
┌─ Frontend ─────────────────────────┐
│                                     │
│  HTTP POST /chat    → 用户对话      │
│  HTTP GET  /config  → 配置回退      │
│  HTTP GET  /status  → 视觉状态      │
│  HTTP POST /vision/enabled → 开关   │
│  EventSource /events → SSE 接收     │
│                                     │
└──────────┬──────────────────────────┘
           │
┌──────────▼─ Backend ────────────────┐
│                                     │
│  main.py                            │
│  ├─ /chat      → build_messages()   │
│  │                → ask_llm()       │
│  │                → parse_llm_response()
│  │                → 更新 history    │
│  ├─ /events    → SSE 订阅者队列     │
│  │                ← broadcast()     │
│  │                                   │
│  └─ vision.py（后台线程）            │
│     ├─ _poll_loop()   → 窗口轮询    │
│     ├─ _capture_screenshot()        │
│     ├─ _recognize_activity() → Qwen │
│     └─ _on_stable_handle()          │
│          → ask_llm()                │
│          → broadcast() → SSE 推送   │
│                                     │
└─────────────────────────────────────┘
```

## 关键协议

### LLM 输入格式

`build_messages()` 构建的消息列表：
```
[system_prompt] + [最近 N 轮历史] + [当前用户消息]
```

历史中包含视觉感知消息：`[视觉感知]{活动描述}`

### LLM 输出格式

JSON，后端 `parse_llm_response()` 校验：
```json
{"text": "回复内容", "action": "gentle_smile"}
```

action 必须在 config.json 的 `actions` 列表中，非法时降级为 `gentle_smile`。

## 视觉感知工作流程

1. 后台线程每 `poll_interval` 秒获取前台窗口标题
2. 跳过桌宠自己的窗口（`skip_window_title` 匹配）
3. 标题保持 `stable_duration` 秒不变 → 视为新句柄
4. 检查全局冷却（`handle_cooldown`）和同窗口冷却（`same_handle_cooldown`）
5. 截全屏 → base64 → Qwen-VL → 活动描述
6. 活动描述写入对话历史 → 调 LLM 生成主动消息 → SSE 推送到前端
7. 用户正在聊天时自动跳过轮询

## 打包

### 1. Python → backend.exe

```bash
cd backend
uv run pyinstaller build.spec
# 输出: backend/dist/backend.exe
```

`build.spec` 中包含 uvicorn 子模块的 hiddenimports，确保打包后能正常启动 HTTP 服务。

**注意**：打包后的 `backend.exe` 不能单独启动（会直接退出），必须通过 Electron 启动（传 `--electron` 参数）。这是为了防止视觉模块单独运行消耗 token。

### 2. Electron → 便携包 / 安装包

```bash
cd electron
npm run dist
# 输出: electron/dist/Mini Live2D AI-x.x.x-win.zip（便携版）
```

electron-builder 配置在 `electron/package.json` 的 `build` 字段：
- `win.target: "zip"` — 生成便携 zip 包（如需 NSIS 安装包改为 `"nsis"`，需网络能访问 GitHub）
- `extraFiles`：backend.exe、config.json、.env.template
- `extraResources`：frontend/（HTML + JS + CSS + Live2D 模型）
- 打包时通过 `app.isPackaged` 判断切换路径

### 解压后目录结构

```
安装目录/
├── Mini Live2D AI.exe          ← Electron
├── resources/
│   ├── app.asar                ← Electron 核心代码
│   └── frontend/               ← 前端 + Live2D 模型
├── backend.exe                 ← Python 后端
├── config.json                 ← 用户可编辑
├── .env.template               ← 环境变量模板
└── .env                        ← 用户自行创建
```

### 打包注意事项

1. 先打 PyInstaller，确保 `backend/dist/backend.exe` 存在
2. 再打 electron-builder，它会从 `../backend/dist/backend.exe` 复制
3. backend.exe 中 `.env` 从工作目录（即安装目录）加载，不是从 resources 内部
4. `skip_window_title` 必须和 Electron 窗口的 `title` 一致，否则视觉模块会截自己的屏
5. Live2D 模型文件较大，`extraResources` 不打入 asar，方便用户替换模型

## 代码风格

- **注释**：全部中文
- **Python**：统一 docstring（`"""..."""`）、完整类型标注
- **JavaScript**：双引号、每个函数上方 `/** */` 注释
- **变量分组**：按用途分组加注释（如 `// DOM 元素引用`、`// 运行时状态`）
- 无装饰性分隔线、无无意义注释
