const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, dialog } = require("electron");
const { spawn, execSync, exec } = require("child_process");
const fs = require("fs");
const path = require("path");
const http = require("http");

// 窗口、后端进程、托盘引用
let mainWindow = null;
let backendProcess = null;
let tray = null;

// ── 文件日志 ────────────────────────────────────────────
const LOG_MAX_SIZE = 1024 * 1024; // 单文件最大 1MB
const LOG_BACKUPS = 3;            // 保留最近 3 个备份

let logDir = "";
let logStream = null;
let logFilePath = "";

function rotateLogs() {
    const base = path.join(logDir, "app.log");
    // 轮转：app.log → app.log.1 → app.log.2 → app.log.3（删除最旧的）
    for (let i = LOG_BACKUPS; i >= 1; i--) {
        const oldFile = i === 1 ? base : path.join(logDir, `app.log.${i - 1}`);
        const newFile = path.join(logDir, `app.log.${i}`);
        try { if (fs.existsSync(oldFile)) fs.renameSync(oldFile, newFile); } catch (_) {}
    }
}

function initLog() {
    try {
        logDir = app.isPackaged
            ? path.join(process.resourcesPath, "..", "logs")
            : path.join(__dirname, "..", "logs");
        if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
        logFilePath = path.join(logDir, "app.log");
        // 如果已有文件超过上限，先轮转
        try {
            if (fs.existsSync(logFilePath) && fs.statSync(logFilePath).size > LOG_MAX_SIZE) {
                rotateLogs();
            }
        } catch (_) {}
        logStream = fs.createWriteStream(logFilePath, { flags: "a" });
        log("[log] 日志系统初始化");
    } catch (e) {
        console.error("日志系统初始化失败：", e.message);
    }
}

function log(msg) {
    const ts = new Date().toISOString().replace("T", " ").slice(0, 23);
    const line = `[${ts}] ${msg}`;
    console.log(line);
    _writeLog(line);
}

function logError(msg) {
    const ts = new Date().toISOString().replace("T", " ").slice(0, 23);
    const line = `[${ts}] [ERROR] ${msg}`;
    console.error(line);
    _writeLog(line);
}

function _writeLog(line) {
    if (!logStream || !logFilePath) return;
    try {
        // 写之前检查是否需要轮转
        if (fs.existsSync(logFilePath) && fs.statSync(logFilePath).size > LOG_MAX_SIZE) {
            logStream.end();
            rotateLogs();
            logStream = fs.createWriteStream(logFilePath, { flags: "a" });
        }
    } catch (_) {}
    logStream.write(line + "\n");
}

/** 加载 config.json，打包后从安装目录读取，开发时从 backend/ 目录读取。 */
function loadConfig() {
    try {
        const configPath = app.isPackaged
            ? path.join(process.resourcesPath, "..", "config.json")
            : path.join(__dirname, "..", "backend", "config.json");
        return JSON.parse(fs.readFileSync(configPath, "utf-8"));
    } catch (e) {
        logError(`读取 config.json 失败：${e.message}`);
        return { display: { window_width: 200, window_height: 600 }, api: { backend_url: "http://127.0.0.1:8000" } };
    }
}

/** 通过 IPC 向前端提供配置，避免前端跨域请求。 */
ipcMain.handle("get-app-config", async () => {
    return loadConfig();
});

/** 气泡区穿透：前端发指令切换窗口级别鼠标穿透。 */
ipcMain.on("set-ignore-mouse-events", (_event, ignore) => {
    if (mainWindow) {
        mainWindow.setIgnoreMouseEvents(ignore, { forward: true });
    }
});

/** 前端加载完成后通知主进程显示窗口。 */
ipcMain.on("show-window", () => {
    if (mainWindow) {
        mainWindow.show();
    }
});

