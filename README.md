# Mini Live2D AI

基于 Live2D 的 VTuber 风格 AI 桌面助手。输入文字即可与 Live2D 角色实时对话，角色会根据 LLM 回复的情绪词播放对应动作，悬浮于桌面置顶显示。

## 模型来源及权利说明

本项目内置的示例模型仅用于演示：
- **来源**：[Bilibili - 什行在要](https://www.bilibili.com/video/BV1pv421r7NT/)
- **权利声明**：**本项目（Mini Live2D AI）的开源协议仅适用于项目源代码，不包含 `frontend/live2d-models/` 目录下的模型资产。** 模型的所有权、使用授权及解释权归原作者所有。
- **使用建议**：如需将该模型用于商业用途或二次分发，请获得原作者授权。

## 快速开始

详见 [INSTALL.md](./INSTALL.md)（安装与配置指南）。

配置参数说明见 [CONFIG.md](./CONFIG.md)。

开发者请参阅 [DEVELOPMENT.md](./DEVELOPMENT.md)。

## 技术栈

| 层 | 技术 |
|---|------|
| 后端 | Python + FastAPI + uvicorn |
| AI | DeepSeek（文本对话）+ Qwen-VL（视觉感知，可选） |
| 前端 | PixiJS + pixi-live2d-display（Live2D Cubism 4 渲染） |
| 桌面壳 | Electron（无边框透明窗口 + 系统托盘） |

## 核心特性

- **LLM 对话**：接入 DeepSeek（或其他 OpenAI 兼容服务），支持多轮上下文记忆
- **Live2D 动作驱动**：LLM 返回动作标签，角色播放对应情绪动画（8 种动作可配）
- **视觉感知**（可选）：后台截屏 + Qwen-VL 识别用户当前活动，角色主动搭话
- **桌面置顶**：无边框透明窗口，固定右下角，不遮挡其他应用
- **系统托盘**：最小化到托盘，右键退出
- **气泡对话**：AI 回复逐字打字效果，超时自动消失

## 架构

```
┌──────────────────────────────────────────┐
│  Electron（桌面壳）                        │
│  ├─ 无边框透明窗口                         │
│  ├─ 系统托盘                              │
│  └─ spawn backend.exe（打包模式）           │
├──────────────────────────────────────────┤
│  Frontend（HTML + JS + CSS）               │
│  ├─ PixiJS 渲染 Live2D 模型               │
│  ├─ 气泡区 + 输入框                        │
│  └─ SSE 连接 → 接收主动推送                │
├──────────────────────────────────────────┤
│  Backend（Python FastAPI :8000）           │
│  ├─ /chat  →  LLM 对话                   │
│  ├─ /events →  SSE 推送                  │
│  └─ vision    →  后台视觉感知线程          │
└──────────────────────────────────────────┘
```

## 项目结构

```
testvtuber/
├── backend/           ← Python FastAPI 后端
│   ├── main.py        ← 路由、配置、入口
│   ├── llm_client.py   ← LLM API 客户端
│   ├── vision.py       ← 视觉感知模块
│   ├── config.json     ← 所有可调参数
│   ├── .env            ← API 密钥（不入仓库）
│   └── .env.template   ← .env 模板
├── frontend/          ← 前端静态页面
│   ├── index.html
│   ├── main.js
│   ├── styles.css
│   └── live2d-models/  ← Live2D 模型文件
├── electron/          ← Electron 桌面壳
│   ├── main.js         ← 窗口创建、托盘、IPC
│   ├── preload.js      ← 安全桥接
│   └── package.json    ← 依赖 + 打包配置
├── README.md
├── INSTALL.md
└── DEVELOPMENT.md
```

## License

本项目代码部分采用 **ISC** 协议开源。

1. **资产授权**：本项目仓库中可能包含的 Live2D 模型、动作文件、贴图等资源**不属于** ISC 协议涵盖范围。这些资源遵循其原作者的授权协议，请在法律允许的范围内使用。
2. **免责声明**：开发者因违规使用他人模型资产导致的版权纠纷，本项目作者不承担任何法律责任。
