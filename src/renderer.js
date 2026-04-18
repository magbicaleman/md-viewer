const STORAGE_KEY = "md-viewer-preferences";
const DEFAULT_FONT_SIZE = 18;
const DEFAULT_SIDEBAR_WIDTH = 336;
const MIN_SIDEBAR_WIDTH = 300;
const MAX_SIDEBAR_WIDTH = 560;
const RANGE_BUBBLE_IDLE_DELAY_MS = 1400;
const LINK_PREVIEW_OFFSET_PX = 18;
const SIDEBAR_DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit"
});

const state = {
  sourceKind: null,
  rootPath: null,
  entries: [],
  currentPath: null,
  filterText: "",
  preferences: loadPreferences(),
  sidebarResizeSession: null,
  rangeBubbleTimeouts: new Map(),
  preferenceSaveCount: 0,
  auditDemo: {
    workspacePath: null,
    paths: null,
    results: []
  }
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
  openAuditDemosButton: document.querySelector("#openAuditDemosButton"),
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
  linkPreview: document.querySelector("#linkPreview"),
  linkPreviewIconPath: document.querySelector("#linkPreviewIconPath"),
  linkPreviewKind: document.querySelector("#linkPreviewKind"),
  linkPreviewSize: document.querySelector("#linkPreviewSize"),
  linkPreviewValue: document.querySelector("#linkPreviewValue"),
  linkPreviewFooter: document.querySelector("#linkPreviewFooter"),
  linkPreviewHint: document.querySelector("#linkPreviewHint"),
  emptyState: document.querySelector("#emptyState"),
  statusBanner: document.querySelector("#statusBanner"),
  auditPanel: document.querySelector("#auditPanel"),
  auditPanelSummary: document.querySelector("#auditPanelSummary"),
  auditSymlinkButton: document.querySelector("#auditSymlinkButton"),
  auditBridgeButton: document.querySelector("#auditBridgeButton"),
  auditFolderPerfButton: document.querySelector("#auditFolderPerfButton"),
  auditLargeDocButton: document.querySelector("#auditLargeDocButton"),
  auditUiStressButton: document.querySelector("#auditUiStressButton"),
  auditResults: document.querySelector("#auditResults"),
  toggleSettingsButton: document.querySelector("#toggleSettingsButton"),
  settingsPanel: document.querySelector("#settingsPanel"),
  pathDisplayControl: document.querySelector("#pathDisplayControl"),
  pathDisplayPrivateButton: document.querySelector("#pathDisplayPrivateButton"),
  pathDisplayFullButton: document.querySelector("#pathDisplayFullButton"),
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
      fontSize: Number(stored.fontSize ?? DEFAULT_FONT_SIZE),
      readerWidth: normalizeReaderWidth(stored.readerWidth ?? 82),
      pathDisplayMode: stored.pathDisplayMode === "private" ? "private" : "full",
      sidebarWidth: normalizeSidebarWidth(stored.sidebarWidth ?? DEFAULT_SIDEBAR_WIDTH),
      sidebarOpen: stored.sidebarOpen ?? true
    };
  } catch {
    return {
      theme: "paper",
      fontSize: DEFAULT_FONT_SIZE,
      readerWidth: 82,
      pathDisplayMode: "full",
      sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
      sidebarOpen: true
    };
  }
}