/** 创建无边框透明置顶窗口，定位在屏幕右下角。 */
function createWindow() {
    const config = loadConfig();
    const d = config.display;
    const w = d.window_width || 250;
    const h = d.window_height || 450;

    const display = screen.getPrimaryDisplay().workArea;
    const x = display.x + display.width - w;
    const y = display.y + display.height - h;

    mainWindow = new BrowserWindow({
        width: w,
        height: h,
        x,
        y,
        title: "Mini Live2D AI",
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        resizable: false,
        hasShadow: false,
        backgroundColor: "#00000000",
        skipTaskbar: true,
        show: false,
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    mainWindow.setBackgroundColor("#00000000");
    mainWindow.setAlwaysOnTop(true, "screen-saver");
    mainWindow.setMenuBarVisibility(false);
    const htmlPath = app.isPackaged
        ? path.join(process.resourcesPath, "frontend", "index.html")
        : path.join(__dirname, "..", "frontend", "index.html");
    mainWindow.loadFile(htmlPath);

    mainWindow.on("closed", () => { mainWindow = null; });

    createTray();
}

/** 创建系统托盘图标，左键切换窗口显隐，右键弹出菜单。 */
function createTray() {
    // 16x16 纯色图标（#5b9bd5）
    const size = 16;
    const buf = Buffer.alloc(size * size * 4);
    for (let i = 0; i < size * size; i++) {
        buf[i * 4] = 91;      // R
        buf[i * 4 + 1] = 155; // G
        buf[i * 4 + 2] = 213; // B
        buf[i * 4 + 3] = 255; // A
    }
    const icon = nativeImage.createFromBuffer(buf, { width: size, height: size });

    tray = new Tray(icon);
    tray.setToolTip("Mini Live2D AI");

    tray.on("click", () => {
        if (mainWindow) {
            mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
        }
    });

    tray.on("right-click", () => {
        const menu = Menu.buildFromTemplate([
            { label: "显示/隐藏", click: () => mainWindow && (mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show()) },
            { type: "separator" },
            { label: "退出", click: () => quitApp() }
        ]);
        tray.popUpContextMenu(menu);
    });
}

/** 杀掉占用指定端口的所有进程（Windows）。 */
function killProcessOnPort(port) {
    try {
        // netstat 找到占用端口的 PID，然后 taskkill 杀掉
        const output = execSync(`netstat -ano | findstr ":${port}"`, { encoding: "utf-8", timeout: 5000 });
        const pids = new Set();
        for (const line of output.split("\n")) {
            const parts = line.trim().split(/\s+/);
            const pid = parts[parts.length - 1];
            if (pid && pid !== "0" && !isNaN(pid)) pids.add(pid);
        }
        for (const pid of pids) {
            try {
                execSync(`taskkill /F /T /PID ${pid}`, { timeout: 5000 });
                log(`[cleanup] 已杀掉占用端口 ${port} 的进程 PID=${pid}`);
            } catch (_) { /* 进程可能已退出 */ }
        }
        return pids.size > 0;
    } catch (_) {
        return false;
    }
}

/** 强杀进程树：Windows 上用 taskkill /T 杀掉整个进程树。 */
function killProcessTree(proc) {
    if (!proc || !proc.pid) return;
    try {
        execSync(`taskkill /F /T /PID ${proc.pid}`, { timeout: 5000 });
        log(`[cleanup] 已杀掉进程树 PID=${proc.pid}`);
    } catch (_) {
        // 兜底：Node.js 的 kill
        try { proc.kill(); } catch (__) { /* 忽略 */ }
    }
}

/** HTTP 健康检查：轮询后端是否就绪。 */
function healthCheck(url, timeout = 10000) {
    return new Promise((resolve, reject) => {
        const deadline = Date.now() + timeout;
        const check = () => {
            const req = http.get(url, (res) => {
                if (res.statusCode === 200) {
                    res.resume();
                    resolve();
                } else {
                    res.resume();
                    retry();
                }
            });
            req.on("error", retry);
            req.setTimeout(1000, () => { req.destroy(); retry(); });
        };
        const retry = () => {
            if (Date.now() >= deadline) {
                reject(new Error("健康检查超时"));
            } else {
                setTimeout(check, 500);
            }
        };
        check();
    });
}

/** 退出应用：先请求后端退出，再确保进程被清理。 */
async function quitApp() {
    log("[quit] 退出流程开始");

    const config = loadConfig();

    // 尝试 POST /exit 优雅退出
    try {
        const controller = new AbortController();
        setTimeout(() => controller.abort(), 2000);
        await fetch(`${config.api.backend_url}/exit`, {
            method: "POST",
            signal: controller.signal
        });
        log("[quit] 后端退出请求已发送。");
    } catch (e) {
        log(`[quit] 后端退出请求异常：${e.message}`);
    }

    // 等一小段时间让后端自行退出
    await new Promise(r => setTimeout(r, 500));

    // 强杀整个进程树（Windows taskkill /T 杀掉子进程和孙进程）
    if (backendProcess) {
        killProcessTree(backendProcess);
        backendProcess = null;
    }

    // 兜底：杀掉端口上可能残留的进程
    killProcessOnPort(8000);

    if (tray) tray.destroy();

    log("[quit] 退出完成，关闭日志");
    if (logStream) { logStream.end(); logStream = null; }

    app.quit();
}

/** IPC：退出应用。 */
ipcMain.handle("exit-app", async () => {
    quitApp();
});

// 单实例锁：防止重复启动
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
    app.quit();
    // 以下代码不会执行（whenReady 不会触发），但注册过的 listener 无害
}

app.on("second-instance", () => {
    // 已有实例时，显示已有窗口而不是开新的
    if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
    }
});

