# config.json 字段说明

所有可调参数集中在 `backend/config.json`（打包后与 `backend.exe` 同目录）。修改后重启应用生效。

## model — Live2D 模型配置

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `name` | string | `"shu"` | 模型名称，作为 `/history` 返回的角色名显示 |
| `path` | string | — | Live2D 模型文件路径（`.model3.json`），相对于 `frontend/live2d-models/` 目录。打包后相对于 `resources/frontend/live2d-models/` |
| `scale` | number | `1.2` | 模型缩放倍数。1 = 占满容器 90%，值越大模型越大 |
| `offset_x` | number | `0` | 模型水平偏移（像素），正值向右 |
| `offset_y` | number | `0` | 模型垂直偏移（像素），正值向下 |

## display — 窗口与界面布局

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `window_width` | number | `250` | Electron 窗口宽度（像素），固定不可拖拽缩放 |
| `window_height` | number | `450` | Electron 窗口高度（像素） |
| `bubble_height` | number | `130` | 气泡对话区高度（像素），位于窗口顶部 |
| `input_height` | number | `40` | 底部输入框高度（像素） |
| `corner_size` | number | `28` | 左上角拖拽控件尺寸（像素） |
| `bubble_timeout` | number | `5000` | 气泡自动消失时间（毫秒），AI 回复打字完成后开始计时 |
| `char_delay` | number | `40` | AI 气泡逐字打字效果的每字间隔（毫秒） |
| `chat_input_placeholder` | string | `"输入一句话..."` | 输入框占位提示文字 |

**说明**：窗口中 Live2D 模型区高度 = `window_height - bubble_height - input_height`，三者无缝衔接。

## api — 后端与 LLM 服务配置

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `backend_url` | string | `"http://127.0.0.1:8000"` | **请勿修改**，后端服务基础 URL，前端用它拼接 `/chat`、`/events` 等端点 |
| `llm_model` | string | `"deepseek-chat"` | LLM 模型名，传给 OpenAI 兼容 API 的 `model` 参数。需与 `.env` 中配置的 API 服务匹配 |
| `timeout` | number | `30` | LLM 请求超时时间（秒）。调本地 LoRA 等慢速模型时需调大，前后端同步生效 |

> **注意**：目前 `backend_url` 中的端口号（8000）在部分代码中硬编码，修改此处不会改变后端实际监听端口，只会导致前端无法连接。如需使用本地模型且端口冲突，应修改本地框架的端口（如 vLLM 加 `--port 8001`）。

**关联配置**：LLM 的 API Key 和 Base URL 在 `.env` 文件中配置（`DEEPSEEK_API_KEY`、`DEEPSEEK_BASE_URL`），不在此文件中。

## actions — 可用动作列表

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `actions` | string[] | `["annoyed", "resigned", "pleased", "gentle_smile", "tired", "stern_remind", "reject", "cutesy"]` | Live2D 角色可播放的动作 ID 列表 |

LLM 返回的 `action` 字段必须在此列表中，否则降级为 `gentle_smile`。更换 Live2D 模型时需同步修改此列表，确保与模型的动作定义一致。

## max_history — 对话记忆轮数

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `max_history` | number | `5` | 滑动窗口保留的对话轮数。每轮包含 1 条 user 消息和 1 条 assistant 消息|

视觉感知消息和主动消息也计入对话历史，作为上下文的一部分。`POST /reset` 可清空全部记忆。目前没有在前端暴露接口。

## vision — 视觉感知模块

视觉感知为可选功能，启用后角色会自动检测用户当前活动并主动搭话。需要在 `.env` 中配置 `DASHSCOPE_API_KEY`。

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `enabled` | boolean | `false` | 是否在启动时启用视觉感知。运行时可通过 `POST /vision/enabled` 动态开关 |
| `model` | string | `"qwen-vl-plus"` | 视觉模型名，需支持图片输入（如 Qwen-VL 系列） |
| `poll_interval` | number | `5` | 后台轮询前台窗口标题的间隔（秒） |
| `stable_duration` | number | `30` | 窗口标题保持不变多少秒后，视为用户稳定在该窗口，触发视觉感知 |
| `handle_cooldown` | number | `600` | 全局冷却时间（秒）：距上次任意视觉调用超过此时间才允许再次触发 |
| `same_handle_cooldown` | number | `3000` | 同窗口冷却时间（秒）：对同一窗口标题，距上次调用超过此时间才允许再次触发。两个冷却条件独立生效，需同时满足 |
| `skip_window_title` | string | `"Mini Live2D AI"` | 跳过匹配此标题的窗口，避免截取自己的画面。需与 Electron 窗口的 `title` 一致 |
| `prompt` | string | `"简要描述..."` | 发送给视觉模型的提示词，指导模型如何描述用户活动 |
| `max_tokens` | number | `200` | 视觉模型回复的最大 token 数 |

### 冷却机制说明

触发视觉感知需同时满足三个条件：
1. **新句柄**：窗口标题稳定超过 `stable_duration` 秒，且与上次不同或同窗口冷却已过期
2. **全局冷却**：距上次**任何**视觉调用 > `handle_cooldown`
3. **同窗口冷却**：距上次**对该窗口**的视觉调用 > `same_handle_cooldown`

典型配置示例：
- 高频互动：`handle_cooldown: 300`, `same_handle_cooldown: 1800`
- 低频节能：`handle_cooldown: 600`, `same_handle_cooldown: 3000`（默认）

## system_prompt — 系统提示词

| 字段 | 类型 | 说明 |
|------|------|------|
| `system_prompt` | string | 发送给 LLM 的系统提示词，定义 AI 角色的人设、回复格式和行为规范 |

提示词中需包含以下关键信息（否则 LLM 可能返回非法格式）：
1. **JSON 回复格式**：`{"text": "对话文本", "action": "动作ID"}`
2. **可用动作列表**：与 `actions` 字段一致
3. **视觉感知处理规则**（如启用视觉功能）：收到 `[视觉感知]` 标签时如何回应

代码支持 `{actions}` 占位符自动替换为 `actions` 列表，但当前配置已硬编码动作列表、未使用占位符。

## 完整示例

```json
{
  "model": {
    "name": "shu",
    "path": "./live2d-models/黍黍模型-by什行在要/runtime/黍.model3.json",
    "scale": 1.2,
    "offset_x": 0,
    "offset_y": 0
  },
  "display": {
    "window_width": 250,
    "window_height": 450,
    "bubble_height": 130,
    "input_height": 40,
    "corner_size": 28,
    "bubble_timeout": 5000,
    "char_delay": 40,
    "chat_input_placeholder": "输入一句话..."
  },
  "api": {
    "backend_url": "http://127.0.0.1:8000",
    "llm_model": "deepseek-chat",
    "timeout": 30
  },
  "actions": ["annoyed", "resigned", "pleased", "gentle_smile", "tired", "stern_remind", "reject", "cutesy"],
  "max_history": 5,
  "vision": {
    "enabled": false,
    "model": "qwen-vl-plus",
    "poll_interval": 5,
    "stable_duration": 30,
    "handle_cooldown": 600,
    "same_handle_cooldown": 3000,
    "skip_window_title": "Mini Live2D AI",
    "prompt": "简要描述用户当前正在做什么，包含必要信息，不超过100个字。",
    "max_tokens": 200
  },
  "system_prompt": "你现在是黍，一位温和沉静、温和从容，富有姐姐关怀的农业天师...\n【硬约束】\n1. 必须且只能以 JSON 格式回复...\n2. 字段规范：{\"text\": \"对话文本\", \"action\": \"动作ID\"}\n..."
}
```
