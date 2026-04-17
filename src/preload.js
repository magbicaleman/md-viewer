const { contextBridge, ipcRenderer } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { fileURLToPath, pathToFileURL } = require("node:url");
const { marked } = require("marked");

const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown", ".mdown", ".mkd"]);
const SAFE_PROTOCOLS = new Set(["http:", "https:", "mailto:", "file:"]);

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

function normalizeSlashes(value = "") {
  return value.split(path.sep).join("/");
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

function getLocalFileSize(absolutePath) {
  try {
    const stats = fs.statSync(absolutePath, { throwIfNoEntry: false });
    return stats?.isFile() ? stats.size : null;
  } catch {
    return null;
  }
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

function resolveResource(rawTarget, currentFilePath) {
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
    if (!SAFE_PROTOCOLS.has(url.protocol)) {
      return null;
    }

    if (url.protocol === "file:") {
      return buildLocalResource(fileURLToPath(url), currentFilePath, `${url.search}${url.hash}`);
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
  return buildLocalResource(absolutePath, currentFilePath, suffix);
}

function buildMarkdownRenderer(currentFilePath) {
  const renderer = new marked.Renderer();

  renderer.html = (html) => escapeHtml(html);

  renderer.link = function link({ href, title, tokens }) {
    const text = this.parser.parseInline(tokens);
    const resolved = resolveResource(href, currentFilePath);

    if (!resolved) {
      return `<span class="md-inline-note">${text}</span>`;
    }

    const titleAttribute = title ? ` title="${escapeAttribute(title)}"` : "";
    const sizeAttribute = Number.isFinite(resolved.sizeBytes)
      ? ` data-link-size-bytes="${escapeAttribute(String(resolved.sizeBytes))}"`
      : "";
    const previewAttributes = ` data-link-kind="${escapeAttribute(resolved.previewKind)}" data-link-destination="${escapeAttribute(resolved.previewTarget)}"${sizeAttribute}`;

    if (resolved.kind === "markdown") {
      const targetPath = resolved.path ?? href;
      return `<a href="#" data-md-path="${escapeAttribute(targetPath)}"${previewAttributes}${titleAttribute}>${text}</a>`;
    }

    if (resolved.kind === "file") {
      const targetPath = resolved.path ?? href;
      return `<a href="#" data-reveal-path="${escapeAttribute(targetPath)}"${previewAttributes}${titleAttribute}>${text}</a>`;
    }

    if (resolved.kind === "location") {
      return `<a href="${escapeAttribute(resolved.href)}"${previewAttributes}${titleAttribute}>${text}</a>`;
    }

    return `<a href="${escapeAttribute(resolved.href)}" data-external="true"${previewAttributes}${titleAttribute}>${text}</a>`;
  };

  renderer.image = function image({ href, title, text }) {
    const resolved = resolveResource(href, currentFilePath);

    if (!resolved || resolved.kind === "markdown") {
      return `<span class="md-inline-note">[image unavailable]</span>`;
    }

    const titleAttribute = title ? ` title="${escapeAttribute(title)}"` : "";
    const altText = escapeAttribute(text ?? "");

    return `<img src="${escapeAttribute(resolved.href)}" alt="${altText}"${titleAttribute} loading="lazy" />`;
  };

  return renderer;
}

function renderMarkdown(markdown, currentFilePath) {
  const renderer = buildMarkdownRenderer(currentFilePath);

  return marked.parse(markdown, {
    gfm: true,
    breaks: true,
    renderer
  });
}

contextBridge.exposeInMainWorld("mdViewer", {
  chooseFile: () => ipcRenderer.invoke("dialog:open-file"),
  chooseFolder: () => ipcRenderer.invoke("dialog:open-folder"),
  inspectPath: (targetPath) => ipcRenderer.invoke("path:inspect", targetPath),
  readMarkdownFile: (filePath) => ipcRenderer.invoke("file:read-markdown", filePath),
  setWatchContext: (context) => ipcRenderer.invoke("watch:set-context", context),
  clearWatchContext: () => ipcRenderer.invoke("watch:clear"),
  renderMarkdown,
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
