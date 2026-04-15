const { contextBridge, ipcRenderer } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
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

function resolveResource(rawTarget, currentFilePath) {
  if (!rawTarget) {
    return null;
  }

  const trimmedTarget = rawTarget.trim();

  try {
    const url = new URL(trimmedTarget);
    if (!SAFE_PROTOCOLS.has(url.protocol)) {
      return null;
    }

    return {
      kind: MARKDOWN_EXTENSIONS.has(path.extname(url.pathname).toLowerCase()) ? "markdown" : "external",
      href: url.toString()
    };
  } catch {
    if (!currentFilePath) {
      return null;
    }
  }

  const absolutePath = path.resolve(path.dirname(currentFilePath), trimmedTarget);
  const fileHref = pathToFileURL(absolutePath).toString();

  return {
    kind: MARKDOWN_EXTENSIONS.has(path.extname(absolutePath).toLowerCase()) ? "markdown" : "file",
    href: fileHref,
    path: absolutePath
  };
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

    if (resolved.kind === "markdown") {
      const targetPath = resolved.path ?? href;
      return `<a href="#" data-md-path="${escapeAttribute(targetPath)}"${titleAttribute}>${text}</a>`;
    }

    return `<a href="${escapeAttribute(resolved.href)}" data-external="true"${titleAttribute}>${text}</a>`;
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
  renderMarkdown,
  getLaunchTarget: () => ipcRenderer.invoke("app:get-launch-target"),
  openExternal: (target) => ipcRenderer.invoke("shell:open-external", target),
  onTargetOpened: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("target:opened", listener);

    return () => {
      ipcRenderer.removeListener("target:opened", listener);
    };
  }
});
