/** 预加载脚本：通过 contextBridge 向前端安全暴露 IPC 接口。 */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
    /** 退出应用。 */
    exit: () => ipcRenderer.invoke("exit-app"),
    /** 获取 config.json 配置。 */
    getConfig: () => ipcRenderer.invoke("get-app-config"),
    /** 通知主进程显示窗口。 */
    showWindow: () => ipcRenderer.send("show-window"),
    /** 设置气泡区鼠标穿透。 */
    setIgnoreMouseEvents: (ignore) => ipcRenderer.send("set-ignore-mouse-events", ignore)
});
