"""LLM 客户端：初始化 OpenAI 兼容接口，封装 ask_llm 调用。"""

import logging
import os
from openai import OpenAI
from dotenv import load_dotenv

load_dotenv()

log = logging.getLogger(__name__)

_client: OpenAI | None = None
_model_name: str = "deepseek-chat"
_timeout: int = 30


def init(model_name: str, timeout: int = 30) -> None:
    """初始化 LLM 客户端，传入模型名称和从 .env 读取的 API 配置。"""
    global _client, _model_name, _timeout

    _model_name = model_name
    _timeout = timeout

    api_key = os.getenv("DEEPSEEK_API_KEY")
    base_url = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com")

    if not api_key:
        _client = None
        log.warning("未找到 DEEPSEEK_API_KEY，聊天功能不可用。请在 .env 中设置。")
        return

    _client = OpenAI(api_key=api_key, base_url=base_url)
    log.info(f"LLM 客户端已初始化，模型：{model_name}")


def ask_llm(messages: list[dict]) -> str:
    """调用 LLM 获取回复，返回原始响应文本。"""
    if not _client:
        return '{"text": "错误：LLM 客户端未初始化，请检查 .env 中的 DEEPSEEK_API_KEY 和 config.json 中的 llm_model。", "action": "gentle_smile"}'

    response = _client.chat.completions.create(
        model=_model_name,
        messages=messages,
        temperature=0.7,
        timeout=_timeout,
    )

    return response.choices[0].message.content