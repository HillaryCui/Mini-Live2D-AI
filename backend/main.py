"""Mini Live2D AI 后端服务：FastAPI 应用，路由，SSE 推送。"""

import asyncio
import contextlib
import json
import logging
import logging.handlers
import os
import sys
import threading

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

import llm_client
import vision

# ── 文件日志 ────────────────────────────────────────────
if getattr(sys, "frozen", False):
    BASE_DIR = os.path.dirname(sys.executable)
else:
    BASE_DIR = os.path.dirname(__file__)

LOG_DIR = os.path.join(BASE_DIR, "logs")
os.makedirs(LOG_DIR, exist_ok=True)

# 强制 stdout 为 UTF-8，避免 Electron pipe 读取时编码不一致导致乱码
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    handlers=[
        logging.handlers.RotatingFileHandler(
            os.path.join(LOG_DIR, "backend.log"),
            maxBytes=1024 * 1024,  # 1MB
            backupCount=3,
            encoding="utf-8",
        ),
        logging.StreamHandler(sys.stdout),
    ],
)
log = logging.getLogger(__name__)

# 打包后 config.json 与 exe 同目录，开发时在 backend/ 目录下
if getattr(sys, "frozen", False):
    CONFIG_PATH = os.path.join(os.path.dirname(sys.executable), "config.json")
else:
    CONFIG_PATH = os.path.join(os.path.dirname(__file__), "config.json")

with open(CONFIG_PATH, encoding="utf-8") as f:
    config = json.load(f)

# 从配置中提取常用参数
actions = config.get("actions", [])
valid_actions = set(actions)
action_tags = ", ".join(actions)
max_history = config.get("max_history", 3)
model_name = config.get("model", {}).get("name", "assistant")
system_prompt = config["system_prompt"].replace("{actions}", action_tags)

# 初始化 LLM 客户端
llm_client.init(
    config["api"].get("llm_model", "deepseek-chat"),
    timeout=config["api"].get("timeout", 30),
)

# 对话历史：滑动窗口保留最近 N 轮
conversation_history: list[dict] = []
_history_lock = threading.Lock()

# SSE 订阅者：vision 后台线程通过 broadcast() 推送消息
_subscribers_lock = threading.Lock()
_subscribers: list[asyncio.Queue] = []
_fastapi_loop: asyncio.AbstractEventLoop | None = None


def broadcast(data: dict) -> None:
    """将消息跨线程安全地推送到所有 SSE 订阅者。"""
    if not _fastapi_loop:
        return
    with _subscribers_lock:
        active_queues = list(_subscribers)

    for q in active_queues:
        _fastapi_loop.call_soon_threadsafe(q.put_nowait, data)


@contextlib.asynccontextmanager
async def lifespan(app: FastAPI) -> None:
    """应用生命周期：启动时初始化视觉线程，关闭时停止。"""
    global _fastapi_loop
    _fastapi_loop = asyncio.get_running_loop()
    vision.start()
    yield
    vision.stop()

app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["null"],  # file:// 协议的 origin 为 "null"
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ChatRequest(BaseModel):
    message: str


class ToggleRequest(BaseModel):
    enabled: bool


@app.get("/")
def root() -> dict:
    """健康检查端点。"""
    return {"message": "Mini Live2D AI backend is running."}


@app.get("/config")
def get_config() -> dict:
    """返回完整配置文件内容。"""
    return config


@app.get("/status")
def status() -> dict:
    """返回视觉感知模块开关状态。"""
    return {"vision": vision.is_enabled()}


@app.post("/vision/enabled")
def toggle_vision(req: ToggleRequest) -> dict:
    """运行时切换视觉感知开关。"""
    vision.set_enabled(req.enabled)
    return {"vision": vision.is_enabled()}


@app.post("/vision/trigger")
def trigger_vision() -> dict:
    """手动触发一次视觉识别，调试用。"""
    return vision.trigger()


