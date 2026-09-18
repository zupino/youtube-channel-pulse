const ROOT_ID = "yt-channel-pulse-root";
const PANEL_ID = "yt-channel-pulse-panel";
let activeVideoId = null;
let renderTimer = null;

document.addEventListener("yt-navigate-finish", scheduleRender);
window.addEventListener("popstate", scheduleRender);

const pageObserver = new MutationObserver(() => {
  if (!document.getElementById(ROOT_ID) && getVideoId()) scheduleRender();
});
pageObserver.observe(document.documentElement, { childList: true, subtree: true });

scheduleRender();

function scheduleRender() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(renderPulse, 350);
}

async function renderPulse() {
  const videoId = getVideoId();
  if (!videoId) return removeExisting();

  const mount = await waitForMount();
  if (!mount || videoId !== getVideoId()) return;

  const existing = document.getElementById(ROOT_ID);
  if (existing && activeVideoId === videoId) return;
  removeExisting();
  activeVideoId = videoId;

  const root = createRoot();
  mount.append(root);
  setCompact(root, "Loading pulse…", "loading");

  let response;
  try {
    response = await chrome.runtime.sendMessage({ type: "GET_PULSE", videoId });
  } catch (_) {
    response = { ok: false, error: { code: "UNKNOWN", message: "Channel Pulse could not load." } };
  }

  if (videoId !== getVideoId() || !root.isConnected) return;
  if (!response?.ok) return renderError(root, response?.error);
  renderData(root, response.pulse);
}

function createRoot() {
  const root = document.createElement("span");
  root.id = ROOT_ID;

  const button = document.createElement("button");
  button.className = "ytcp-pill";
  button.type = "button";
  button.setAttribute("aria-expanded", "false");
  button.setAttribute("aria-label", "Open 30-day channel pulse");

  const dot = document.createElement("span");
  dot.className = "ytcp-dot";
  const label = document.createElement("span");
  label.className = "ytcp-label";
  button.append(dot, label);

  const panel = document.createElement("section");
  panel.id = PANEL_ID;
  panel.className = "ytcp-panel";
  panel.hidden = true;
  panel.setAttribute("aria-label", "30-day channel pulse details");
  button.setAttribute("aria-controls", PANEL_ID);

  panel.append(
    element("div", "ytcp-eyebrow", "CHANNEL PULSE"),
    element("p", "ytcp-note ytcp-note-prominent", "Loading channel activity…")
  );

  let closeTimer;
  const openPanel = () => {
    clearTimeout(closeTimer);
    setPanelOpen(button, panel, true);
  };
  const closePanel = () => {
    clearTimeout(closeTimer);
    setPanelOpen(button, panel, false);
  };
  const scheduleClose = () => {
    clearTimeout(closeTimer);
    closeTimer = setTimeout(closePanel, 180);
  };

  button.addEventListener("click", (event) => {
    event.stopPropagation();
    panel.hidden ? openPanel() : closePanel();
  });
  button.addEventListener("mouseenter", openPanel);
  button.addEventListener("mouseleave", scheduleClose);
  panel.addEventListener("mouseenter", () => clearTimeout(closeTimer));
  panel.addEventListener("mouseleave", scheduleClose);

  const signal = rootAbortSignal(root, () => panel.remove());
  document.addEventListener("click", (event) => {
    if (!root.contains(event.target) && !panel.contains(event.target)) closePanel();
  }, { signal });
  window.addEventListener("resize", () => {
    if (!panel.hidden) positionPanel(button, panel);
  }, { signal });
  window.addEventListener("scroll", () => {
    if (!panel.hidden) positionPanel(button, panel);
  }, { signal, capture: true, passive: true });

  root.dataset.panelId = PANEL_ID;
  root.append(button);
  document.body.append(panel);
  return root;
}

