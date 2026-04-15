const STORAGE_KEY = "md-viewer-preferences";

const state = {
  sourceKind: null,
  rootPath: null,
  entries: [],
  currentPath: null,
  filterText: "",
  preferences: loadPreferences()
};

const elements = {
  openFileButton: document.querySelector("#openFileButton"),
  openFolderButton: document.querySelector("#openFolderButton"),
  toggleSidebarButton: document.querySelector("#toggleSidebarButton"),
  toggleAdvancedButton: document.querySelector("#toggleAdvancedButton"),
  pathForm: document.querySelector("#pathForm"),
  pathInput: document.querySelector("#pathInput"),
  filterInput: document.querySelector("#filterInput"),
  fileList: document.querySelector("#fileList"),
  fileCount: document.querySelector("#fileCount"),
  rootLabel: document.querySelector("#rootLabel"),
  titlebarDocumentName: document.querySelector("#titlebarDocumentName"),
  documentTitle: document.querySelector("#documentTitle"),
  documentPath: document.querySelector("#documentPath"),
  markdownContent: document.querySelector("#markdownContent"),
  emptyState: document.querySelector("#emptyState"),
  statusBanner: document.querySelector("#statusBanner"),
  toggleSettingsButton: document.querySelector("#toggleSettingsButton"),
  settingsPanel: document.querySelector("#settingsPanel"),
  themeSelect: document.querySelector("#themeSelect"),
  fontSizeInput: document.querySelector("#fontSizeInput"),
  readerWidthInput: document.querySelector("#readerWidthInput")
};

function loadPreferences() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    return {
      theme: stored.theme ?? "paper",
      fontSize: Number(stored.fontSize ?? 18),
      readerWidth: Number(stored.readerWidth ?? 780),
      sidebarOpen: stored.sidebarOpen ?? true
    };
  } catch {
    return {
      theme: "paper",
      fontSize: 18,
      readerWidth: 780,
      sidebarOpen: true
    };
  }
}

function savePreferences() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.preferences));
}

function applyPreferences() {
  document.body.dataset.theme = state.preferences.theme;
  document.body.dataset.sidebar = state.preferences.sidebarOpen ? "open" : "closed";
  document.documentElement.style.setProperty("--reader-font-size", `${state.preferences.fontSize}px`);
  document.documentElement.style.setProperty("--reader-width", `${state.preferences.readerWidth}px`);

  elements.themeSelect.value = state.preferences.theme;
  elements.fontSizeInput.value = String(state.preferences.fontSize);
  elements.readerWidthInput.value = String(state.preferences.readerWidth);
  elements.toggleSidebarButton.setAttribute("aria-pressed", String(state.preferences.sidebarOpen));
  elements.toggleSidebarButton.setAttribute(
    "aria-label",
    state.preferences.sidebarOpen ? "Hide library sidebar" : "Show library sidebar"
  );
  elements.toggleSidebarButton.setAttribute(
    "title",
    state.preferences.sidebarOpen ? "Hide library sidebar" : "Show library sidebar"
  );
}

function showStatus(message, kind = "info") {
  if (!message) {
    elements.statusBanner.hidden = true;
    elements.statusBanner.textContent = "";
    elements.statusBanner.dataset.kind = "";
    return;
  }

  elements.statusBanner.hidden = false;
  elements.statusBanner.textContent = message;
  elements.statusBanner.dataset.kind = kind;
}

function formatError(error, fallbackMessage) {
  if (error instanceof Error) {
    return error.message || fallbackMessage;
  }

  if (typeof error === "string" && error.trim()) {
    return error;
  }

  return fallbackMessage;
}

function reportError(error, fallbackMessage) {
  const message = formatError(error, fallbackMessage);
  console.error(fallbackMessage, error);
  showStatus(message, "error");
}

function getBridge() {
  if (!window.mdViewer) {
    throw new Error("The Electron preload bridge did not load.");
  }

  return window.mdViewer;
}

function setSourceInfo() {
  elements.rootLabel.textContent = state.rootPath ?? "No source selected";
  elements.fileCount.textContent = `${state.entries.length} file${state.entries.length === 1 ? "" : "s"}`;
  if (!state.currentPath) {
    elements.titlebarDocumentName.textContent = "No document loaded";
  }
}

function getVisibleEntries() {
  const filterValue = state.filterText.trim().toLowerCase();

  if (!filterValue) {
    return state.entries;
  }

  return state.entries.filter((entry) => entry.relativePath.toLowerCase().includes(filterValue));
}

function renderFileList() {
  const visibleEntries = getVisibleEntries();
  elements.fileList.innerHTML = "";

  if (visibleEntries.length === 0) {
    const empty = document.createElement("div");
    empty.className = "file-list-empty";
    empty.textContent = state.entries.length === 0 ? "No files loaded yet." : "No files match the current filter.";
    elements.fileList.append(empty);
    return;
  }

  for (const entry of visibleEntries) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "file-row";
    button.dataset.path = entry.absolutePath;
    button.dataset.active = String(entry.absolutePath === state.currentPath);
    button.innerHTML = `
      <span class="file-row-name">${entry.name}</span>
      <span class="file-row-path">${entry.relativePath}</span>
    `;
    elements.fileList.append(button);
  }
}

