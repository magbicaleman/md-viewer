const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("mdViewer", {
  chooseFile: () => ipcRenderer.invoke("dialog:open-file"),
  chooseFolder: () => ipcRenderer.invoke("dialog:open-folder"),
  openAuditDemos: () => ipcRenderer.invoke("audit:open"),
  openAuditDemoTarget: (action) => ipcRenderer.invoke("audit:open-target", action),
  getAuditDemoPaths: () => ipcRenderer.invoke("audit:get-paths"),
  inspectPath: (targetPath) => ipcRenderer.invoke("path:inspect", targetPath),
  getEntryMetadataBatch: (filePaths) => ipcRenderer.invoke("file:get-entry-metadata-batch", filePaths),
  readMarkdownFile: (filePath) => ipcRenderer.invoke("file:read-markdown", filePath),
  renderMarkdown: (markdown, currentFilePath, rootPath) =>
    ipcRenderer.invoke("markdown:render", markdown, currentFilePath, rootPath),
  setWatchContext: (context) => ipcRenderer.invoke("watch:set-context", context),
  clearWatchContext: () => ipcRenderer.invoke("watch:clear"),
  getLaunchTarget: () => ipcRenderer.invoke("app:get-launch-target"),
  openExternal: (target) => ipcRenderer.invoke("shell:open-external", target),
  showItemInFolder: (target) => ipcRenderer.invoke("shell:show-item-in-folder", target),
  setWindowTheme: (theme) => ipcRenderer.send("window:set-theme", theme),
  onWatchedTargetChanged: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("watch:changed", listener);

    return () => {
      ipcRenderer.removeListener("watch:changed", listener);
    };
  },
  onTargetOpened: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("target:opened", listener);

    return () => {
      ipcRenderer.removeListener("target:opened", listener);
    };
  }
});
