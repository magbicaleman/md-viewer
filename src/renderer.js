const STORAGE_KEY = "md-viewer-preferences";
const DEFAULT_SIDEBAR_WIDTH = 336;
const MIN_SIDEBAR_WIDTH = 300;
const MAX_SIDEBAR_WIDTH = 560;
const RANGE_BUBBLE_IDLE_DELAY_MS = 1400;

const state = {
  sourceKind: null,
  rootPath: null,
  entries: [],
  currentPath: null,
  filterText: "",
  preferences: loadPreferences(),
  sidebarResizeSession: null,
  rangeBubbleTimeouts: new Map()
};

function normalizeReaderWidth(value) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return 82;
  }

  // Migrate older pixel-based values into a percentage slider range.
  if (numericValue > 100) {
    const legacyMin = 760;
    const legacyMax = 1800;
    const clampedLegacy = Math.min(legacyMax, Math.max(legacyMin, numericValue));
    const normalized = 55 + ((clampedLegacy - legacyMin) / (legacyMax - legacyMin)) * 45;
    return Math.round(normalized);
  }

  return Math.min(100, Math.max(55, Math.round(numericValue)));
}

function normalizeSidebarWidth(value) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return DEFAULT_SIDEBAR_WIDTH;
  }

  return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, Math.round(numericValue)));
}

const elements = {
  openFileButton: document.querySelector("#openFileButton"),
  openFolderButton: document.querySelector("#openFolderButton"),
  toggleSidebarButton: document.querySelector("#toggleSidebarButton"),
  toggleAdvancedButton: document.querySelector("#toggleAdvancedButton"),
  sidebarResizeHandle: document.querySelector("#sidebarResizeHandle"),
  themeSelectShell: document.querySelector("#themeSelectShell"),
  themeSelectTrigger: document.querySelector("#themeSelectTrigger"),
  themeSelectLabel: document.querySelector("#themeSelectLabel"),
  themeSelectMenu: document.querySelector("#themeSelectMenu"),
  pathForm: document.querySelector("#pathForm"),
  pathInput: document.querySelector("#pathInput"),
  filterInput: document.querySelector("#filterInput"),
  fileList: document.querySelector("#fileList"),
  fileCount: document.querySelector("#fileCount"),
  rootLabel: document.querySelector("#rootLabel"),
  titlebarDocumentName: document.querySelector("#titlebarDocumentName"),
  markdownContent: document.querySelector("#markdownContent"),
  emptyState: document.querySelector("#emptyState"),
  statusBanner: document.querySelector("#statusBanner"),
  toggleSettingsButton: document.querySelector("#toggleSettingsButton"),
  settingsPanel: document.querySelector("#settingsPanel"),
  readerShellBottom: document.querySelector(".reader-shell-bottom"),
  readerContent: document.querySelector(".reader-content"),
  sidebar: document.querySelector(".sidebar"),
  themeSelect: document.querySelector("#themeSelect"),
  fontSizeValue: document.querySelector("#fontSizeValue"),
  fontSizeInput: document.querySelector("#fontSizeInput"),
  readerWidthValue: document.querySelector("#readerWidthValue"),
  readerWidthInput: document.querySelector("#readerWidthInput")
};

function loadPreferences() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    return {
      theme: stored.theme ?? "paper",
      fontSize: Number(stored.fontSize ?? 18),
      readerWidth: normalizeReaderWidth(stored.readerWidth ?? 82),
      sidebarWidth: normalizeSidebarWidth(stored.sidebarWidth ?? DEFAULT_SIDEBAR_WIDTH),
      sidebarOpen: stored.sidebarOpen ?? true
    };
  } catch {
    return {
      theme: "paper",
      fontSize: 18,
      readerWidth: 82,
      sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
      sidebarOpen: true
    };
  }
}

function savePreferences() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.preferences));
}

function getThemeOptionButtons() {
  return Array.from(elements.themeSelectMenu?.querySelectorAll(".theme-option") ?? []);
}

function getSelectedThemeLabel() {
  return elements.themeSelect.selectedOptions[0]?.textContent?.trim() ?? "Theme";
}

function setThemeMenuOpen(isOpen) {
  if (!elements.themeSelectShell || !elements.themeSelectTrigger || !elements.themeSelectMenu) {
    return;
  }

  elements.themeSelectShell.dataset.themeMenuOpen = isOpen ? "true" : "false";
  elements.themeSelectTrigger.setAttribute("aria-expanded", String(isOpen));
  elements.themeSelectMenu.hidden = !isOpen;
}

