# 安装与配置指南

## 环境要求

- Windows 10 或 11
- 不需要安装 Python 或 Node.js

## 安装

1. 解压 `Mini Live2D AI-x.x.x-win.zip` 到任意目录
2. 解压后目录中包含 `Mini Live2D AI.exe`、`config.json`、`.env.template` 等文件
3. 配置 API Key（见下文）
4. 无需安装，配置完成后双击 `Mini Live2D AI.exe` 即可运行

## 配置 API Key

应用需要 LLM 服务才能对话，默认使用 DeepSeek。

### 1. 创建 .env 文件

将安装目录下的 `.env.template` 复制一份，改名为 `.env`：

```
安装目录/
├── .env.template   ← 复制这个
└── .env            ← 重命名为这个，然后编辑
```

### 2. 填写 API Key

用文本编辑器（记事本即可）打开 `.env`，填入你的 Key：

```ini
# LLM 配置（必需，否则无法对话）
DEEPSEEK_API_KEY=sk-你的key

# 官方 API 地址，一般不用改
DEEPSEEK_BASE_URL=https://api.deepseek.com

# 视觉模型配置（可选，不填请禁用视觉感知）
DASHSCOPE_API_KEY=sk-你的key
DASHSCOPE_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
```

### 获取 API Key

| 服务 | 用途 | 获取地址 |
|------|------|---------|
| DeepSeek | 文本对话（必需） | https://platform.deepseek.com/api_keys |
| DashScope | 视觉感知（可选） | https://dashscope.console.aliyun.com/apiKey |

DashScope（通义千问）的模型有免费试用额度。

### 3. 使用本地模型（可选）

如果你有本地部署的 LLM（如 Ollama、vLLM、LM Studio 等），只要它兼容 OpenAI API 格式（`/v1/chat/completions`），就可以直接接入。

**修改 `.env`**：

```ini
# 本地模型一般不需要真实 Key，填一个占位即可
DEEPSEEK_API_KEY=sk-no-key-required

# 指向本地服务地址（根据你使用的框架修改）
DEEPSEEK_BASE_URL=http://127.0.0.1:11434/v1
```

**修改 `config.json`**：

```json
{
  "api": {
    "llm_model": "你的模型名",
    "timeout": 120
  }
}
```

常见本地框架参考：

| 框架 | 默认地址 | llm_model 示例 |
|------|----------|----------------|
| Ollama | `http://127.0.0.1:11434/v1` | `qwen2.5:7b` |
| vLLM | `http://127.0.0.1:8001/v1` | 与加载的模型一致 |
| LM Studio | `http://127.0.0.1:1234/v1` | 与加载的模型一致 |

> **端口注意**：本项目的后端固定占用 **8000 端口**（不可修改）。如果本地框架默认也用 8000（如 vLLM），需要改本地框架的启动端口，而不是改本项目的配置。例如 vLLM 启动时加 `--port 8001`。

### 4. 编辑 config.json（可选）

`config.json` 包含所有可调参数，用文本编辑器打开即可修改。

**常用调整项**：

| 字段 | 默认值 | 说明 |
|------|--------|------|
| `model.name` | `”shu”` | 角色名，显示在历史记录中 |
| `api.llm_model` | `”deepseek-chat”` | LLM 模型名，需与 API 服务匹配 |
| `api.timeout` | `30` | LLM 请求超时（秒），调本地慢速模型时需调大 |
| `max_history` | `5` | 对话历史保留轮数（滑动窗口大小） |
| `vision.enabled` | `false` | 是否启用视觉感知（需配置 DashScope Key） |
| `vision.model` | `”qwen-vl-plus”` | 视觉模型名 |
| `vision.stable_duration` | `30` | 窗口标题保持不变多少秒后触发视觉感知 |
| `vision.handle_cooldown` | `600` | 距上次任意视觉调用的全局冷却时间（秒） |
| `vision.same_handle_cooldown` | `3000` | 对同一窗口标题的冷却时间（秒） |
| `vision.prompt` | `”简要描述...”` | 发送给视觉模型的提示词 |
| `vision.max_tokens` | `200` | 视觉模型回复的最大 token 数 |
| `system_prompt` | *(见文件)* | 系统提示词，指导 AI 角色行为和对话风格 |

完整参数见 [CONFIG.md](./CONFIG.md) 或 `config.json` 文件本身，改完重启应用生效。

## 使用

### 基本操作

1. 双击 `Mini Live2D AI.exe` 启动
2. 角色会出现在屏幕右下角，悬浮在其他窗口之上
3. 点击底部输入框，输入文字，按 Enter 或点击"发送"
4. AI 回复以气泡形式显示，角色会播放对应动作

### 右键菜单

在窗口上右键点击：

| 选项 | 功能 |
|------|------|
| 显示历史 | 查看最近的对话记录 |
| 视觉感知 | 开关屏幕感知功能（需要配置 DashScope Key） |
| 退出 | 关闭应用 |

### 托盘图标

- **左键**：显示/隐藏角色窗口
- **右键**：显示/隐藏、退出

窗口最小化后应用仍在托盘运行，不会占用任务栏。

### 视觉感知

启用后，角色会检测你当前正在使用的软件窗口，并用 AI 视觉模型识别屏幕内容，主动与你搭话。

## 常见问题

### 启动后窗口报错

确认 `.env` 文件中 `DEEPSEEK_API_KEY` 已填写且正确。

### 程序运行但没有窗口显示

第一次启动较慢，请耐心等待。可以观察系统托盘是否有图标，若被隐藏，尝试在托盘右键选择"显示/隐藏"来切换窗口显示状态。

### 启动后 live2d 模型不显示

网络问题，检查网络正常连接，关闭代理或 VPN 后重新启动应用。

### 打开 `backend.exe` 无响应

正常现象无需处理，打包版 `backend.exe` 不能单独启动（会直接退出）。启动 `Mini Live2D AI.exe` 时会自动运行 `backend.exe`。

### 发送消息后显示"连接后端失败"

后端进程可能未正常启动。尝试：
1. 退出应用（托盘右键 → 退出）
2. 重新启动 `Mini Live2D AI.exe`

### .env 文件放在哪

在解压目录下，与 `Mini Live2D AI.exe` 同级。

### 如何更换 Live2D 模型

替换 `resources/frontend/live2d-models/` 目录下的模型文件，然后修改 `config.json` 中 `model.path` 指向新模型的 `.model3.json` 文件。注意更改可用动作列表。目前版本可能在部分代码中硬编码，所以直接替换模型可能出现问题，后续如果有时间会进行优化。

### 如何卸载

便携版无需安装，卸载即删除文件：
1. 托盘右键退出应用/右键角色选择退出
2. 删除解压目录
