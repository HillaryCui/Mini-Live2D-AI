"""统一感知模块：后台句柄轮询 → 截屏 → 视觉识别 → 主动消息生成。"""

import base64
import io
import logging
import os
import threading
import time

from dotenv import load_dotenv
from openai import OpenAI
from PIL import ImageGrab

log = logging.getLogger(__name__)

try:
    import win32gui
    HAS_WIN32 = True
except ImportError:
    HAS_WIN32 = False
    logging.warning("未检测到 win32gui，窗口标题轮询将失效（仅支持 Windows 平台）。")

load_dotenv()

# 运行时开关状态
_enabled: bool = False
_stop_event = threading.Event()
_chatting: bool = False

# 后台轮询线程
_thread_lock = threading.Lock()
_poll_thread: threading.Thread | None = None

# 视觉识别客户端（由 init() 初始化）
client: OpenAI | None = None
model: str = ""

# 配置参数（由 init() 注入）
poll_interval: int = 1
stable_duration: int = 300
handle_cooldown: int = 1800
same_handle_cooldown: int = 3000
skip_window_title: str = ""
vision_prompt: str = ""
vision_max_tokens: int = 100

# 句柄轮询状态
stable_title: str = ""
candidate_title: str = ""
candidate_since: float = 0
last_vision_time: float = 0
last_vision_per_handle: dict[str, float] = {}
last_triggered: dict[str, float] = {}

# 来自 main.py 的共享资源引用（由 init() 注入）
_conversation_history: list[dict] = []
_history_lock = None
_system_prompt: str = ""
_ask_llm = None
_broadcast = None
_parse_llm = None
_max_history: int = 3


def init(vision_config: dict, conversation_history: list[dict], system_prompt: str,
         ask_llm, broadcast=None, history_lock=None, parse_llm=None, max_history: int = 3) -> None:
    """注入配置、共享资源引用和回调函数。由 main.py 在启动时调用。"""
    global _enabled, model, poll_interval, stable_duration, handle_cooldown, same_handle_cooldown
    global skip_window_title, vision_prompt, vision_max_tokens
    global client, _conversation_history, _history_lock, _system_prompt, _ask_llm, _broadcast, _parse_llm, _max_history

    _enabled = vision_config.get("enabled", False)
    model = vision_config.get("model", "qwen-vl-plus")
    poll_interval = vision_config.get("poll_interval", 15)
    stable_duration = vision_config.get("stable_duration", 120)
    handle_cooldown = vision_config.get("handle_cooldown", 600)
    same_handle_cooldown = vision_config.get("same_handle_cooldown", 3000)
    skip_window_title = vision_config.get("skip_window_title", "Mini Live2D AI")
    vision_prompt = vision_config.get("prompt", "简要描述用户当前正在做什么，包含必要信息，不超过100个字。")
    vision_max_tokens = vision_config.get("max_tokens", 200)

    _conversation_history = conversation_history
    _history_lock = history_lock
    _system_prompt = system_prompt
    _ask_llm = ask_llm
    _broadcast = broadcast
    _parse_llm = parse_llm
    _max_history = max_history

    # 初始化视觉识别 API 客户端
    api_key = os.getenv("DASHSCOPE_API_KEY")
    base_url = os.getenv("DASHSCOPE_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1")
    if api_key:
        client = OpenAI(api_key=api_key, base_url=base_url)
    else:
        log.warning("未找到 DASHSCOPE_API_KEY，视觉识别功能不可用。请在 .env 中设置。")


def is_enabled() -> bool:
    """返回视觉感知模块当前开关状态。"""
    return _enabled


def set_enabled(enabled: bool) -> None:
    """运行时启停视觉感知模块。"""
    global _enabled
    _enabled = enabled
    if enabled:
        _stop_event.clear()
        _start_thread()
    else:
        _stop_event.set()
    log.info("已%s。", "启用" if enabled else "禁用")


def trigger() -> dict:
    """手动触发一次视觉识别，调试用。"""
    if not client:
        return {"error": "vision client not initialized"}

    screenshot = _capture_screenshot()
    activity = _recognize_activity(screenshot)
    if activity:
        with _history_lock:
            _conversation_history.append({"role": "user", "content": f"[视觉感知]{activity}"})
        log.info("手动触发：%s", activity)
    return {"activity": activity}


def set_chatting(chatting: bool) -> None:
    """标记用户正在聊天，视觉轮询在此期间跳过。"""
    global _chatting
    _chatting = chatting


def start() -> None:
    """应用启动时调用：若启用则启动后台轮询线程。"""
    if _enabled:
        _start_thread()
        log.info("后台视觉模块已启动。")
    else:
        log.info("未启用，跳过。")