function savePreferences() {
  state.preferenceSaveCount += 1;
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
  const isFontSizeControl = input.id === "fontSizeInput";
  const displayValue = isFontSizeControl
    ? String(Math.round((value / DEFAULT_FONT_SIZE) * 100))
    : (Number.isInteger(value) ? String(value) : value.toFixed(0));
  const shell = valueOutput.closest(".range-shell");
  const displaySuffix = isFontSizeControl || input.id === "readerWidthInput" ? "%" : "";

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
  for (const button of [elements.pathDisplayPrivateButton, elements.pathDisplayFullButton]) {
    if (!button) {
      continue;
    }

    const isSelected = button.dataset.value === state.preferences.pathDisplayMode;
    button.dataset.selected = String(isSelected);
    button.setAttribute("aria-pressed", String(isSelected));
  }
  syncThemeSelectShell();
  syncAllRangeControls();
  setSourceInfo();
  updateBlockedResourceNotes();
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
  syncAuditPanel();
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

function reportBackgroundError(error, fallbackMessage) {
  console.warn(fallbackMessage, error);
}

function normalizeUiPath(value = "") {
  return value.replaceAll("\\", "/");
}

function formatRootPath(rootPath) {
  if (!rootPath) {
    return "No source selected";
  }

  if (state.preferences.pathDisplayMode !== "private") {
    return rootPath;
  }

  const normalizedPath = normalizeUiPath(rootPath);
  const windowsDriveMatch = normalizedPath.match(/^([A-Za-z]:)(\/.*)?$/);
  const drivePrefix = windowsDriveMatch ? `${windowsDriveMatch[1]}/` : "";
  const pathWithoutPrefix = windowsDriveMatch
    ? (windowsDriveMatch[2] ?? "")
    : (normalizedPath.startsWith("/") ? normalizedPath.slice(1) : normalizedPath);
  const segments = pathWithoutPrefix.split("/").filter(Boolean);

  if (segments.length <= 3) {
    return normalizedPath;
  }

  const visibleSegments = segments.slice(-3).join("/");

  if (drivePrefix) {
    return `${drivePrefix}.../${visibleSegments}`;
  }

  return `.../${visibleSegments}`;
}

function formatBlockedRootPath(rootPath) {
  const formatted = formatRootPath(rootPath);
  return formatted === "No source selected" ? "the opened folder" : formatted;
}

function getBlockedResourceMessage(note) {
  const blockedType = note.dataset.blockedType;
  const blockedTarget = note.dataset.blockedTarget || "[unknown path]";
  const blockedRoot = formatBlockedRootPath(note.dataset.blockedRoot || "");

  if (blockedType === "image") {
    return `[image blocked: tries to open ${blockedTarget}, which is outside the folder you opened (${blockedRoot})]`;
  }

  const blockedLabel = note.dataset.blockedLabel || "Link";
  return `${blockedLabel} [blocked: tries to open ${blockedTarget}, which is outside the folder you opened (${blockedRoot})]`;
}

function updateBlockedResourceNotes() {
  for (const note of elements.markdownContent.querySelectorAll(".md-inline-note[data-blocked-type]")) {
    note.textContent = getBlockedResourceMessage(note);
  }
}

function getBridge() {
  if (!window.mdViewer) {
    throw new Error("The Electron preload bridge did not load.");
  }

  return window.mdViewer;
}

function isPathWithin(rootPath, targetPath) {
  if (!rootPath || !targetPath) {
    return false;
  }

  const normalizedRoot = normalizeEntryPath(rootPath).replace(/\/$/, "");
  const normalizedTarget = normalizeEntryPath(targetPath);

  return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}/`);
}

function formatDurationMs(durationMs) {
  return `${durationMs.toFixed(durationMs >= 100 ? 0 : 1)} ms`;
}

function setAuditDemoPaths(paths) {
  if (!paths?.workspacePath) {
    return;
  }

  state.auditDemo.workspacePath = paths.workspacePath;
  state.auditDemo.paths = paths;
}

function isAuditDemoActive() {
  const workspacePath = state.auditDemo.workspacePath;

  return isPathWithin(workspacePath, state.rootPath) || isPathWithin(workspacePath, state.currentPath);
}

function renderAuditResults() {
  if (!elements.auditResults) {
    return;
  }

  elements.auditResults.innerHTML = "";

  for (const result of state.auditDemo.results) {
    const card = document.createElement("article");
    card.className = "audit-result";
    card.dataset.kind = result.kind ?? "info";

    const title = document.createElement("p");
    title.className = "audit-result-title";
    title.textContent = result.title;
    card.append(title);

    const body = document.createElement("p");
    body.className = "audit-result-body";
    body.textContent = result.body;
    card.append(body);

    elements.auditResults.append(card);
  }
}

function addAuditResult(title, body, kind = "info") {
  state.auditDemo.results = [{ title, body, kind }, ...state.auditDemo.results].slice(0, 6);
  renderAuditResults();
}

function syncAuditPanel() {
  const active = isAuditDemoActive();

  if (!elements.auditPanel || !elements.auditPanelSummary) {
    return;
  }

  elements.auditPanel.hidden = !active;

  if (!active) {
    return;
  }

  const currentPath = state.currentPath ? normalizeEntryPath(state.currentPath) : "";

  if (currentPath.endsWith("/01-symlink-escape/inside/open-me.md")) {
    elements.auditPanelSummary.textContent =
      "Click the escape link in the document, or rerun the Symlink Escape button. The correct behavior is that the app blocks it because the real destination lives outside the opened folder.";
    return;
  }

  if (currentPath.endsWith("/02-renderer-authority/inside/open-me.md")) {
    elements.auditPanelSummary.textContent =
      "Bridge Escape simulates a compromised renderer calling the preload bridge directly and reading paths outside the folder the user opened.";
    return;
  }

  if (currentPath.endsWith("/04-large-document/large.md")) {
    elements.auditPanelSummary.textContent =
      "Large Document measures full-file read plus markdown parse time before the content is pushed into the DOM.";
    return;
  }

  if (state.rootPath && state.auditDemo.paths?.folderBenchmark?.rootPath === state.rootPath) {
    elements.auditPanelSummary.textContent =
      "Folder Scan and UI Stress are most meaningful here because the sidebar is holding the generated large index.";
    return;
  }

  elements.auditPanelSummary.textContent =
    "Use these buttons to jump to each repro and see the effect in the running app instead of reading it as a static review note.";
}

async function openAuditDemoWorkspace() {
  const { target, paths } = await getBridge().openAuditDemos();
  setAuditDemoPaths(paths);
  state.auditDemo.results = [];
  renderAuditResults();
  await loadTarget(target);
  addAuditResult(
    "Audit demos ready",
    `Generated a temporary demo workspace at ${paths.workspacePath}. Use the panel buttons to run each repro inside the app.`,
    "success"
  );
}

async function openAuditSymlinkDemo() {
  const paths = state.auditDemo.paths ?? await getBridge().getAuditDemoPaths();
  setAuditDemoPaths(paths);

  const target = await getBridge().inspectPath(paths.symlinkDemo.startFile);
  await loadTarget(target);
  addAuditResult(
    "Symlink escape",
    "The document now links to a symlink inside the opened folder. Click the escape link in the note. The correct behavior is that the app blocks it because the real destination lives outside the opened folder.",
    "success"
  );
}

async function runAuditBridgeEscapeDemo() {
  const paths = state.auditDemo.paths ?? await getBridge().getAuditDemoPaths();
  setAuditDemoPaths(paths);

  const insideTarget = await getBridge().inspectPath(paths.authorityDemo.startFile);
  await loadTarget(insideTarget);

  const folderStart = performance.now();
  const inspectedOutsideFolder = await getBridge().inspectPath(paths.authorityDemo.outsideFolder);
  const folderEnd = performance.now();
  const fileStart = performance.now();
  const outsideFile = await getBridge().readMarkdownFile(paths.authorityDemo.outsideFile);
  const fileEnd = performance.now();

  addAuditResult(
    "Bridge escape",
    [
      "This button simulates a malicious script already running in the renderer.",
      `Outside folder inspect: ${inspectedOutsideFolder?.kind ?? "error"} in ${formatDurationMs(folderEnd - folderStart)}.`,
      `Outside markdown read: ${outsideFile.name} (${formatFileSize(outsideFile.sizeBytes) || "unknown size"}) in ${formatDurationMs(fileEnd - fileStart)}.`,
      "Both succeeded even though the visible root for the demo is the inside folder only."
    ].join("\n"),
    "warning"
  );
}

async function runAuditFolderBenchmark() {
  const paths = state.auditDemo.paths ?? await getBridge().getAuditDemoPaths();
  setAuditDemoPaths(paths);

  const inspectStart = performance.now();
  const target = await getBridge().inspectPath(paths.folderBenchmark.rootPath);
  const inspectEnd = performance.now();
  const loadStart = performance.now();
  await loadTarget(target);
  const loadEnd = performance.now();

  addAuditResult(
    "Folder scan benchmark",
    [
      `Indexed ${target.entries.length} markdown files.`,
      `Main-process scan via inspectPath(): ${formatDurationMs(inspectEnd - inspectStart)}.`,
      `Total load into sidebar + first document open: ${formatDurationMs(loadEnd - loadStart)}.`,
      "This cost currently runs on the main process."
    ].join("\n"),
    "warning"
  );
}

async function runAuditLargeDocumentDemo() {
  const paths = state.auditDemo.paths ?? await getBridge().getAuditDemoPaths();
  setAuditDemoPaths(paths);

  const readStart = performance.now();
  const file = await getBridge().readMarkdownFile(paths.largeDocument.filePath);
  const readEnd = performance.now();
  const renderStart = performance.now();
  const html = await getBridge().renderMarkdown(file.content, file.absolutePath, paths.largeDocument.rootPath);
  const renderEnd = performance.now();

  await loadTarget(await getBridge().inspectPath(paths.largeDocument.filePath));

  addAuditResult(
    "Large document benchmark",
    [
      `Read ${formatFileSize(file.sizeBytes) || `${file.content.length} chars`} in ${formatDurationMs(readEnd - readStart)}.`,
      `Markdown render produced ${formatFileSize(html.length) || `${html.length} chars`} in ${formatDurationMs(renderEnd - renderStart)}.`,
      "The file is fully read and parsed before the renderer receives the HTML."
    ].join("\n"),
    "warning"
  );
}

async function runAuditUiStressDemo() {
  const paths = state.auditDemo.paths ?? await getBridge().getAuditDemoPaths();
  setAuditDemoPaths(paths);

  if (state.rootPath !== paths.folderBenchmark.rootPath) {
    await runAuditFolderBenchmark();
  }

  const originalPreferences = { ...state.preferences };
  const startSaves = state.preferenceSaveCount;
  const sliderStart = performance.now();

  for (let step = 0; step < 28; step += 1) {
    const nextValue = 55 + (step % 46);
    elements.readerWidthInput.value = String(nextValue);
    elements.readerWidthInput.dispatchEvent(new Event("input", { bubbles: true }));
  }

  const sliderEnd = performance.now();

  const renderStart = performance.now();
  renderFileList();
  renderFileList();
  const renderEnd = performance.now();

  state.preferences = originalPreferences;
  applyPreferences();
  savePreferences();

  const preferenceWrites = Math.max(0, state.preferenceSaveCount - startSaves - 1);

  addAuditResult(
    "UI stress",
    [
      `Programmatic slider drag: ${formatDurationMs(sliderEnd - sliderStart)}.`,
      `Synchronous preference saves triggered during the drag: ${preferenceWrites}.`,
      `Two full sidebar rerenders on the large index: ${formatDurationMs(renderEnd - renderStart)}.`,
      "This showcases the current synchronous localStorage writes and full-list rerender strategy."
    ].join("\n"),
    "warning"
  );
}

function setSourceInfo() {
  elements.rootLabel.textContent = formatRootPath(state.rootPath);
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

function resetDocumentState() {
  hideLinkPreview();
  state.currentPath = null;
  elements.titlebarDocumentName.textContent = "No document loaded";
  elements.markdownContent.innerHTML = "";
  updateEmptyState();
  renderFileList();
  syncAuditPanel();
  void getBridge().clearWatchContext().catch((error) => {
    reportBackgroundError(error, "Unable to clear the auto-refresh watcher.");
  });
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

function formatEntryModifiedAt(modifiedAt) {
  if (!modifiedAt) {
    return "";
  }

  const date = new Date(modifiedAt);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return `Edited ${SIDEBAR_DATE_FORMATTER.format(date)}`;
}

function formatFileSize(sizeBytes) {
  const numericValue = Number(sizeBytes);

  if (!Number.isFinite(numericValue) || numericValue < 0) {
    return "";
  }

  if (numericValue < 1024) {
    return `${numericValue} B`;
  }

  const units = ["KB", "MB", "GB"];
  let value = numericValue / 1024;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const precision = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(precision)} ${units[unitIndex]}`;
}