def parse_llm_response(raw: str) -> dict:
    """解析 LLM 返回的 JSON，校验 action 合法性，非法时降级为 gentle_smile。"""
    try:
        data = json.loads(raw)
        text = data.get("text", "")
        action = data.get("action", "gentle_smile")
        if action not in valid_actions:
            action = "gentle_smile"
        return {"text": text, "action": action}
    except (json.JSONDecodeError, AttributeError):
        return {"text": raw, "action": "gentle_smile"}


# 初始化视觉模块：注入共享资源和回调函数
vision.init(config.get("vision", {}), conversation_history, system_prompt,
            llm_client.ask_llm, broadcast, _history_lock, parse_llm_response, max_history)


def build_messages(user_message: str) -> list[dict]:
    """构建 LLM 对话上下文：system prompt + 滑动窗口历史（每轮含 user 和 assistant 两条） + 当前消息。"""
    messages = [{"role": "system", "content": system_prompt}]
    messages.extend(conversation_history[-max_history * 2:])
    messages.append({"role": "user", "content": user_message})
    return messages


@app.post("/chat")
def chat(request: ChatRequest) -> dict:
    """用户聊天：构建上下文 → LLM → 解析动作 → 更新历史。聊天期间暂停视觉轮询。"""
    if not request.message.strip():
        return {"text": "请输入内容。", "action": "gentle_smile"}

    # 聊天期间暂停视觉轮询，避免视觉识别和用户对话互相干扰
    vision.set_chatting(True)
    try:
        with _history_lock:
            messages = build_messages(request.message)
        raw = llm_client.ask_llm(messages)
        result = parse_llm_response(raw)

        with _history_lock:
            conversation_history.append({"role": "user", "content": request.message})
            conversation_history.append({"role": "assistant", "content": raw})
        return result
    finally:
        vision.set_chatting(False)


@app.post("/reset")
def reset() -> dict:
    """清空对话记忆。"""
    conversation_history.clear()
    return {"message": "记忆已清空。"}


@app.get("/history")
def get_history() -> dict:
    """返回对话历史，assistant 消息只提取 text 字段，方便前端展示。"""
    history: list[dict] = []
    for msg in conversation_history:
        if msg["role"] == "user":
            history.append({"role": "user", "content": msg["content"]})
        else:
            try:
                data = json.loads(msg["content"])
                history.append({"role": model_name, "content": data.get("text", "")})
            except (json.JSONDecodeError, AttributeError):
                history.append({"role": model_name, "content": msg["content"]})
    return {"history": history}


@app.post("/exit")
def exit_app() -> None:
    """退出后端进程。"""
    log.info("[Exit] 收到退出请求，释放系统资源中...")
    try:
        vision.stop()
    except Exception as e:
        log.error(f"释放视觉模块失败: {e}")
    import threading
    threading.Timer(0.5, lambda: os._exit(0)).start()


@app.get("/events")
async def sse_events():
    """SSE 端点：每个前端连接创建一个 asyncio.Queue，vision 通过 broadcast() 向队列推送消息。"""
    queue: asyncio.Queue = asyncio.Queue()
    with _subscribers_lock:
        _subscribers.append(queue)

    async def generate():
        try:
            while True:
                data = await queue.get()
                yield f"data: {json.dumps(data, ensure_ascii=False)}\n\n"
        except asyncio.CancelledError:
            pass
        finally:
            with _subscribers_lock:
                _subscribers.remove(queue)

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


if __name__ == "__main__":
    import uvicorn
    if sys.stdout is None:
        sys.stdout = open(os.devnull, 'w')
        sys.stderr = open(os.devnull, 'w')
    if getattr(sys, 'frozen', False) and '--electron' not in sys.argv:
        sys.exit(0)
    uvicorn.run(app, host="127.0.0.1", port=8000, reload=not getattr(sys, 'frozen', False))