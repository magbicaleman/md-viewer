const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { fileURLToPath, pathToFileURL } = require("node:url");
const { marked } = require("marked");

const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown", ".mdown", ".mkd"]);
const SAFE_EXTERNAL_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);
const SAFE_RESOURCE_PROTOCOLS = new Set(["http:", "https:", "mailto:", "file:"]);
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
const AUDIT_DEMO_WORKSPACE_NAME = "md-viewer-audit-demos";
const AUDIT_DEMO_BENCHMARK_DIRECTORIES = 24;
const AUDIT_DEMO_BENCHMARK_FILES_PER_DIRECTORY = 40;
const ENTRY_METADATA_BATCH_SIZE = 32;
const AUDIT_DEMO_LARGE_DOCUMENT_SECTIONS = 1800;

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
const accessState = {
  approvedRootPath: null
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

function getFileSize(stats) {
  return Number.isFinite(stats?.size) ? stats.size : null;
}

function isLikelyBinaryBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    return false;
  }

  const sampleSize = Math.min(buffer.length, 4096);
  let suspiciousByteCount = 0;

  for (let index = 0; index < sampleSize; index += 1) {
    const byte = buffer[index];

    if (byte === 0) {
      return true;
    }

    const isAllowedControl = byte === 9 || byte === 10 || byte === 12 || byte === 13;
    const isAsciiText = byte >= 32 && byte <= 126;
    const isUtf8OrExtended = byte >= 128;

    if (!isAllowedControl && !isAsciiText && !isUtf8OrExtended) {
      suspiciousByteCount += 1;
    }
  }

  return suspiciousByteCount / sampleSize > 0.1;
}

function escapeHtml(value = "") {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value = "") {
  return escapeHtml(value);
}

function splitTarget(target = "") {
  const hashIndex = target.indexOf("#");
  const queryIndex = target.indexOf("?");
  const boundary = [hashIndex, queryIndex].filter((index) => index >= 0).sort((left, right) => left - right)[0];

  if (boundary === undefined) {
    return {
      pathname: target,
      suffix: ""
    };
  }

  return {
    pathname: target.slice(0, boundary),
    suffix: target.slice(boundary)
  };
}

function formatLocalDestination(absolutePath, currentFilePath, suffix = "") {
  if (!currentFilePath) {
    return `${normalizeSlashes(absolutePath)}${suffix}`;
  }

  const relativePath = normalizeSlashes(path.relative(path.dirname(currentFilePath), absolutePath));
  const displayPath = relativePath || path.basename(absolutePath);

  return `${displayPath}${suffix}`;
}

function formatBlockedResourceTarget(targetPath, rootPath, currentFilePath, suffix = "") {
  if (!targetPath) {
    return "[unknown path]";
  }

  if (currentFilePath) {
    return formatLocalDestination(targetPath, currentFilePath, suffix);
  }

  if (rootPath) {
    return normalizeSlashes(path.relative(rootPath, targetPath)) || path.basename(targetPath);
  }

  return normalizeSlashes(targetPath);
}

function formatOpenedRootLabel(rootPath) {
  if (!rootPath) {
    return "the opened folder";
  }

  return normalizeSlashes(rootPath);
}

function getLocalFileSize(absolutePath) {
  try {
    const stats = fs.statSync(absolutePath, { throwIfNoEntry: false });
    return stats?.isFile() ? stats.size : null;
  } catch {
    return null;
  }
}

function setApprovedRootPath(rootPath) {
  accessState.approvedRootPath = rootPath ? path.resolve(rootPath) : null;
}

function getApprovedRootPath() {
  return accessState.approvedRootPath;
}

function getRealPathSync(targetPath) {
  try {
    if (typeof fs.realpathSync.native === "function") {
      return fs.realpathSync.native(targetPath);
    }

    return fs.realpathSync(targetPath);
  } catch {
    return null;
  }
}