function formatEntryMeta(entry) {
  const metadata = [];
  const fileSize = formatFileSize(entry?.sizeBytes);
  const modifiedLabel = formatEntryModifiedAt(entry?.modifiedAt);

  if (fileSize) {
    metadata.push(fileSize);
  }

  if (modifiedLabel) {
    metadata.push(modifiedLabel);
  }

  return metadata.join(" • ");
}

function normalizeEntryPath(value) {
  return value.split(/[/\\]+/).join("/");
}

function isMacPlatform() {
  const platform = navigator.userAgentData?.platform ?? navigator.platform ?? "";
  return /mac|iphone|ipad|ipod/i.test(platform);
}

function isWindowsPlatform() {
  const platform = navigator.userAgentData?.platform ?? navigator.platform ?? "";
  return /win/i.test(platform);
}

function getRevealModifierLabel() {
  return isMacPlatform() ? "⌘" : "Ctrl";
}

function getRevealTargetLabel() {
  if (isMacPlatform()) {
    return "Finder";
  }

  if (isWindowsPlatform()) {
    return "File Explorer";
  }

  return "your file manager";
}

function isRevealModifierPressed(event) {
  return isMacPlatform() ? event.metaKey : event.ctrlKey;
}

function getRelativeEntryPath(absolutePath) {
  if (!absolutePath) {
    return "";
  }

  if (state.sourceKind !== "folder" || !state.rootPath) {
    return absolutePath.split(/[\\/]/).at(-1) ?? absolutePath;
  }

  const normalizedRootPath = normalizeEntryPath(state.rootPath).replace(/\/$/, "");
  const normalizedAbsolutePath = normalizeEntryPath(absolutePath);

  if (!normalizedAbsolutePath.startsWith(`${normalizedRootPath}/`)) {
    return normalizedAbsolutePath.split("/").at(-1) ?? normalizedAbsolutePath;
  }

  return normalizedAbsolutePath.slice(normalizedRootPath.length + 1);
}