def stop() -> None:
    """停止后台轮询线程，等待线程退出（最多 2 秒）。"""
    _stop_event.set()
    if _poll_thread and _poll_thread.is_alive():
        _poll_thread.join(timeout=2)
    log.info("已停止。")


def _cleanup_stale_entries() -> None:
    """定期清理过期的句柄记录，防止 last_vision_per_handle 和 last_triggered 字典无限增长。"""
    now = time.time()
    max_age = max(handle_cooldown, same_handle_cooldown) * 2
    for d in (last_vision_per_handle, last_triggered):
        stale = [k for k, v in d.items() if now - v > max_age]
        for k in stale:
            del d[k]

def _get_foreground_title() -> str:
    """获取当前前台窗口标题（仅 Windows）。"""
    if not HAS_WIN32:
        return ""
    try:
        hwnd = win32gui.GetForegroundWindow()
        return win32gui.GetWindowText(hwnd)
    except Exception:
        return ""


def _poll_loop() -> None:
    """后台轮询线程：检测前台窗口标题是否稳定，稳定后触发视觉感知。"""
    global stable_title, candidate_title, candidate_since
    tick = 0

    while not _stop_event.is_set():
        _stop_event.wait(poll_interval)
        tick += 1
        if tick % 60 == 0:
            _cleanup_stale_entries()
        if _chatting:
            continue

        title = _get_foreground_title()
        if not title or title == skip_window_title:
            continue

        # 标题变化 → 记录候选，等待稳定
        if title != candidate_title:
            candidate_title = title
            candidate_since = time.time()
            continue

        # 候选标题保持足够长时间 → 视为新句柄，触发感知
        if time.time() - candidate_since >= stable_duration:
            if title != stable_title or time.time() - last_triggered.get(title, 0) >= same_handle_cooldown:
                stable_title = title
                last_triggered[title] = time.time()
                _on_stable_handle(title)


def _start_thread() -> None:
    """启动后台轮询线程，避免重复创建。"""
    global _poll_thread
    with _thread_lock:
        if _poll_thread and _poll_thread.is_alive():
            return  # 线程已在运行，直接返回
        _poll_thread = threading.Thread(target=_poll_loop, daemon=True)
        _poll_thread.start()


def _on_stable_handle(title: str) -> None:
    """句柄稳定后的处理：截屏 → 视觉识别 → 生成主动消息 → SSE 推送。"""
    global last_vision_time

    now = time.time()
    # 全局冷却：距上次任意视觉调用需超过 handle_cooldown
    if now - last_vision_time < handle_cooldown:
        return
    # 同窗口冷却：距上次对同一窗口的调用需超过 same_handle_cooldown
    if now - last_vision_per_handle.get(title, 0) < same_handle_cooldown:
        return

    if not client:
        return

    screenshot = _capture_screenshot()
    activity = _recognize_activity(screenshot)
    if not activity:
        return

    last_vision_time = now
    last_vision_per_handle[title] = now

    # 视觉感知结果存入对话历史
    with _history_lock:
        _conversation_history.append({"role": "user", "content": f"[视觉感知]{activity}"})
    log.info("视觉感知：%s", activity)

    # 用视觉感知结果调用 LLM 生成主动消息
    prompt = _system_prompt
    messages = [{"role": "system", "content": prompt}]

    with _history_lock:
        messages.extend(_conversation_history[-_max_history * 2:])

    raw = _ask_llm(messages)
    result = _parse_llm(raw) if _parse_llm else {"text": raw, "action": "gentle_smile"}
    text = result["text"]
    action = result["action"]

    with _history_lock:
        _conversation_history.append({"role": "assistant", "content": raw})
    log.info("主动消息：[%s] %s", action, text)

    if _broadcast:
        _broadcast({"text": text, "action": action})


def _capture_screenshot() -> bytes:
    """截取所有屏幕的完整画面，返回 PNG 字节流。"""
    img = ImageGrab.grab(all_screens=True)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _recognize_activity(screenshot: bytes) -> str:
    """将截屏图片发送给 Qwen-VL 视觉模型，返回对用户当前活动的描述。"""
    b64 = base64.b64encode(screenshot).decode("utf-8")

    try:
        response = client.chat.completions.create(
            model=model,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:image/png;base64,{b64}"},
                        },
                        {
                            "type": "text",
                            "text": vision_prompt,
                        },
                    ],
                }
            ],
            max_tokens=vision_max_tokens,
        )
        return response.choices[0].message.content.strip()
    except Exception as e:
        log.error("识别失败: %s", e)
        return ""