function resolveContainedLocalPath(targetPath, rootPath) {
  const absoluteTargetPath = path.resolve(targetPath);

  if (!rootPath) {
    return {
      absoluteTargetPath,
      realTargetPath: getRealPathSync(absoluteTargetPath),
      isAllowed: false
    };
  }

  const absoluteRootPath = path.resolve(rootPath);
  const realRootPath = getRealPathSync(absoluteRootPath) ?? absoluteRootPath;
  const realTargetPath = getRealPathSync(absoluteTargetPath);

  return {
    absoluteTargetPath,
    absoluteRootPath,
    realRootPath,
    realTargetPath,
    isAllowed: Boolean(realTargetPath) && isWithinDirectory(realRootPath, realTargetPath)
  };
}

function getAuditDemoPaths() {
  const workspacePath = path.join(app.getPath("temp"), AUDIT_DEMO_WORKSPACE_NAME);

  return {
    workspacePath,
    startFile: path.join(workspacePath, "00-start-here.md"),
    symlinkDemo: {
      rootPath: path.join(workspacePath, "01-symlink-escape", "inside"),
      startFile: path.join(workspacePath, "01-symlink-escape", "inside", "open-me.md"),
      escapeLinkPath: path.join(workspacePath, "01-symlink-escape", "inside", "escape.md"),
      outsideFile: path.join(workspacePath, "01-symlink-escape", "outside", "secret.md")
    },
    authorityDemo: {
      rootPath: path.join(workspacePath, "02-renderer-authority", "inside"),
      startFile: path.join(workspacePath, "02-renderer-authority", "inside", "open-me.md"),
      outsideFile: path.join(workspacePath, "02-renderer-authority", "outside", "secret.md"),
      outsideFolder: path.join(workspacePath, "02-renderer-authority", "outside")
    },
    folderBenchmark: {
      rootPath: path.join(workspacePath, "03-folder-index")
    },
    largeDocument: {
      rootPath: path.join(workspacePath, "04-large-document"),
      filePath: path.join(workspacePath, "04-large-document", "large.md")
    }
  };
}

async function writeDemoFile(filePath, content) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, content, "utf8");
}

async function createAuditDemoSymlink(linkPath, targetPath) {
  try {
    await fsp.lstat(linkPath);
    await fsp.rm(linkPath, { force: true });
  } catch {
    // No existing path to remove.
  }

  try {
    await fsp.symlink(targetPath, linkPath);
    return { ok: true, mode: "symlink" };
  } catch (error) {
    await fsp.writeFile(
      linkPath,
      [
        "# Symlink Demo Unavailable",
        "",
        "This platform or filesystem blocked symlink creation, so the breakout demo could not be reproduced exactly.",
        "",
        `Original target: ${targetPath}`,
        `Creation error: ${error?.message ?? "Unknown error"}`
      ].join("\n"),
      "utf8"
    );

    return { ok: false, mode: "fallback", error: error?.message ?? "Unknown error" };
  }
}

function buildLargeDocument() {
  const sections = [];

  for (let index = 0; index < AUDIT_DEMO_LARGE_DOCUMENT_SECTIONS; index += 1) {
    sections.push(
      [
        `## Section ${index + 1}`,
        "",
        `This section exists to make the main-process markdown parse visibly expensive inside the audit lab. Reference [link ${index + 1}](https://example.com/${index + 1}).`,
        "",
        "- First point",
        "- Second point",
        "- Third point",
        "",
        "```txt",
        `render payload ${index + 1}`,
        "```",
        ""
      ].join("\n")
    );
  }

  return [
    "# Large Markdown Demo",
    "",
    "Use the audit panel button to measure file read and markdown render time against this generated document.",
    "",
    ...sections
  ].join("\n");
}