function upsertEntry(entryUpdate) {
  const entryIndex = state.entries.findIndex((entry) => entry.absolutePath === entryUpdate.absolutePath);

  if (entryIndex === -1) {
    state.entries = [...state.entries, entryUpdate];
    return;
  }

  state.entries = state.entries.map((entry, index) => (index === entryIndex ? { ...entry, ...entryUpdate } : entry));
}

function formatLinkPreviewKind(kind) {
  switch (kind) {
    case "website":
      return "Website";
    case "email":
      return "Email";
    case "location":
    default:
      return "Location";
  }
}

function getLinkPreviewIconPath(kind) {
  switch (kind) {
    case "website":
      return "M12 3.75c4.556 0 8.25 3.694 8.25 8.25s-3.694 8.25-8.25 8.25-8.25-3.694-8.25-8.25 3.694-8.25 8.25-8.25Zm0 0c2.184 2.095 3.42 5.04 3.42 8.25s-1.236 6.155-3.42 8.25m0-16.5c-2.184 2.095-3.42 5.04-3.42 8.25s1.236 6.155 3.42 8.25M4.5 12h15";
    case "email":
      return "M4.5 7.5h15v9h-15v-9Zm0 0 7.5 5.625L19.5 7.5";
    case "location":
    default:
      return "M8.25 3.75h5.94L18.75 8.3v11.95H8.25V3.75Zm5.25 0V8.25h5.25";
  }
}