function focusThemeOption(themeValue = elements.themeSelect.value) {
  const optionToFocus = getThemeOptionButtons().find((button) => button.dataset.value === themeValue) ?? getThemeOptionButtons()[0];
  optionToFocus?.focus();
}

function closeThemeMenu({ restoreFocus = false } = {}) {
  setThemeMenuOpen(false);

  if (restoreFocus) {
    elements.themeSelectTrigger?.focus();
  }
}

function openThemeMenu({ focusSelected = true } = {}) {
  setThemeMenuOpen(true);

  if (focusSelected) {
    requestAnimationFrame(() => {
      focusThemeOption();
    });
  }
}

function syncThemeMenuSelection() {
  for (const button of getThemeOptionButtons()) {
    const isSelected = button.dataset.value === elements.themeSelect.value;
    button.dataset.selected = String(isSelected);
    button.setAttribute("aria-selected", String(isSelected));
  }
}

function renderThemeOptions() {
  if (!elements.themeSelectMenu) {
    return;
  }

  elements.themeSelectMenu.innerHTML = "";

  for (const option of Array.from(elements.themeSelect.options)) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "theme-option";
    button.dataset.value = option.value;
    button.dataset.themeValue = option.value;
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", String(option.selected));
    button.dataset.selected = String(option.selected);
    button.innerHTML = `
      <span class="theme-option-swatch" aria-hidden="true"></span>
      <span class="theme-option-label">${option.textContent}</span>
      <svg class="theme-option-check" viewBox="0 0 20 20" aria-hidden="true">
        <path d="m4.5 10.5 3.3 3.3 7.7-7.7"></path>
      </svg>
    `;
    elements.themeSelectMenu.append(button);
  }
}

function syncThemeSelectShell() {
  if (elements.themeSelectShell) {
    elements.themeSelectShell.dataset.themeValue = state.preferences.theme;
  }

  if (elements.themeSelectLabel) {
    elements.themeSelectLabel.textContent = getSelectedThemeLabel();
  }

  syncThemeMenuSelection();
}

function syncAllRangeControls() {
  syncRangeControl(elements.fontSizeInput, elements.fontSizeValue);
  syncRangeControl(elements.readerWidthInput, elements.readerWidthValue);
}

function handleThemeMenuKeydown(event) {
  const optionButtons = getThemeOptionButtons();

  if (optionButtons.length === 0) {
    return;
  }

  const currentIndex = optionButtons.findIndex((button) => button === document.activeElement);

  if (event.key === "Escape") {
    event.preventDefault();
    closeThemeMenu({ restoreFocus: true });
    return;
  }

  if (event.key === "ArrowDown") {
    event.preventDefault();
    optionButtons[(currentIndex + 1 + optionButtons.length) % optionButtons.length]?.focus();
    return;
  }

  if (event.key === "ArrowUp") {
    event.preventDefault();
    optionButtons[(currentIndex - 1 + optionButtons.length) % optionButtons.length]?.focus();
    return;
  }

  if (event.key === "Home") {
    event.preventDefault();
    optionButtons[0]?.focus();
    return;
  }

  if (event.key === "End") {
    event.preventDefault();
    optionButtons.at(-1)?.focus();
    return;
  }

  if (event.key === "Tab") {
    closeThemeMenu();
  }
}

function setRangeBubbleActive(input, isActive, delay = 0) {
  const shell = input?.closest(".range-shell");

  if (!shell || !input?.id) {
    return;
  }

  const existingTimeout = state.rangeBubbleTimeouts.get(input.id);

  if (existingTimeout) {
    window.clearTimeout(existingTimeout);
    state.rangeBubbleTimeouts.delete(input.id);
  }

  if (delay > 0) {
    const timeout = window.setTimeout(() => {
      shell.dataset.bubbleActive = isActive ? "true" : "false";
      state.rangeBubbleTimeouts.delete(input.id);
    }, delay);

    state.rangeBubbleTimeouts.set(input.id, timeout);
    return;
  }

  shell.dataset.bubbleActive = isActive ? "true" : "false";
}

