const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");

const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown", ".mdown", ".mkd"]);
const SAFE_EXTERNAL_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);
const IGNORED_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".next",
  ".turbo",
  ".cache"
]);
const WINDOW_THEME_BACKGROUNDS = {
  paper: "#f7f4ee",
  mist: "#edf2f4",
  graphite: "#171b20"
};
const WATCH_DEBOUNCE_MS = 220;

let mainWindow = null;
let pendingOpenPath = null;
const appIconPath = path.join(__dirname, "..", "assets", "icon.png");
const watchState = {
  currentPath: null,
  rootPath: null,
  sourceKind: null,
  fileWatcher: null,
  parentWatcher: null,
  rootWatcher: null,
  debounceTimer: null
};

process.on("uncaughtException", (error) => {
  console.error("[main] Uncaught exception:", error);
});

process.on("unhandledRejection", (reason) => {
  console.error("[main] Unhandled rejection:", reason);
});

function isMarkdownFile(filePath) {
  return MARKDOWN_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function normalizeSlashes(value) {
  return value.split(path.sep).join("/");
}

function getModifiedAt(stats) {
  return Number.isFinite(stats?.mtimeMs) ? new Date(stats.mtimeMs).toISOString() : null;
}

async function createMarkdownEntry(absolutePath, basePath, stats) {
  const fileStats = stats ?? await fsp.stat(absolutePath);

  return {
    name: path.basename(absolutePath),
    absolutePath,
    relativePath: normalizeSlashes(path.relative(basePath, absolutePath)),
    modifiedAt: getModifiedAt(fileStats)
  };
}

async function collectMarkdownFiles(rootPath, basePath = rootPath, results = []) {
  let entries;

  try {
    entries = await fsp.readdir(rootPath, { withFileTypes: true });
  } catch {
    return results;
  }

  entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    const absolutePath = path.join(rootPath, entry.name);

    if (entry.isSymbolicLink()) {
      continue;
    }

    if (entry.isDirectory()) {
      if (IGNORED_DIRECTORIES.has(entry.name)) {
        continue;
      }

      await collectMarkdownFiles(absolutePath, basePath, results);
      continue;
    }

    if (!entry.isFile() || !isMarkdownFile(absolutePath)) {
      continue;
    }

    results.push(await createMarkdownEntry(absolutePath, basePath));
  }

  return results;
}

async function inspectTarget(targetPath) {
  if (!targetPath || !targetPath.trim()) {
    return { error: "Enter a file or folder path." };
  }

  const absoluteTargetPath = path.resolve(targetPath.trim());

  let stats;
  try {
    stats = await fsp.stat(absoluteTargetPath);
  } catch {
    return { error: `Path not found: ${absoluteTargetPath}` };
  }

  if (stats.isDirectory()) {
    const entries = await collectMarkdownFiles(absoluteTargetPath);

    if (entries.length === 0) {
      return { error: `No Markdown files found in ${absoluteTargetPath}` };
    }

    return {
      kind: "folder",
      rootPath: absoluteTargetPath,
      currentPath: entries[0].absolutePath,
      entries
    };
  }

  if (!stats.isFile()) {
    return { error: `Unsupported path type: ${absoluteTargetPath}` };
  }

  if (!isMarkdownFile(absoluteTargetPath)) {
    return { error: `Not a Markdown file: ${absoluteTargetPath}` };
  }

  return {
    kind: "file",
    rootPath: path.dirname(absoluteTargetPath),
    currentPath: absoluteTargetPath,
    entries: [
      await createMarkdownEntry(absoluteTargetPath, path.dirname(absoluteTargetPath), stats)
    ]
  };
}

async function readMarkdownFile(filePath) {
  const absolutePath = path.resolve(filePath);

  if (!isMarkdownFile(absolutePath)) {
    throw new Error("Only Markdown files can be opened.");
  }

  const content = await fsp.readFile(absolutePath, "utf8");

  return {
    absolutePath,
    name: path.basename(absolutePath),
    content,
    modifiedAt: getModifiedAt(await fsp.stat(absolutePath))
  };
}