function getLinkPreviewData(anchor) {
  const destination = anchor?.dataset.linkDestination?.trim();

  if (!destination) {
    return null;
  }

  const sizeBytes = Number(anchor.dataset.linkSizeBytes);

  return {
    kind: anchor.dataset.linkKind ?? "location",
    destination,
    sizeLabel: formatFileSize(sizeBytes),
    hint: anchor.dataset.revealPath
      ? `Hold ${getRevealModifierLabel()} and click to reveal in ${getRevealTargetLabel()}.`
      : ""
  };
}

function positionLinkPreview(x, y) {
  if (!elements.linkPreview || elements.linkPreview.hidden) {
    return;
  }

  const margin = 16;
  const previewRect = elements.linkPreview.getBoundingClientRect();
  let left = x + LINK_PREVIEW_OFFSET_PX;
  let top = y + LINK_PREVIEW_OFFSET_PX;

  if (left + previewRect.width > window.innerWidth - margin) {
    left = Math.max(margin, x - previewRect.width - LINK_PREVIEW_OFFSET_PX);
  }

  if (top + previewRect.height > window.innerHeight - margin) {
    top = Math.max(margin, y - previewRect.height - LINK_PREVIEW_OFFSET_PX);
  }

  elements.linkPreview.style.left = `${left}px`;
  elements.linkPreview.style.top = `${top}px`;
}