// 打包模式下启动 backend.exe，开发模式下直接创建窗口
if (app.isPackaged) {
    app.whenReady().then(async () => {
        initLog();
        const config = loadConfig();
        const backendUrl = config.api.backend_url || "http://127.0.0.1:8000";
        const backendExe = path.join(process.resourcesPath, "..", "backend.exe");
        const configDir = path.join(process.resourcesPath, "..");

        // 启动前：杀掉可能残留的旧进程
        killProcessOnPort(8000);
        // 等一下端口释放
        await new Promise(r => setTimeout(r, 500));

        let windowCreated = false;

        // 启动后端
        try {
            backendProcess = spawn(backendExe, ['--electron'], {
                cwd: configDir,
                stdio: "pipe",
                windowsHide: true
            });
        } catch (e) {
            dialog.showErrorBox("启动失败", `无法启动 backend.exe：${e.message}`);
            app.quit();
            return;
        }

        // 记录后端日志
        backendProcess.stdout.on("data", (data) => {
            log(`[backend:out] ${data.toString().trim()}`);
        });
        backendProcess.stderr.on("data", (data) => {
            log(`[backend:err] ${data.toString().trim()}`);
        });

        // 进程意外退出时清理
        backendProcess.on("exit", (code) => {
            log(`[backend] 进程退出 code=${code}`);
            if (!windowCreated) {
                dialog.showErrorBox("启动失败", `backend.exe 异常退出（代码 ${code}）。请检查 .env 配置。`);
                app.quit();
            }
        });

        // 等待后端就绪：用 HTTP 健康检查替代依赖 stderr 输出
        try {
            await healthCheck(backendUrl, 15000);
            log("[backend] 健康检查通过，后端已就绪。");
            windowCreated = true;
            createWindow();
        } catch (e) {
            dialog.showErrorBox("启动失败", `backend.exe 未能在 15 秒内就绪。\n\n可能原因：\n1. 端口 8000 被占用\n2. .env 配置错误\n3. 依赖缺失\n\n${e.message}`);
            if (backendProcess) killProcessTree(backendProcess);
            app.quit();
        }
    });
} else {
    app.whenReady().then(() => {
        initLog();
        createWindow();
    });
}

app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// 不退出应用，托盘继续运行
app.on("window-all-closed", () => {
});

// 应用即将退出时清理后端进程
app.on("before-quit", () => {
    log("[before-quit] 应用退出，清理资源");
    if (backendProcess) {
        killProcessTree(backendProcess);
        backendProcess = null;
    }
    if (logStream) { logStream.end(); logStream = null; }
});