function renderData(root, pulse) {
  const activityClass = pulse.activity.toLowerCase();
  setCompact(root, `${pulse.activity} · ${pulse.uploads30d} upload${pulse.uploads30d === 1 ? "" : "s"}/30d`, activityClass);

  const panel = getPanel(root);
  if (!panel) return;
  panel.replaceChildren();
  panel.append(
    element("div", "ytcp-eyebrow", "CHANNEL PULSE"),
    element("h3", "ytcp-title", "Last 30 days"),
    metricGrid([
      ["Uploads", pulse.capped ? `${pulse.uploads30d}+` : formatNumber(pulse.uploads30d)],
      ["Recent views", formatNumber(pulse.totalRecentVideoViews)],
      ["Median / video", formatNumber(pulse.medianRecentVideoViews)],
      ["Engagement", formatPercent(pulse.engagementRate)]
    ])
  );

  if (pulse.reachRatio !== null) {
    const reach = document.createElement("div");
    reach.className = "ytcp-reach";
    const reachCopy = element("div", "ytcp-reach-copy", "Median reach vs subscribers");
    const reachValue = element("strong", "ytcp-reach-value", formatPercent(pulse.reachRatio));
    const track = document.createElement("div");
    track.className = "ytcp-track";
    const fill = document.createElement("span");
    fill.style.width = `${Math.min(100, Math.max(2, pulse.reachRatio * 100))}%`;
    track.append(fill);
    reach.append(reachCopy, reachValue, track);
    panel.append(reach);
  }

  panel.append(
    element("p", "ytcp-note", "Recent views are current views on videos published in this period—not unique viewers or views gained across the full channel."),
    element("p", "ytcp-updated", `${pulse.cached ? "Cached" : "Updated"} ${relativeTime(pulse.calculatedAt)}`)
  );
}

function renderError(root, error = {}) {
  const needsKey = error.code === "NO_API_KEY";
  setCompact(root, needsKey ? "Add channel pulse" : "Pulse unavailable", "error");
  const panel = getPanel(root);
  if (!panel) return;
  panel.replaceChildren(
    element("div", "ytcp-eyebrow", "CHANNEL PULSE"),
    element("h3", "ytcp-title", needsKey ? "One-minute setup" : "Couldn’t load data"),
    element("p", "ytcp-note ytcp-note-prominent", error.message || "Try again in a moment.")
  );

  const settings = element("button", "ytcp-settings", needsKey ? "Add YouTube API key" : "Open settings");
  settings.type = "button";
  settings.addEventListener("click", () => chrome.runtime.sendMessage({ type: "OPEN_OPTIONS" }));
  panel.append(settings);
}

function setCompact(root, text, state) {
  root.querySelector(".ytcp-label").textContent = text;
  root.querySelector(".ytcp-pill").dataset.state = state;
}

function getPanel(root) {
  return document.getElementById(root.dataset.panelId || PANEL_ID);
}

function setPanelOpen(button, panel, open) {
  panel.hidden = !open;
  button.setAttribute("aria-expanded", String(open));
  if (open) {
    panel.style.visibility = "hidden";
    positionPanel(button, panel);
    panel.style.visibility = "visible";
  }
}

function positionPanel(button, panel) {
  const rect = button.getBoundingClientRect();
  const gap = 8;
  const edge = 8;
  const width = panel.offsetWidth || 292;
  const height = panel.offsetHeight || 260;
  const left = Math.min(Math.max(edge, rect.left), Math.max(edge, window.innerWidth - width - edge));
  let top = rect.bottom + gap;
  if (top + height > window.innerHeight - edge) {
    top = Math.max(edge, rect.top - height - gap);
  }
  panel.style.left = `${Math.round(left)}px`;
  panel.style.top = `${Math.round(top)}px`;
}

function metricGrid(metrics) {
  const grid = document.createElement("div");
  grid.className = "ytcp-grid";
  for (const [label, value] of metrics) {
    const metric = document.createElement("div");
    metric.className = "ytcp-metric";
    metric.append(element("strong", "", value), element("span", "", label));
    grid.append(metric);
  }
  return grid;
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = text;
  return node;
}

function getVideoId() {
  const id = new URL(location.href).searchParams.get("v");
  return /^[\w-]{11}$/.test(id || "") ? id : null;
}

async function waitForMount() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    // Mount on the owner row rather than inside YouTube's truncated text block;
    // this keeps the popover visible and places the pill after subscriber text.
    const mount = document.querySelector("ytd-video-owner-renderer #owner")
      || document.querySelector("ytd-video-owner-renderer #upload-info");
    if (mount) return mount;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return null;
}

function removeExisting() {
  const root = document.getElementById(ROOT_ID);
  getPanel(root || { dataset: {} })?.remove();
  root?.remove();
  activeVideoId = null;
}

function formatNumber(value) {
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value || 0);
}

function formatPercent(value) {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat(undefined, { style: "percent", maximumFractionDigits: 1 }).format(value);
}

function relativeTime(isoDate) {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(isoDate).getTime()) / 1000));
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

function rootAbortSignal(root, cleanup) {
  const controller = new AbortController();
  let hasConnected = root.isConnected;
  const observer = new MutationObserver(() => {
    if (root.isConnected) {
      hasConnected = true;
      return;
    }
    if (hasConnected) {
      cleanup?.();
      controller.abort();
      observer.disconnect();
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  return controller.signal;
}