function syncRangeControl(input, valueOutput) {
  if (!input || !valueOutput) {
    return;
  }

  const min = Number(input.min ?? 0);
  const max = Number(input.max ?? 100);
  const value = Number(input.value ?? min);
  const ratio = max === min ? 0 : (value - min) / (max - min);
  const progress = `${Math.min(100, Math.max(0, ratio * 100))}%`;
  const displayValue = Number.isInteger(value) ? String(value) : value.toFixed(0);
  const shell = valueOutput.closest(".range-shell");
  const displaySuffix = input.id === "readerWidthInput" ? "%" : "";

  valueOutput.textContent = `${displayValue}${displaySuffix}`;

  input.style.setProperty("--range-progress", progress);

  if (shell) {
    shell.style.setProperty("--range-progress", progress);
    shell.dataset.bubbleActive ||= "false";
  }

  if (shell && input.offsetWidth > 0) {
    const thumbWidth = 28;
    const shellWidth = shell.offsetWidth;
    const bubbleWidth = valueOutput.offsetWidth || 54;
    const bubbleCenter = input.offsetLeft + ratio * Math.max(0, input.offsetWidth - thumbWidth) + thumbWidth / 2;
    const minCenter = bubbleWidth / 2;
    const maxCenter = Math.max(minCenter, shellWidth - bubbleWidth / 2);
    const clampedCenter = Math.min(maxCenter, Math.max(minCenter, bubbleCenter));
    const tailOffset = Math.min(bubbleWidth - 12, Math.max(12, bubbleCenter - clampedCenter + bubbleWidth / 2));

    valueOutput.style.left = `${clampedCenter}px`;
    valueOutput.style.setProperty("--bubble-tail-offset", `${tailOffset}px`);
  } else {
    valueOutput.style.left = progress;
    valueOutput.style.setProperty("--bubble-tail-offset", "50%");
  }
}

function applyPreferences() {
  document.body.dataset.theme = state.preferences.theme;
  getBridge().setWindowTheme(state.preferences.theme);
  document.body.dataset.sidebar = state.preferences.sidebarOpen ? "open" : "closed";
  document.documentElement.style.setProperty("--reader-font-size", `${state.preferences.fontSize}px`);
  document.documentElement.style.setProperty("--reader-width", `${state.preferences.readerWidth}%`);
  document.documentElement.style.setProperty("--sidebar-width", `${getEffectiveSidebarWidth()}px`);

  elements.themeSelect.value = state.preferences.theme;
  elements.fontSizeInput.value = String(state.preferences.fontSize);
  elements.readerWidthInput.value = String(state.preferences.readerWidth);
  syncThemeSelectShell();
  syncAllRangeControls();
  elements.toggleSidebarButton.setAttribute("aria-pressed", String(state.preferences.sidebarOpen));
  elements.toggleSidebarButton.setAttribute(
    "aria-label",
    state.preferences.sidebarOpen ? "Hide library sidebar" : "Show library sidebar"
  );
  elements.toggleSidebarButton.setAttribute(
    "title",
    state.preferences.sidebarOpen ? "Hide library sidebar" : "Show library sidebar"
  );
  elements.sidebarResizeHandle.setAttribute("aria-valuemin", String(MIN_SIDEBAR_WIDTH));
  elements.sidebarResizeHandle.setAttribute("aria-valuemax", String(getSidebarWidthBounds().max));
  elements.sidebarResizeHandle.setAttribute("aria-valuenow", String(getEffectiveSidebarWidth()));
}

function getSidebarWidthBounds() {
  const viewportWidth = window.innerWidth;
  const min = MIN_SIDEBAR_WIDTH;
  const max = Math.max(min, Math.min(MAX_SIDEBAR_WIDTH, viewportWidth - 360));

  return { min, max };
}

function getEffectiveSidebarWidth() {
  const { min, max } = getSidebarWidthBounds();
  return Math.min(max, Math.max(min, state.preferences.sidebarWidth));
}