function clearWatchTimer() {
  if (watchState.debounceTimer) {
    clearTimeout(watchState.debounceTimer);
    watchState.debounceTimer = null;
  }
}

function closeWatcher(watcher) {
  if (!watcher) {
    return;
  }

  try {
    watcher.close();
  } catch (error) {
    console.warn("[main] Failed to close watcher:", error);
  }
}

function clearWatchContext() {
  clearWatchTimer();
  closeWatcher(watchState.fileWatcher);
  closeWatcher(watchState.parentWatcher);
  closeWatcher(watchState.rootWatcher);
  watchState.currentPath = null;
  watchState.rootPath = null;
  watchState.sourceKind = null;
  watchState.fileWatcher = null;
  watchState.parentWatcher = null;
  watchState.rootWatcher = null;
}

function isWithinDirectory(rootPath, targetPath) {
  const relativePath = path.relative(rootPath, targetPath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function scheduleWatchNotification({ refreshEntries = false } = {}) {
  clearWatchTimer();

  watchState.debounceTimer = setTimeout(() => {
    watchState.debounceTimer = null;

    if (!mainWindow || mainWindow.isDestroyed() || !watchState.currentPath) {
      return;
    }

    mainWindow.webContents.send("watch:changed", {
      currentPath: watchState.currentPath,
      rootPath: watchState.rootPath,
      sourceKind: watchState.sourceKind,
      refreshEntries
    });
  }, WATCH_DEBOUNCE_MS);
}

function createWatcher(targetPath, options, onChange) {
  try {
    return fs.watch(targetPath, options, (_eventType, filename) => {
      onChange(typeof filename === "string" ? filename : "");
    });
  } catch (error) {
    console.warn(`[main] Unable to watch ${targetPath}:`, error);
    return null;
  }
}

async function validateWatchContext(context) {
  if (!context || typeof context !== "object") {
    throw new Error("A watch context is required.");
  }

  const currentPathValue = typeof context.currentPath === "string" ? context.currentPath.trim() : "";

  if (!currentPathValue) {
    throw new Error("A Markdown file is required for auto-refresh.");
  }

  const currentPath = path.resolve(currentPathValue);

  if (!isMarkdownFile(currentPath)) {
    throw new Error("Auto-refresh only supports Markdown files.");
  }

  let currentStats;
  try {
    currentStats = await fsp.stat(currentPath);
  } catch {
    throw new Error(`File not found: ${currentPath}`);
  }

  if (!currentStats.isFile()) {
    throw new Error(`Unsupported file type: ${currentPath}`);
  }

  const sourceKind = context.sourceKind === "folder" ? "folder" : "file";
  const rootPathValue = typeof context.rootPath === "string" && context.rootPath.trim()
    ? context.rootPath.trim()
    : path.dirname(currentPath);
  const rootPath = path.resolve(rootPathValue);

  let rootStats;
  try {
    rootStats = await fsp.stat(rootPath);
  } catch {
    throw new Error(`Watch root not found: ${rootPath}`);
  }

  if (!rootStats.isDirectory()) {
    throw new Error(`Watch root must be a directory: ${rootPath}`);
  }

  return {
    currentPath,
    rootPath,
    sourceKind
  };
}

function applyWatchContext({ currentPath, rootPath, sourceKind }) {
  clearWatchContext();

  watchState.currentPath = currentPath;
  watchState.rootPath = rootPath;
  watchState.sourceKind = sourceKind;

  watchState.fileWatcher = createWatcher(currentPath, {}, () => {
    scheduleWatchNotification();
  });

  const parentPath = path.dirname(currentPath);
  watchState.parentWatcher = createWatcher(parentPath, {}, () => {
    scheduleWatchNotification();
  });

  if (sourceKind === "folder") {
    const recursive = process.platform === "darwin" || process.platform === "win32";
    const watchRootPath = isWithinDirectory(rootPath, currentPath) ? rootPath : parentPath;

    watchState.rootWatcher = createWatcher(
      watchRootPath,
      recursive ? { recursive: true } : {},
      (filename) => {
        if (!filename) {
          scheduleWatchNotification({ refreshEntries: true });
          return;
        }

        const normalizedFilename = normalizeSlashes(filename);
        const pathSegments = normalizedFilename.split("/");
        const extension = path.extname(normalizedFilename).toLowerCase();

        if (pathSegments.some((segment) => IGNORED_DIRECTORIES.has(segment))) {
          return;
        }

        if (!extension || MARKDOWN_EXTENSIONS.has(extension)) {
          scheduleWatchNotification({ refreshEntries: true });
        }
      }
    );
  }
}

function getLaunchPath(argv = process.argv) {
  const args = argv.slice(app.isPackaged ? 1 : 2);
  return args.find((value) => value && !value.startsWith("-")) ?? null;
}

function validateExternalTarget(target) {
  if (typeof target !== "string" || !target.trim()) {
    throw new Error("A URL is required.");
  }

  let parsedTarget;
  try {
    parsedTarget = new URL(target.trim());
  } catch {
    throw new Error("Invalid external URL.");
  }

  if (!SAFE_EXTERNAL_PROTOCOLS.has(parsedTarget.protocol)) {
    throw new Error(`Unsupported external URL protocol: ${parsedTarget.protocol}`);
  }

  return parsedTarget.toString();
}

async function sendOpenedTarget(targetPath) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    pendingOpenPath = targetPath;
    return;
  }

  const payload = await inspectTarget(targetPath);
  mainWindow.webContents.send("target:opened", payload);
}

