// DOM 元素引用
const $ = id => document.getElementById(id);
const appEl = $("app");
const bubbleArea = $("bubble-area");
const userInput = $("user-input");
const sendBtn = $("send-btn");
const live2dContainer = $("live2d-container");
const contextMenu = $("context-menu");
const menuHistory = $("menu-history");
const menuVision = $("menu-vision");
const menuExit = $("menu-exit");
const historyPanel = $("history-panel");
const historyContent = $("history-content");

// 运行时状态
let live2dApp = null;
let live2dModel = null;
let modelNaturalW = 0;
let modelNaturalH = 0;
let sending = false;
let visionEnabled = false;
let baseModelScale = 1;
let resetTimer = null;          // 动作播放 5 秒后自动复位表情的定时器
let bubbleTimeout = 5000;
let charDelay = 40;
let chatTimeout = 30000;
let backendUrl = "http://127.0.0.1:8000";
let bubbleCount = 0;
let mouseIgnoreActive = false;

/** 从 Electron API 或后端 HTTP 加载配置。 */
async function loadConfig() {
    try {
        if (window.electronAPI && window.electronAPI.getConfig) {
            const config = await window.electronAPI.getConfig();
            if (config) return config;
        }

        const res = await fetch(`${backendUrl}/config`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
    } catch (e) {
        console.error("加载配置失败：", e);
        return null;
    }
}

/** 根据配置设置 CSS 变量和布局参数。 */
function initLayout(config) {
    const d = config.display;
    bubbleTimeout = d.bubble_timeout || 5000;
    charDelay = d.char_delay || 40;
    chatTimeout = (config.api.timeout || 30) * 1000;
    backendUrl = config.api.backend_url;

    appEl.style.setProperty("--base-w", d.window_width + "px");
    appEl.style.setProperty("--base-h", d.window_height + "px");
    appEl.style.setProperty("--bubble-h", (d.bubble_height || 130) + "px");
    appEl.style.setProperty("--input-h", (d.input_height || 40) + "px");
    appEl.style.setProperty("--corner-size", (d.corner_size || 28) + "px");

    userInput.placeholder = d.chat_input_placeholder || "输入一句话...";
}

/** 初始化 PixiJS 应用并加载 Live2D 模型。 */
async function loadLive2D(config) {
    const mc = config.model;
    if (!mc || !mc.path) {
        console.error("模型配置无效");
        return;
    }

    // 检查 CDN 库是否加载成功
    if (typeof PIXI === "undefined") {
        showModelError("PixiJS 未加载，请检查网络连接。");
        return;
    }
    if (!PIXI.live2d) {
        showModelError("pixi-live2d-display 未加载，请检查网络连接。");
        return;
    }

    const containerRect = live2dContainer.getBoundingClientRect();
    live2dApp = new PIXI.Application({
        width: containerRect.width,
        height: containerRect.height,
        transparent: true,
        backgroundAlpha: 0,
        autoStart: true
    });
    live2dContainer.appendChild(live2dApp.view);
    live2dApp.view.style.width = "100%";
    live2dApp.view.style.height = "100%";

    try {
        live2dModel = await PIXI.live2d.Live2DModel.from(mc.path);
    } catch (e) {
        console.error("模型加载失败：", e);
        showModelError(`模型加载失败：${e.message || "未知错误"}`);
        return;
    }

    // 存储模型自然尺寸
    modelNaturalW = live2dModel.width / live2dModel.scale.x;
    modelNaturalH = live2dModel.height / live2dModel.scale.y;

    // 适配容器（90% 留边距）× config scale
    const fitScale = Math.min(containerRect.width / modelNaturalW, containerRect.height / modelNaturalH) * 0.9;
    baseModelScale = fitScale * (mc.scale || 1.2);
    live2dModel.scale.set(baseModelScale);
    live2dModel.x = (containerRect.width - modelNaturalW * baseModelScale) / 2 + (mc.offset_x || 0);
    live2dModel.y = (containerRect.height - modelNaturalH * baseModelScale) / 2 + (mc.offset_y || 0);
    live2dApp.stage.addChild(live2dModel);
    live2dApp.render();
}

/** 在页面顶部显示模型加载错误。 */
function showModelError(msg) {
    const banner = document.getElementById("model-error");
    const msgEl = document.getElementById("model-error-msg");
    if (banner && msgEl) {
        msgEl.textContent = msg;
        banner.classList.remove("hidden");
    }
}

/** 播放 Live2D 动作，5 秒后自动复位表情并播一次待机动作。 */
function playMotion(action) {
    if (!live2dModel) return;
    if (resetTimer) { clearTimeout(resetTimer); resetTimer = null; }
    live2dModel.motion(action);
    resetTimer = setTimeout(() => {
        live2dModel.internalModel.motionManager.expressionManager.resetExpression();
        live2dModel.motion("tired", 0, 1);
        resetTimer = null;
    }, 5000);
}

/** 添加气泡消息，user 直接显示，ai 逐字打字效果。 */
function addMessage(role, text, instant) {
    const bubble = document.createElement("div");
    bubble.className = `bubble ${role}`;
    bubbleArea.appendChild(bubble);
    bubbleCount++;
    bubbleArea.style.pointerEvents = "auto";

    if (instant || role === "user") {
        bubble.textContent = text;
        bubbleArea.scrollTop = bubbleArea.scrollHeight;
        scheduleFade(bubble);
    } else {
        // AI 消息逐字打印效果
        let i = 0;
        const timer = setInterval(() => {
            bubble.textContent = text.slice(0, ++i);
            bubbleArea.scrollTop = bubbleArea.scrollHeight;
            if (i >= text.length) {
                clearInterval(timer);
                scheduleFade(bubble);
            }
        }, charDelay);
    }

    return bubble;
}

/** 设定气泡在超时后淡出并移除。 */
function scheduleFade(bubble) {
    setTimeout(() => {
        bubble.classList.add("fade-out");
        setTimeout(() => {
            bubble.remove();
            bubbleCount--;
            if (bubbleCount <= 0) {
                bubbleCount = 0;
                bubbleArea.style.pointerEvents = "none";
            }
        }, 500);
    }, bubbleTimeout);
}

/** 发送用户消息到后端，处理响应并播放动作。 */
async function sendMessage() {
    const message = userInput.value.trim();
    if (!message || sending) return;

    sending = true;
    addMessage("user", message);
    userInput.value = "";
    sendBtn.disabled = true;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), chatTimeout);

    try {
        const res = await fetch(`${backendUrl}/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message }),
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        addMessage("ai", data.text);
        playMotion(data.action);
    } catch (e) {
        clearTimeout(timeoutId);
        if (e.name === "AbortError") {
            addMessage("ai", "回复超时，请稍后重试。");
        } else {
            addMessage("ai", "连接后端失败，请确认服务正在运行。");
        }
        console.error(e);
    } finally {
        sending = false;
        sendBtn.disabled = false;
        userInput.focus();
    }
}

/** 显示右键菜单，位置贴近鼠标但避开屏幕边缘。 */
function showMenu(x, y) {
    historyPanel.classList.add("hidden");
    contextMenu.classList.remove("hidden");
    menuVision.textContent = `视觉感知：${visionEnabled ? "开" : "关"}`;

    const mw = contextMenu.offsetWidth;
    const mh = contextMenu.offsetHeight;
    contextMenu.style.left = (x + mw > window.innerWidth ? x - mw : x) + "px";
    contextMenu.style.top = (y + mh > window.innerHeight ? y - mh : y) + "px";
}

/** 隐藏右键菜单。 */
function hideMenu() {
    contextMenu.classList.add("hidden");
}

/** 从后端获取对话历史并显示在面板中。 */
async function showHistory() {
    hideMenu();
    try {
        const res = await fetch(`${backendUrl}/history`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        historyContent.innerHTML = "";
        if (data.history && data.history.length > 0) {
            data.history.forEach(item => {
                const div = document.createElement("div");
                div.className = "hist-item";
                div.innerHTML = `<span class="hist-role">[${item.role}]</span> ${escapeHtml(item.content)}`;
                historyContent.appendChild(div);
            });
        } else {
            historyContent.textContent = "（无历史记录）";
        }
    } catch (e) {
        historyContent.textContent = "获取历史失败：" + e.message;
    }
    historyPanel.classList.remove("hidden");
}

/** 转义 HTML 特殊字符，防止 XSS。 */
function escapeHtml(str) {
    const el = document.createElement("div");
    el.textContent = str;
    return el.innerHTML;
}

/** 从后端获取视觉感知开关状态。 */
async function loadVisionStatus() {
    try {
        const res = await fetch(`${backendUrl}/status`);
        if (!res.ok) return;
        const data = await res.json();
        visionEnabled = data.vision;
    } catch (e) {
        console.error("获取视觉状态失败：", e);
    }
}

/** 切换视觉感知开关并通知后端。 */
async function toggleVision() {
    hideMenu();
    try {
        const res = await fetch(`${backendUrl}/vision/enabled`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ enabled: !visionEnabled })
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        visionEnabled = data.vision;
    } catch (e) {
        console.error("切换视觉状态失败：", e);
    }
}

/** 退出应用，优先通过 Electron IPC。 */
async function exitApp() {
    hideMenu();
    if (window.electronAPI && window.electronAPI.exit) {
        window.electronAPI.exit();
        return;
    }
    try {
        await fetch(`${backendUrl}/exit`, { method: "POST" });
    } catch (e) { /* 后端已关闭 */ }
    window.close();
}

sendBtn.addEventListener("click", sendMessage);
userInput.addEventListener("keydown", e => { if (e.key === "Enter") sendMessage(); });

document.addEventListener("contextmenu", e => {
    e.preventDefault();
    showMenu(e.clientX, e.clientY);
});

document.addEventListener("click", e => {
    if (!contextMenu.contains(e.target)) hideMenu();
    if (!historyPanel.contains(e.target) && !contextMenu.contains(e.target)) {
        historyPanel.classList.add("hidden");
    }
});

menuHistory.addEventListener("click", showHistory);
menuVision.addEventListener("click", toggleVision);
menuExit.addEventListener("click", exitApp);

// 气泡区穿透：鼠标在气泡区且无气泡时穿透到其他应用，移出或有气泡时恢复
document.addEventListener("mousemove", (e) => {
    const rect = bubbleArea.getBoundingClientRect();
    const inBubble = e.clientX >= rect.left && e.clientX <= rect.right
                  && e.clientY >= rect.top && e.clientY <= rect.bottom;
    const shouldIgnore = inBubble && bubbleCount === 0;

    if (shouldIgnore !== mouseIgnoreActive) {
        mouseIgnoreActive = shouldIgnore;
        if (window.electronAPI && window.electronAPI.setIgnoreMouseEvents) {
            window.electronAPI.setIgnoreMouseEvents(shouldIgnore);
        }
    }
});

/** 建立 SSE 连接，接收后端主动推送的消息，用户聊天时忽略。 */
function connectSSE() {
    const es = new EventSource(`${backendUrl}/events`);
    es.onmessage = e => {
        if (sending) return;
        try {
            const data = JSON.parse(e.data);
            addMessage("ai", data.text);
            playMotion(data.action);
        } catch (err) {
            console.error("SSE 解析失败：", err);
        }
    };
    es.onerror = () => console.warn("SSE 断开，自动重连...");
}

/** 应用入口：加载配置 → 初始化布局 → 加载模型 → 连接 SSE。 */
(async function init() {
    const config = await loadConfig();
    if (!config) return;
    initLayout(config);
    await loadLive2D(config);
    await loadVisionStatus();
    connectSSE();
    if (window.electronAPI && window.electronAPI.showWindow) {
        window.electronAPI.showWindow();
    }
})();