function updateSidebarWidth(width, { persist = true } = {}) {
  state.preferences.sidebarWidth = normalizeSidebarWidth(width);
  applyPreferences();

  if (persist) {
    savePreferences();
  }
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

function updateEmptyState() {
  const hasDocument = Boolean(state.currentPath);
  elements.emptyState.hidden = hasDocument;
  elements.markdownContent.hidden = !hasDocument;
}

function updateReaderScrollState() {
  const viewport = elements.readerContent;
  const shellBottom = elements.readerShellBottom;

  if (!viewport) {
    return;
  }

  const canScroll = viewport.scrollHeight > viewport.clientHeight + 1;
  const showTopShadow = canScroll && viewport.scrollTop > 1;
  const showBottomShadow = canScroll && viewport.scrollTop + viewport.clientHeight < viewport.scrollHeight - 1;

  viewport.dataset.scrollTopShadow = String(showTopShadow);
  viewport.dataset.scrollBottomShadow = String(showBottomShadow);

  if (shellBottom) {
    shellBottom.dataset.scrollTopShadow = String(showTopShadow);
    shellBottom.dataset.scrollBottomShadow = String(showBottomShadow);
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
    elements.markdownContent.innerHTML = html;
    updateEmptyState();
    renderFileList();
    showStatus("");
    requestAnimationFrame(updateReaderScrollState);
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
  updateEmptyState();
  renderFileList();
  requestAnimationFrame(updateReaderScrollState);

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

  if (!state.preferences.sidebarOpen) {
    clearSidebarResizeSession();
  }

  applyPreferences();
  savePreferences();
}

function syncSettingsButton() {
  const isOpen = !elements.settingsPanel.hidden;
  elements.toggleSettingsButton.setAttribute("aria-pressed", String(isOpen));
  elements.toggleSettingsButton.setAttribute("aria-label", isOpen ? "Hide display controls" : "Show display controls");
  elements.toggleSettingsButton.setAttribute("title", isOpen ? "Hide display controls" : "Show display controls");
}

function clearSidebarResizeSession({ pointerId, persist = true } = {}) {
  const activePointerId = pointerId ?? state.sidebarResizeSession?.pointerId;

  state.sidebarResizeSession = null;
  delete document.body.dataset.resizingSidebar;

  if (typeof activePointerId === "number" && elements.sidebarResizeHandle.hasPointerCapture(activePointerId)) {
    elements.sidebarResizeHandle.releasePointerCapture(activePointerId);
  }

  if (persist) {
    savePreferences();
  }
}

function startSidebarResize(pointerEvent) {
  if (!state.preferences.sidebarOpen || window.innerWidth <= 980) {
    return;
  }

  pointerEvent.preventDefault();

  clearSidebarResizeSession({ persist: false });

  state.sidebarResizeSession = {
    pointerId: pointerEvent.pointerId,
    startX: pointerEvent.clientX,
    startWidth: elements.sidebar.getBoundingClientRect().width
  };

  document.body.dataset.resizingSidebar = "true";
  elements.sidebarResizeHandle.setPointerCapture(pointerEvent.pointerId);
}

function handleSidebarResize(pointerEvent) {
  if (!state.sidebarResizeSession || pointerEvent.pointerId !== state.sidebarResizeSession.pointerId) {
    return;
  }

  const delta = state.sidebarResizeSession.startX - pointerEvent.clientX;
  updateSidebarWidth(state.sidebarResizeSession.startWidth + delta, { persist: false });
}

function stopSidebarResize(pointerEvent) {
  if (!state.sidebarResizeSession) {
    return;
  }

  const { pointerId } = state.sidebarResizeSession;

  if (typeof pointerEvent?.pointerId === "number" && pointerEvent.pointerId !== pointerId) {
    return;
  }

  if (typeof pointerEvent?.clientX === "number") {
    handleSidebarResize(pointerEvent);
  }

  clearSidebarResizeSession({ pointerId });
}

function handleSidebarResizeLostCapture(pointerEvent) {
  if (!state.sidebarResizeSession || pointerEvent.pointerId !== state.sidebarResizeSession.pointerId) {
    return;
  }

  clearSidebarResizeSession({ pointerId: pointerEvent.pointerId });
}

function handleSidebarResizeKeydown(event) {
  if (!state.preferences.sidebarOpen || window.innerWidth <= 980) {
    return;
  }

  const currentWidth = getEffectiveSidebarWidth();
  const step = event.shiftKey ? 40 : 20;

  if (event.key === "ArrowLeft") {
    event.preventDefault();
    updateSidebarWidth(currentWidth + step);
    return;
  }

  if (event.key === "ArrowRight") {
    event.preventDefault();
    updateSidebarWidth(currentWidth - step);
  }
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
  renderThemeOptions();
  syncThemeSelectShell();

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

  elements.sidebarResizeHandle.addEventListener("pointerdown", startSidebarResize);
  elements.sidebarResizeHandle.addEventListener("pointermove", handleSidebarResize);
  elements.sidebarResizeHandle.addEventListener("pointerup", stopSidebarResize);
  elements.sidebarResizeHandle.addEventListener("pointercancel", stopSidebarResize);
  elements.sidebarResizeHandle.addEventListener("lostpointercapture", handleSidebarResizeLostCapture);
  elements.sidebarResizeHandle.addEventListener("keydown", handleSidebarResizeKeydown);

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

  elements.readerContent.addEventListener("scroll", () => {
    updateReaderScrollState();
  });

  elements.toggleSettingsButton.addEventListener("click", () => {
    elements.settingsPanel.hidden = !elements.settingsPanel.hidden;
    syncSettingsButton();
    requestAnimationFrame(() => {
      syncAllRangeControls();
      updateReaderScrollState();
    });
  });

  elements.themeSelect.addEventListener("change", (event) => {
    state.preferences.theme = event.target.value;
    applyPreferences();
    savePreferences();
  });

  elements.themeSelectTrigger.addEventListener("click", () => {
    const isOpen = elements.themeSelectShell.dataset.themeMenuOpen === "true";

    if (isOpen) {
      closeThemeMenu();
      return;
    }

    openThemeMenu();
  });

  elements.themeSelectTrigger.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openThemeMenu();
      return;
    }

    if (event.key === "Escape") {
      closeThemeMenu();
    }
  });

  elements.themeSelectMenu.addEventListener("click", (event) => {
    const optionButton = event.target.closest(".theme-option");

    if (!optionButton) {
      return;
    }

    if (elements.themeSelect.value !== optionButton.dataset.value) {
      elements.themeSelect.value = optionButton.dataset.value;
      elements.themeSelect.dispatchEvent(new Event("change", { bubbles: true }));
    }

    closeThemeMenu({ restoreFocus: true });
  });

  elements.themeSelectMenu.addEventListener("keydown", handleThemeMenuKeydown);

  document.addEventListener("pointerdown", (event) => {
    if (elements.themeSelectShell.dataset.themeMenuOpen !== "true") {
      return;
    }

    if (elements.themeSelectShell.contains(event.target)) {
      return;
    }

    closeThemeMenu();
  });

  elements.fontSizeInput.addEventListener("input", (event) => {
    state.preferences.fontSize = Number(event.target.value);
    setRangeBubbleActive(elements.fontSizeInput, true);
    syncRangeControl(elements.fontSizeInput, elements.fontSizeValue);
    applyPreferences();
    savePreferences();
    setRangeBubbleActive(elements.fontSizeInput, false, RANGE_BUBBLE_IDLE_DELAY_MS);
  });

  elements.readerWidthInput.addEventListener("input", (event) => {
    state.preferences.readerWidth = Number(event.target.value);
    setRangeBubbleActive(elements.readerWidthInput, true);
    syncRangeControl(elements.readerWidthInput, elements.readerWidthValue);
    applyPreferences();
    savePreferences();
    setRangeBubbleActive(elements.readerWidthInput, false, RANGE_BUBBLE_IDLE_DELAY_MS);
  });

  for (const input of [elements.fontSizeInput, elements.readerWidthInput]) {
    input.addEventListener("pointerdown", () => {
      setRangeBubbleActive(input, true);
    });

    input.addEventListener("focus", () => {
      setRangeBubbleActive(input, true);
    });

    input.addEventListener("pointerup", () => {
      setRangeBubbleActive(input, false, RANGE_BUBBLE_IDLE_DELAY_MS);
    });

    input.addEventListener("pointercancel", () => {
      setRangeBubbleActive(input, false, RANGE_BUBBLE_IDLE_DELAY_MS);
    });

    input.addEventListener("blur", () => {
      setRangeBubbleActive(input, false, 180);
    });
  }

  elements.markdownContent.addEventListener("click", handleMarkdownClick);

  if (typeof ResizeObserver !== "undefined") {
    const rangeLayoutObserver = new ResizeObserver(() => {
      syncAllRangeControls();
    });

    rangeLayoutObserver.observe(elements.settingsPanel);
    rangeLayoutObserver.observe(elements.fontSizeInput);
    rangeLayoutObserver.observe(elements.readerWidthInput);
  }
}

async function initialize() {
  try {
    applyPreferences();
    toggleAdvancedPanel(false);
    setSourceInfo();
    updateEmptyState();
    renderFileList();
    bindEvents();
    syncSettingsButton();
    updateReaderScrollState();
    requestAnimationFrame(() => {
      syncAllRangeControls();
    });

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

window.addEventListener("resize", () => {
  if (state.sidebarResizeSession) {
    clearSidebarResizeSession();
  }

  applyPreferences();
  updateReaderScrollState();
});

window.addEventListener("blur", () => {
  if (state.sidebarResizeSession) {
    clearSidebarResizeSession();
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden && state.sidebarResizeSession) {
    clearSidebarResizeSession();
  }
});

void initialize();