async function showOpenPicker(options, failureLabel) {
  try {
    const parentWindow = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
    const result = parentWindow
      ? await dialog.showOpenDialog(parentWindow, options)
      : await dialog.showOpenDialog(options);

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return inspectTarget(result.filePaths[0]);
  } catch (error) {
    return {
      error: `Unable to open the ${failureLabel} picker.${error?.message ? ` ${error.message}` : ""}`
    };
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1380,
    height: 920,
    minWidth: 1024,
    minHeight: 720,
    backgroundColor: WINDOW_THEME_BACKGROUNDS.paper,
    icon: appIconPath,
    autoHideMenuBar: true,
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    console.error("[main] Renderer process exited:", details);
  });

  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    console.error("[main] Window failed to load:", {
      errorCode,
      errorDescription,
      validatedURL
    });
  });

  mainWindow.loadFile(path.join(__dirname, "index.html"));

  mainWindow.on("closed", () => {
    clearWatchContext();
    mainWindow = null;
  });
}

ipcMain.on("window:set-theme", (_event, theme) => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  const backgroundColor = WINDOW_THEME_BACKGROUNDS[theme] ?? WINDOW_THEME_BACKGROUNDS.paper;
  mainWindow.setBackgroundColor(backgroundColor);
});

app.whenReady().then(() => {
  pendingOpenPath = getLaunchPath();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  clearWatchContext();

  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("open-file", (event, filePath) => {
  event.preventDefault();
  void sendOpenedTarget(filePath);
});

ipcMain.handle("dialog:open-file", async () =>
  showOpenPicker(
    {
    properties: ["openFile"],
    filters: [
      {
        name: "Markdown",
        extensions: [...MARKDOWN_EXTENSIONS].map((extension) => extension.slice(1))
      }
    ]
    },
    "file"
  )
);

ipcMain.handle("dialog:open-folder", async () =>
  showOpenPicker(
    {
      properties: ["openDirectory"]
    },
    "folder"
  )
);

ipcMain.handle("path:inspect", async (_event, targetPath) => inspectTarget(targetPath));
ipcMain.handle("file:read-markdown", async (_event, filePath) => readMarkdownFile(filePath));
ipcMain.handle("watch:set-context", async (_event, context) => {
  const validatedContext = await validateWatchContext(context);
  applyWatchContext(validatedContext);
  return { ok: true };
});
ipcMain.handle("watch:clear", async () => {
  clearWatchContext();
  return { ok: true };
});
ipcMain.handle("app:get-launch-target", async () => {
  if (!pendingOpenPath) {
    return null;
  }

  const launchPath = pendingOpenPath;
  pendingOpenPath = null;
  return inspectTarget(launchPath);
});
ipcMain.handle("shell:open-external", async (_event, target) => {
  await shell.openExternal(validateExternalTarget(target));
});
