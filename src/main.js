const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");

const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown", ".mdown", ".mkd"]);
const IGNORED_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".next",
  ".turbo",
  ".cache"
]);

let mainWindow = null;
let pendingOpenPath = null;

function isMarkdownFile(filePath) {
  return MARKDOWN_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function normalizeSlashes(value) {
  return value.split(path.sep).join("/");
}

async function collectMarkdownFiles(rootPath, basePath = rootPath, results = []) {
  let entries;

  try {
    entries = await fs.readdir(rootPath, { withFileTypes: true });
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

    results.push({
      name: path.basename(absolutePath),
      absolutePath,
      relativePath: normalizeSlashes(path.relative(basePath, absolutePath))
    });
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
    stats = await fs.stat(absoluteTargetPath);
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
      {
        name: path.basename(absoluteTargetPath),
        absolutePath: absoluteTargetPath,
        relativePath: path.basename(absoluteTargetPath)
      }
    ]
  };
}

async function readMarkdownFile(filePath) {
  const absolutePath = path.resolve(filePath);

  if (!isMarkdownFile(absolutePath)) {
    throw new Error("Only Markdown files can be opened.");
  }

  const content = await fs.readFile(absolutePath, "utf8");

  return {
    absolutePath,
    name: path.basename(absolutePath),
    content
  };
}

function getLaunchPath(argv = process.argv) {
  const args = argv.slice(app.isPackaged ? 1 : 2);
  return args.find((value) => value && !value.startsWith("-")) ?? null;
}

async function sendOpenedTarget(targetPath) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    pendingOpenPath = targetPath;
    return;
  }

  const payload = await inspectTarget(targetPath);
  mainWindow.webContents.send("target:opened", payload);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1380,
    height: 920,
    minWidth: 1024,
    minHeight: 720,
    backgroundColor: "#f7f4ee",
    autoHideMenuBar: true,
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, "index.html"));

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

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
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("open-file", (event, filePath) => {
  event.preventDefault();
  void sendOpenedTarget(filePath);
});

ipcMain.handle("dialog:open-file", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openFile"],
    filters: [
      {
        name: "Markdown",
        extensions: [...MARKDOWN_EXTENSIONS].map((extension) => extension.slice(1))
      }
    ]
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  return inspectTarget(result.filePaths[0]);
});

ipcMain.handle("dialog:open-folder", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory"]
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  return inspectTarget(result.filePaths[0]);
});

ipcMain.handle("path:inspect", async (_event, targetPath) => inspectTarget(targetPath));
ipcMain.handle("file:read-markdown", async (_event, filePath) => readMarkdownFile(filePath));
ipcMain.handle("app:get-launch-target", async () => {
  if (!pendingOpenPath) {
    return null;
  }

  const launchPath = pendingOpenPath;
  pendingOpenPath = null;
  return inspectTarget(launchPath);
});
ipcMain.handle("shell:open-external", async (_event, target) => {
  if (!target) {
    return;
  }

  await shell.openExternal(target);
});