function hideLinkPreview() {
  if (!elements.linkPreview) {
    return;
  }

  elements.linkPreview.hidden = true;
}

function showLinkPreview(anchor, position) {
  const previewData = getLinkPreviewData(anchor);

  if (
    !previewData ||
    !elements.linkPreview ||
    !elements.linkPreviewIconPath ||
    !elements.linkPreviewKind ||
    !elements.linkPreviewSize ||
    !elements.linkPreviewValue ||
    !elements.linkPreviewFooter ||
    !elements.linkPreviewHint
  ) {
    hideLinkPreview();
    return;
  }

  elements.linkPreview.dataset.kind = previewData.kind;
  elements.linkPreviewIconPath.setAttribute("d", getLinkPreviewIconPath(previewData.kind));
  elements.linkPreviewKind.textContent = formatLinkPreviewKind(previewData.kind);
  elements.linkPreviewSize.textContent = previewData.sizeLabel;
  elements.linkPreviewSize.hidden = !previewData.sizeLabel;
  elements.linkPreviewValue.textContent = previewData.destination;
  elements.linkPreviewHint.textContent = previewData.hint;
  elements.linkPreviewHint.hidden = !previewData.hint;
  elements.linkPreviewFooter.hidden = !previewData.hint;
  elements.linkPreview.hidden = false;
  positionLinkPreview(position.x, position.y);
}

function showLinkPreviewForAnchor(anchor) {
  const rect = anchor.getBoundingClientRect();
  showLinkPreview(anchor, {
    x: rect.left + rect.width / 2,
    y: rect.bottom
  });
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
    const entryMeta = formatEntryMeta(entry);

    const name = document.createElement("span");
    name.className = "file-row-name";
    name.textContent = entry.name;
    button.append(name);

    const relativePath = document.createElement("span");
    relativePath.className = "file-row-path";
    relativePath.textContent = entry.relativePath;
    button.append(relativePath);

    if (entryMeta) {
      const meta = document.createElement("span");
      meta.className = "file-row-meta";
      meta.textContent = entryMeta;
      button.append(meta);
    }

    elements.fileList.append(button);
  }
}