async function ensureAuditDemoWorkspace() {
  const demoPaths = getAuditDemoPaths();

  try {
    await fsp.access(demoPaths.startFile);
    await fsp.access(demoPaths.largeDocument.filePath);
    await fsp.access(path.join(demoPaths.folderBenchmark.rootPath, "bucket-24", "doc-040.md"));
    return demoPaths;
  } catch {
    // Workspace is incomplete or missing, so regenerate it.
  }

  await writeDemoFile(
    demoPaths.startFile,
    [
      "# MD Viewer Audit Demos",
      "",
      "This workspace turns each review finding into something you can trigger in the app.",
      "",
      "## Use The Audit Panel",
      "",
      "1. Keep this file open or click one of the audit buttons in the top panel.",
      "2. Each button either navigates you to the right repro file or runs the demo directly.",
      "3. The result cards explain what happened and why it matters.",
      "",
      "## Demo Map",
      "",
      "- Symlink escape: open the symlink demo and click the in-document escape link.",
      "- Bridge escape: simulate a compromised renderer calling the preload bridge directly.",
      "- Folder scan: open a generated folder with many markdown files and time the index walk.",
      "- Large document: measure full-file read plus main-process markdown render.",
      "- UI stress: hammer the current slider and sidebar code paths to show synchronous writes and rerenders.",
      ""
    ].join("\n")
  );

  await writeDemoFile(
    demoPaths.symlinkDemo.startFile,
    [
      "# Symlink Escape Demo",
      "",
      "The opened root for this demo is the `inside/` folder only.",
      "",
      "The next link is a symlink that lives inside the opened folder, but its real destination lives outside that root.",
      "",
      "Open the [escape link](./escape.md).",
      "",
      "The correct behavior is that the app blocks it instead of following the symlink past the opened root.",
      ""
    ].join("\n")
  );

  await writeDemoFile(
    demoPaths.symlinkDemo.outsideFile,
    [
      "# Outside The Opened Folder",
      "",
      "You should not be able to reach this file from the `inside/` demo root if local resource confinement is real-path safe.",
      "",
      "Seeing this content after clicking the escape link demonstrates the symlink breakout.",
      ""
    ].join("\n")
  );

  await createAuditDemoSymlink(demoPaths.symlinkDemo.escapeLinkPath, demoPaths.symlinkDemo.outsideFile);

  await writeDemoFile(
    demoPaths.authorityDemo.startFile,
    [
      "# Renderer Authority Demo",
      "",
      "This folder is the only root the user intended to open.",
      "",
      "The audit panel's Bridge Escape button simulates what would happen if a malicious script ever executed inside the renderer.",
      "",
      "The correct behavior is that the app blocks path requests outside this root. Only explicit user actions like Open File or Open Folder should change scope.",
      ""
    ].join("\n")
  );

  await writeDemoFile(
    demoPaths.authorityDemo.outsideFile,
    [
      "# Bridge Escape Target",
      "",
      "This file sits outside the `inside/` root for the renderer authority demo.",
      "",
      "If the audit panel can read this file while the app is scoped to the inside folder, the renderer still holds too much path authority.",
      ""
    ].join("\n")
  );

  await writeDemoFile(
    path.join(demoPaths.folderBenchmark.rootPath, "README.md"),
    [
      "# Folder Scan Benchmark",
      "",
      "This folder contains many generated markdown files so the app has to recurse, stat, sort, and render a large sidebar index.",
      "",
      "Use the audit panel to measure how long `inspectPath()` plus the resulting UI load takes.",
      ""
    ].join("\n")
  );

  for (let directoryIndex = 0; directoryIndex < AUDIT_DEMO_BENCHMARK_DIRECTORIES; directoryIndex += 1) {
    const directoryPath = path.join(
      demoPaths.folderBenchmark.rootPath,
      `bucket-${String(directoryIndex + 1).padStart(2, "0")}`
    );

    await fsp.mkdir(directoryPath, { recursive: true });

    for (let fileIndex = 0; fileIndex < AUDIT_DEMO_BENCHMARK_FILES_PER_DIRECTORY; fileIndex += 1) {
      const filePath = path.join(
        directoryPath,
        `doc-${String(fileIndex + 1).padStart(3, "0")}.md`
      );

      await fsp.writeFile(
        filePath,
        [
          `# Demo Document ${directoryIndex + 1}-${fileIndex + 1}`,
          "",
          "This generated note exists so the folder benchmark can reproduce sidebar indexing cost.",
          "",
          `- Directory: ${directoryIndex + 1}`,
          `- File: ${fileIndex + 1}`,
          ""
        ].join("\n"),
        "utf8"
      );
    }
  }

  await writeDemoFile(
    path.join(demoPaths.largeDocument.rootPath, "README.md"),
    [
      "# Large Document Benchmark",
      "",
      "The generated `large.md` file is intentionally big enough to make full-buffer reads and markdown parsing noticeable.",
      "",
      "Use the audit panel to measure read and render time before the document is injected into the DOM.",
      ""
    ].join("\n")
  );

  await writeDemoFile(demoPaths.largeDocument.filePath, buildLargeDocument());

  return demoPaths;
}