async function openMarkdownFile(filePath) {
  try {
    const bridge = getBridge();
    const file = await bridge.readMarkdownFile(filePath);
    const html = bridge.renderMarkdown(file.content, file.absolutePath);

    state.currentPath = file.absolutePath;
    elements.titlebarDocumentName.textContent = file.name;
    elements.documentTitle.textContent = file.name;
    elements.documentPath.textContent = file.absolutePath;
    elements.markdownContent.innerHTML = html;
    elements.markdownContent.hidden = false;
    elements.emptyState.hidden = true;
    renderFileList();
    showStatus("");
  } catch (error) {
    reportError(error, "Unable to open the selected Markdown file.");
  }
}

function mergeEntryIfMissing(filePath) {
  const exists = state.entries.some((entry) => entry.absolutePath === filePath);

  if (exists) {
    return;
  }

  state.entries = [
    ...state.entries,
    {
      name: filePath.split(/[\\/]/).at(-1) ?? filePath,
      absolutePath: filePath,
      relativePath: filePath
    }
  ];

  setSourceInfo();
  renderFileList();
}

async function loadTarget(target) {
  if (!target) {
    return;
  }

  if (target.error) {
    showStatus(target.error, "error");
    return;
  }

  state.sourceKind = target.kind;
  state.rootPath = target.rootPath;
  state.entries = target.entries;
  state.currentPath = target.currentPath;
  setSourceInfo();
  renderFileList();

  if (target.currentPath) {
    await openMarkdownFile(target.currentPath);
  }
}

async function loadPathFromInput() {
  const targetPath = elements.pathInput.value.trim();

  if (!targetPath) {
    showStatus("Enter a file or folder path first.", "error");
    return;
  }

  showStatus("Resolving path…");
  try {
    const target = await getBridge().inspectPath(targetPath);
    await loadTarget(target);
  } catch (error) {
    reportError(error, "Unable to resolve the provided path.");
  }
}

function toggleAdvancedPanel(forceOpen) {
  const isOpen = typeof forceOpen === "boolean" ? forceOpen : elements.pathForm.hidden;
  elements.pathForm.hidden = !isOpen;
  elements.toggleAdvancedButton.setAttribute("aria-expanded", String(isOpen));
}

function toggleSidebar(forceOpen) {
  state.preferences.sidebarOpen = typeof forceOpen === "boolean" ? forceOpen : !state.preferences.sidebarOpen;
  applyPreferences();
  savePreferences();
}

function handleMarkdownClick(event) {
  const anchor = event.target.closest("a");

  if (!anchor) {
    return;
  }

  const markdownPath = anchor.dataset.mdPath;
  const externalHref = anchor.dataset.external === "true" ? anchor.getAttribute("href") : null;

  if (markdownPath) {
    event.preventDefault();
    mergeEntryIfMissing(markdownPath);
    void openMarkdownFile(markdownPath);
    return;
  }

  if (externalHref) {
    event.preventDefault();
    try {
      void getBridge().openExternal(externalHref);
    } catch (error) {
      reportError(error, "Unable to open the external link.");
    }
  }
}

function bindEvents() {
  elements.openFileButton.addEventListener("click", async () => {
    try {
      const target = await getBridge().chooseFile();
      if (!target) {
        showStatus("");
        return;
      }

      await loadTarget(target);
    } catch (error) {
      reportError(error, "Unable to open the file picker.");
    }
  });

  elements.openFolderButton.addEventListener("click", async () => {
    try {
      const target = await getBridge().chooseFolder();
      if (!target) {
        showStatus("");
        return;
      }

      await loadTarget(target);
    } catch (error) {
      reportError(error, "Unable to open the folder picker.");
    }
  });

  elements.toggleAdvancedButton.addEventListener("click", () => {
    toggleAdvancedPanel();
  });

  elements.toggleSidebarButton.addEventListener("click", () => {
    toggleSidebar();
  });

  elements.pathForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void loadPathFromInput();
  });

  elements.fileList.addEventListener("click", (event) => {
    const fileButton = event.target.closest(".file-row");

    if (!fileButton) {
      return;
    }

    void openMarkdownFile(fileButton.dataset.path);
  });

  elements.filterInput.addEventListener("input", (event) => {
    state.filterText = event.target.value;
    renderFileList();
  });

  elements.toggleSettingsButton.addEventListener("click", () => {
    elements.settingsPanel.hidden = !elements.settingsPanel.hidden;
  });

  elements.themeSelect.addEventListener("change", (event) => {
    state.preferences.theme = event.target.value;
    applyPreferences();
    savePreferences();
  });

  elements.fontSizeInput.addEventListener("input", (event) => {
    state.preferences.fontSize = Number(event.target.value);
    applyPreferences();
    savePreferences();
  });

  elements.readerWidthInput.addEventListener("input", (event) => {
    state.preferences.readerWidth = Number(event.target.value);
    applyPreferences();
    savePreferences();
  });

  elements.markdownContent.addEventListener("click", handleMarkdownClick);
}

async function initialize() {
  try {
    applyPreferences();
    toggleAdvancedPanel(false);
    setSourceInfo();
    renderFileList();
    bindEvents();

    const bridge = getBridge();
    const launchTarget = await bridge.getLaunchTarget();
    if (launchTarget) {
      await loadTarget(launchTarget);
    }

    bridge.onTargetOpened((target) => {
      void loadTarget(target);
    });
  } catch (error) {
    reportError(error, "Application initialization failed.");
  }
}

window.addEventListener("error", (event) => {
  reportError(event.error ?? event.message, "An unexpected renderer error occurred.");
});

window.addEventListener("unhandledrejection", (event) => {
  reportError(event.reason, "An unexpected async renderer error occurred.");
});

void initialize();