async function openMarkdownFile(filePath) {
  try {
    const bridge = getBridge();
    const file = await bridge.readMarkdownFile(filePath);
    const html = await bridge.renderMarkdown(file.content, file.absolutePath, state.rootPath);

    hideLinkPreview();
    state.currentPath = file.absolutePath;
    upsertEntry({
      absolutePath: file.absolutePath,
      name: file.name,
      relativePath: getRelativeEntryPath(file.absolutePath),
      modifiedAt: file.modifiedAt ?? null,
      sizeBytes: file.sizeBytes ?? null
    });
    elements.titlebarDocumentName.textContent = file.name;
    elements.markdownContent.innerHTML = html;
    updateBlockedResourceNotes();
    updateEmptyState();
    renderFileList();
    syncAuditPanel();
    showStatus("");
    await bridge.setWatchContext({
      currentPath: state.currentPath,
      rootPath: state.rootPath,
      sourceKind: state.sourceKind
    });
    requestAnimationFrame(updateReaderScrollState);
  } catch (error) {
    resetDocumentState();
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
      relativePath: filePath,
      modifiedAt: null,
      sizeBytes: null
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
  syncAuditPanel();
  requestAnimationFrame(updateReaderScrollState);

  if (target.currentPath) {
    await openMarkdownFile(target.currentPath);
  }
}

async function refreshEntriesFromDisk() {
  if (!state.rootPath || state.sourceKind !== "folder") {
    return;
  }

  const refreshedTarget = await getBridge().inspectPath(state.rootPath);

  if (refreshedTarget?.error) {
    state.entries = [];
    setSourceInfo();
    resetDocumentState();
    showStatus(refreshedTarget.error, "error");
    return;
  }

  state.entries = refreshedTarget.entries;
  setSourceInfo();
  renderFileList();

  if (state.currentPath && state.entries.some((entry) => entry.absolutePath === state.currentPath)) {
    return;
  }

  if (refreshedTarget.currentPath) {
    await openMarkdownFile(refreshedTarget.currentPath);
    return;
  }

  resetDocumentState();
}

async function handleWatchedTargetChanged(payload) {
  if (!payload || !state.currentPath || payload.currentPath !== state.currentPath) {
    if (payload?.refreshEntries && payload?.rootPath === state.rootPath && state.sourceKind === "folder") {
      try {
        await refreshEntriesFromDisk();
      } catch (error) {
        reportBackgroundError(error, "Unable to refresh the Markdown index after a filesystem change.");
      }
    }

    return;
  }

  try {
    if (payload.refreshEntries && payload.rootPath === state.rootPath && state.sourceKind === "folder") {
      await refreshEntriesFromDisk();

      if (!state.currentPath || payload.currentPath !== state.currentPath) {
        return;
      }
    }

    await openMarkdownFile(state.currentPath);
  } catch (error) {
    reportBackgroundError(error, "Unable to refresh the current Markdown document after a filesystem change.");
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

  hideLinkPreview();

  const markdownPath = anchor.dataset.mdPath;
  const revealPath = anchor.dataset.revealPath;
  const externalHref = anchor.dataset.external === "true" ? anchor.getAttribute("href") : null;

  if (markdownPath) {
    event.preventDefault();
    mergeEntryIfMissing(markdownPath);
    void openMarkdownFile(markdownPath);
    return;
  }

  if (revealPath) {
    event.preventDefault();

    if (!isRevealModifierPressed(event)) {
      showStatus(`Hold ${getRevealModifierLabel()} and click to reveal this file in ${getRevealTargetLabel()}.`);
      return;
    }

    try {
      void getBridge().showItemInFolder(revealPath);
      showStatus("");
    } catch (error) {
      reportError(error, "Unable to reveal the file in Finder or File Explorer.");
    }
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

  elements.openAuditDemosButton.addEventListener("click", async () => {
    try {
      showStatus("Preparing audit demos…");
      await openAuditDemoWorkspace();
      showStatus("");
    } catch (error) {
      reportError(error, "Unable to prepare the audit demo workspace.");
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
    hideLinkPreview();
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

  elements.pathDisplayControl.addEventListener("click", (event) => {
    const button = event.target.closest(".segmented-control-button");

    if (!button) {
      return;
    }

    const nextValue = button.dataset.value === "private" ? "private" : "full";

    if (state.preferences.pathDisplayMode === nextValue) {
      return;
    }

    state.preferences.pathDisplayMode = nextValue;
    applyPreferences();
    savePreferences();
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

  elements.auditSymlinkButton.addEventListener("click", () => {
    void openAuditSymlinkDemo().catch((error) => {
      reportError(error, "Unable to open the symlink escape demo.");
    });
  });

  elements.auditBridgeButton.addEventListener("click", () => {
    void runAuditBridgeEscapeDemo().catch((error) => {
      reportError(error, "Unable to run the bridge escape demo.");
    });
  });

  elements.auditFolderPerfButton.addEventListener("click", () => {
    void runAuditFolderBenchmark().catch((error) => {
      reportError(error, "Unable to run the folder scan benchmark.");
    });
  });

  elements.auditLargeDocButton.addEventListener("click", () => {
    void runAuditLargeDocumentDemo().catch((error) => {
      reportError(error, "Unable to run the large document benchmark.");
    });
  });

  elements.auditUiStressButton.addEventListener("click", () => {
    void runAuditUiStressDemo().catch((error) => {
      reportError(error, "Unable to run the UI stress demo.");
    });
  });

  elements.markdownContent.addEventListener("click", handleMarkdownClick);
  elements.markdownContent.addEventListener("pointerdown", (event) => {
    const anchor = event.target.closest("a");

    if (!anchor || !elements.markdownContent.contains(anchor)) {
      return;
    }

    hideLinkPreview();
  });
  elements.markdownContent.addEventListener("pointerover", (event) => {
    const anchor = event.target.closest("a");

    if (!anchor || !elements.markdownContent.contains(anchor)) {
      return;
    }

    showLinkPreview(anchor, {
      x: event.clientX,
      y: event.clientY
    });
  });
  elements.markdownContent.addEventListener("pointermove", (event) => {
    const anchor = event.target.closest("a");

    if (!anchor || !elements.markdownContent.contains(anchor)) {
      return;
    }

    showLinkPreview(anchor, {
      x: event.clientX,
      y: event.clientY
    });
  });
  elements.markdownContent.addEventListener("pointerout", (event) => {
    const anchor = event.target.closest("a");
    const relatedAnchor = event.relatedTarget instanceof Element ? event.relatedTarget.closest("a") : null;

    if (!anchor || relatedAnchor === anchor) {
      return;
    }

    hideLinkPreview();
  });
  elements.markdownContent.addEventListener("focusin", (event) => {
    const anchor = event.target.closest("a");

    if (!anchor || !elements.markdownContent.contains(anchor)) {
      return;
    }

    if (typeof anchor.matches === "function" && !anchor.matches(":focus-visible")) {
      return;
    }

    showLinkPreviewForAnchor(anchor);
  });
  elements.markdownContent.addEventListener("focusout", (event) => {
    const anchor = event.target.closest("a");
    const relatedAnchor = event.relatedTarget instanceof Element ? event.relatedTarget.closest("a") : null;

    if (!anchor || relatedAnchor === anchor) {
      return;
    }

    hideLinkPreview();
  });

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

    bridge.onWatchedTargetChanged((payload) => {
      void handleWatchedTargetChanged(payload);
    });
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
  hideLinkPreview();

  if (state.sidebarResizeSession) {
    clearSidebarResizeSession();
  }

  applyPreferences();
  updateReaderScrollState();
});

window.addEventListener("blur", () => {
  hideLinkPreview();

  if (state.sidebarResizeSession) {
    clearSidebarResizeSession();
  }
});

window.addEventListener("focus", () => {
  hideLinkPreview();
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    hideLinkPreview();
  }

  if (document.hidden && state.sidebarResizeSession) {
    clearSidebarResizeSession();
  }
});

void initialize();