function buildLocalResource(absolutePath, currentFilePath, suffix = "") {
  const fileHref = pathToFileURL(absolutePath).toString();

  return {
    kind: MARKDOWN_EXTENSIONS.has(path.extname(absolutePath).toLowerCase()) ? "markdown" : "file",
    href: `${fileHref}${suffix}`,
    path: absolutePath,
    previewKind: "location",
    previewTarget: formatLocalDestination(absolutePath, currentFilePath, suffix),
    sizeBytes: getLocalFileSize(absolutePath)
  };
}

function buildBlockedResource(targetPath, currentFilePath, rootPath, suffix = "") {
  const displayPath = targetPath
    ? formatLocalDestination(targetPath, currentFilePath, suffix)
    : "[unknown path]";
  const readableTarget = formatBlockedResourceTarget(targetPath, rootPath, currentFilePath, suffix);
  const openedRootLabel = formatOpenedRootLabel(rootPath);

  return {
    kind: "blocked",
    previewKind: "location",
    previewTarget: displayPath,
    readableTarget,
    rootPath: rootPath ?? "",
    openedRootLabel,
    reason: "Blocked: local resources must stay inside the folder you opened.",
    path: targetPath ?? null
  };
}

function extractTokenText(tokens = []) {
  return tokens.map((token) => token?.raw ?? "").join("").trim();
}

function resolveResource(rawTarget, currentFilePath, rootPath) {
  if (!rawTarget) {
    return null;
  }

  const trimmedTarget = rawTarget.trim();
  const { pathname, suffix } = splitTarget(trimmedTarget);

  if (!pathname && suffix.startsWith("#") && currentFilePath) {
    return {
      kind: "location",
      href: trimmedTarget,
      previewKind: "location",
      previewTarget: `${path.basename(currentFilePath)}${suffix}`
    };
  }

  try {
    const url = new URL(trimmedTarget);
    if (!SAFE_RESOURCE_PROTOCOLS.has(url.protocol)) {
      return null;
    }

    if (url.protocol === "file:") {
      const localPath = fileURLToPath(url);
      const containment = resolveContainedLocalPath(localPath, rootPath);

      if (!containment.isAllowed) {
        return buildBlockedResource(
          containment.realTargetPath ?? containment.absoluteTargetPath,
          currentFilePath,
          rootPath,
          `${url.search}${url.hash}`
        );
      }

      return buildLocalResource(containment.realTargetPath, currentFilePath, `${url.search}${url.hash}`);
    }

    return {
      kind: "external",
      href: url.toString(),
      previewKind: url.protocol === "mailto:" ? "email" : "website",
      previewTarget: url.toString()
    };
  } catch {
    if (!currentFilePath) {
      return null;
    }
  }

  const absolutePath = path.resolve(path.dirname(currentFilePath), pathname || ".");
  const containment = resolveContainedLocalPath(absolutePath, rootPath);

  if (!containment.isAllowed) {
    return buildBlockedResource(
      containment.realTargetPath ?? containment.absoluteTargetPath,
      currentFilePath,
      rootPath,
      suffix
    );
  }

  return buildLocalResource(containment.realTargetPath, currentFilePath, suffix);
}

function buildMarkdownRenderer(currentFilePath, rootPath) {
  const renderer = new marked.Renderer();

  renderer.html = (html) => escapeHtml(html);

  renderer.link = function link({ href, title, tokens }) {
    const text = this.parser.parseInline(tokens);
    const plainText = extractTokenText(tokens) || "Link";
    const resolved = resolveResource(href, currentFilePath, rootPath);

    if (!resolved) {
      return `<span class="md-inline-note">${text}</span>`;
    }

    const titleAttribute = title ? ` title="${escapeAttribute(title)}"` : "";
    const sizeAttribute = Number.isFinite(resolved.sizeBytes)
      ? ` data-link-size-bytes="${escapeAttribute(String(resolved.sizeBytes))}"`
      : "";
    const previewTargetAttribute = "previewTarget" in resolved
      ? ` data-link-destination="${escapeAttribute(resolved.previewTarget)}"`
      : "";
    const blockedReasonAttribute = resolved.reason
      ? ` data-blocked-reason="${escapeAttribute(resolved.reason)}"`
      : "";
    const previewAttributes = ` data-link-kind="${escapeAttribute(resolved.previewKind)}"${previewTargetAttribute}${sizeAttribute}`;

    if (resolved.kind === "markdown") {
      const targetPath = resolved.path ?? href;
      return `<a href="#" data-md-path="${escapeAttribute(targetPath)}"${previewAttributes}${titleAttribute}>${text}</a>`;
    }

    if (resolved.kind === "file") {
      const targetPath = resolved.path ?? href;
      return `<a href="#" data-reveal-path="${escapeAttribute(targetPath)}"${previewAttributes}${titleAttribute}>${text}</a>`;
    }

    if (resolved.kind === "blocked") {
      return `<span class="md-inline-note" data-blocked-type="link" data-blocked-label="${escapeAttribute(plainText)}" data-blocked-target="${escapeAttribute(resolved.readableTarget)}" data-blocked-root="${escapeAttribute(resolved.rootPath)}" data-link-kind="${escapeAttribute(resolved.previewKind)}"${previewTargetAttribute}${blockedReasonAttribute}>${escapeHtml(plainText)}</span>`;
    }

    if (resolved.kind === "location") {
      return `<a href="${escapeAttribute(resolved.href)}"${previewAttributes}${titleAttribute}>${text}</a>`;
    }

    return `<a href="${escapeAttribute(resolved.href)}" data-external="true"${previewAttributes}${titleAttribute}>${text}</a>`;
  };

  renderer.image = function image({ href, title, text }) {
    const resolved = resolveResource(href, currentFilePath, rootPath);

    if (!resolved || resolved.kind === "markdown") {
      return `<span class="md-inline-note">[image unavailable]</span>`;
    }

    if (resolved.kind === "blocked") {
      return `<span class="md-inline-note" data-blocked-type="image" data-blocked-target="${escapeAttribute(resolved.readableTarget)}" data-blocked-root="${escapeAttribute(resolved.rootPath)}">[image blocked]</span>`;
    }

    const titleAttribute = title ? ` title="${escapeAttribute(title)}"` : "";
    const altText = escapeAttribute(text ?? "");

    return `<img src="${escapeAttribute(resolved.href)}" alt="${altText}"${titleAttribute} loading="lazy" />`;
  };

  return renderer;
}

function renderMarkdown(markdown, currentFilePath, rootPath) {
  const renderer = buildMarkdownRenderer(currentFilePath, rootPath);

  return marked.parse(typeof markdown === "string" ? markdown : String(markdown ?? ""), {
    gfm: true,
    breaks: true,
    renderer
  });
}

async function createMarkdownEntry(absolutePath, basePath, stats) {
  const fileStats = stats ?? await fsp.stat(absolutePath);

  return {
    name: path.basename(absolutePath),
    absolutePath,
    relativePath: normalizeSlashes(path.relative(basePath, absolutePath)),
    modifiedAt: getModifiedAt(fileStats),
    sizeBytes: getFileSize(fileStats)
  };
}

function createFolderIndexEntry(absolutePath, basePath) {
  return {
    name: path.basename(absolutePath),
    absolutePath,
    relativePath: normalizeSlashes(path.relative(basePath, absolutePath)),
    modifiedAt: null,
    sizeBytes: null
  };
}

async function mapInBatches(items, batchSize, mapper) {
  const results = [];

  for (let index = 0; index < items.length; index += batchSize) {
    const batch = items.slice(index, index + batchSize);
    results.push(...await Promise.all(batch.map(mapper)));
  }

  return results;
}

async function collectMarkdownPaths(rootPath, results = []) {
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

      await collectMarkdownPaths(absolutePath, results);
      continue;
    }

    if (entry.isFile() && isMarkdownFile(absolutePath)) {
      results.push(absolutePath);
    }
  }

  return results;
}

async function collectMarkdownFiles(rootPath) {
  const absolutePaths = await collectMarkdownPaths(rootPath);
  const entries = absolutePaths.map((absolutePath) => createFolderIndexEntry(absolutePath, rootPath));

  entries.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  return entries;
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

function isPathInsideApprovedRoot(targetPath) {
  const approvedRootPath = getApprovedRootPath();

  if (!approvedRootPath) {
    return false;
  }

  return resolveContainedLocalPath(targetPath, approvedRootPath).isAllowed;
}

async function inspectRendererTarget(targetPath) {
  if (!targetPath || !targetPath.trim()) {
    return { error: "Enter a file or folder path." };
  }

  const absoluteTargetPath = path.resolve(targetPath.trim());

  if (!isPathInsideApprovedRoot(absoluteTargetPath)) {
    return {
      error: "Blocked: renderer requests must stay inside the current folder. Use Open File or Open Folder to change scope."
    };
  }

  return inspectTarget(absoluteTargetPath);
}

async function openAuditDemoTarget(action) {
  const demoPaths = await ensureAuditDemoWorkspace();
  const targetByAction = {
    symlink: demoPaths.symlinkDemo.startFile,
    bridge: demoPaths.authorityDemo.startFile,
    folder: demoPaths.folderBenchmark.rootPath,
    large: demoPaths.largeDocument.filePath,
    ui: demoPaths.folderBenchmark.rootPath
  };
  const targetPath = targetByAction[action];

  if (!targetPath) {
    return { error: "Unknown audit demo target." };
  }

  const target = await inspectTarget(targetPath);

  if (!target?.error) {
    setApprovedRootPath(target.rootPath);
  }

  return target;
}

async function readMarkdownFile(filePath) {
  const absolutePath = path.resolve(filePath);

  if (!isPathInsideApprovedRoot(absolutePath)) {
    throw new Error(
      "Blocked: renderer file reads must stay inside the current approved folder. Open a new file or folder explicitly to change scope."
    );
  }

  if (!isMarkdownFile(absolutePath)) {
    throw new Error("Only Markdown files can be opened.");
  }

  const stats = await fsp.stat(absolutePath);
  const contentBuffer = await fsp.readFile(absolutePath);

  if (isLikelyBinaryBuffer(contentBuffer)) {
    throw new Error("This file does not appear to be text/markdown.");
  }

  return {
    absolutePath,
    name: path.basename(absolutePath),
    content: contentBuffer.toString("utf8"),
    modifiedAt: getModifiedAt(stats),
    sizeBytes: getFileSize(stats)
  };
}

async function readMarkdownEntryMetadata(filePath) {
  const absolutePath = path.resolve(filePath);

  if (!isPathInsideApprovedRoot(absolutePath)) {
    throw new Error("Blocked: metadata requests must stay inside the current approved folder.");
  }

  if (!isMarkdownFile(absolutePath)) {
    throw new Error("Only Markdown files can be inspected.");
  }

  const stats = await fsp.stat(absolutePath);

  if (!stats.isFile()) {
    throw new Error(`Unsupported file type: ${absolutePath}`);
  }

  return {
    absolutePath,
    modifiedAt: getModifiedAt(stats),
    sizeBytes: getFileSize(stats)
  };
}

async function readMarkdownEntryMetadataBatch(filePaths) {
  if (!Array.isArray(filePaths)) {
    throw new Error("A metadata path array is required.");
  }

  const absolutePaths = Array.from(
    new Set(
      filePaths
        .filter((filePath) => typeof filePath === "string" && filePath.trim())
        .map((filePath) => path.resolve(filePath.trim()))
    )
  );

  return mapInBatches(
    absolutePaths,
    ENTRY_METADATA_BATCH_SIZE,
    (absolutePath) => readMarkdownEntryMetadata(absolutePath)
  );
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

  if (!isPathInsideApprovedRoot(currentPath)) {
    throw new Error("Watch requests must stay inside the current approved folder.");
  }

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

  if (!isPathInsideApprovedRoot(rootPath)) {
    throw new Error("Watch roots must stay inside the current approved folder.");
  }

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

async function validateRevealTarget(target) {
  if (typeof target !== "string" || !target.trim()) {
    throw new Error("A file path is required.");
  }

  const absolutePath = path.resolve(target.trim());

  if (!isPathInsideApprovedRoot(absolutePath)) {
    throw new Error("Blocked: reveal requests must stay inside the current approved folder.");
  }

  let stats;
  try {
    stats = await fsp.stat(absolutePath);
  } catch {
    throw new Error(`File not found: ${absolutePath}`);
  }

  if (!stats.isFile() && !stats.isDirectory()) {
    throw new Error(`Unsupported path type: ${absolutePath}`);
  }

  return absolutePath;
}

async function sendOpenedTarget(targetPath) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    pendingOpenPath = targetPath;
    return;
  }

  const payload = await inspectTarget(targetPath);

  if (!payload?.error) {
    setApprovedRootPath(payload.rootPath);
  }

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

    const target = await inspectTarget(result.filePaths[0]);

    if (!target?.error) {
      setApprovedRootPath(target.rootPath);
    }

    return target;
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
      sandbox: true
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
    setApprovedRootPath(null);
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
  setApprovedRootPath(null);

  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("open-file", (event, filePath) => {
  event.preventDefault();
  void sendOpenedTarget(filePath);
});

ipcMain.handle("audit:open", async () => {
  const demoPaths = await ensureAuditDemoWorkspace();
  const target = await inspectTarget(demoPaths.startFile);

  if (!target?.error) {
    setApprovedRootPath(target.rootPath);
  }

  return {
    target,
    paths: demoPaths
  };
});

ipcMain.handle("audit:get-paths", async () => ensureAuditDemoWorkspace());
ipcMain.handle("audit:open-target", async (_event, action) => openAuditDemoTarget(action));

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

ipcMain.handle("path:inspect", async (_event, targetPath) => inspectRendererTarget(targetPath));
ipcMain.handle("file:get-entry-metadata-batch", async (_event, filePaths) => readMarkdownEntryMetadataBatch(filePaths));
ipcMain.handle("file:read-markdown", async (_event, filePath) => readMarkdownFile(filePath));
ipcMain.handle("markdown:render", async (_event, markdown, currentFilePath, rootPath) =>
  renderMarkdown(
    markdown,
    typeof currentFilePath === "string" ? currentFilePath : "",
    typeof rootPath === "string" ? rootPath : ""
  )
);
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
  const target = await inspectTarget(launchPath);

  if (!target?.error) {
    setApprovedRootPath(target.rootPath);
  }

  return target;
});
ipcMain.handle("shell:open-external", async (_event, target) => {
  await shell.openExternal(validateExternalTarget(target));
});
ipcMain.handle("shell:show-item-in-folder", async (_event, target) => {
  shell.showItemInFolder(await validateRevealTarget(target));
  return { ok: true };
});
