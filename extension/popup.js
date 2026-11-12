"use strict";

const list = document.getElementById("moves");
const empty = document.getElementById("empty");
const template = document.getElementById("move-template");
const status = document.getElementById("status");
const scan = document.getElementById("scan");
const manage = document.getElementById("manage");
let pending = false;
let revision = 0;
let refreshTimer;

function elapsed(timestamp) {
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return minutes + " min ago";
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours + " hr ago";
  const days = Math.floor(hours / 24);
  return days + (days === 1 ? " day ago" : " days ago");
}

function focusInList() {
  const button = document.activeElement;
  const row = button.closest(".move");
  if (!row) return null;
  return { id: row.dataset.id, index: Array.from(list.children).indexOf(row), undo: button.classList.contains("undo") };
}

function restoreFocus(previous) {
  if (!previous) return;
  const rows = Array.from(list.children);
  const row = rows.find(item => item.dataset.id === previous.id);
  const button = row?.querySelector(previous.undo ? ".undo:enabled" : ".tab-title:enabled");
  if (button) {
    button.focus();
    return;
  }
  // Undo removes a row. Keep keyboard users near the move they just handled.
  const neighbor = rows[Math.min(previous.index, rows.length - 1)];
  const next = row?.querySelector(".tab-title:enabled") || neighbor?.querySelector(".tab-title:enabled");
  (next || (rows.length ? scan : empty)).focus();
}

function buildRow(move) {
  const row = template.content.firstElementChild.cloneNode(true);
  row.dataset.id = move.id;
  const title = move.title || "Untitled tab";
  const show = row.querySelector(".tab-title");
  show.textContent = title;
  show.title = title;
  show.setAttribute("aria-label", "Show " + title);
  show.disabled = !move.available;
  const undo = row.querySelector(".undo");
  undo.disabled = !move.canUndo;
  undo.setAttribute("aria-label", "Undo move of " + title);
  const group = row.querySelector(".group");
  group.textContent = move.group;
  group.dataset.color = move.color || "";
  row.querySelector(".where").textContent = move.crossWindow ? "Moved across windows" : "Same window";
  const time = row.querySelector("time");
  time.dateTime = new Date(move.movedAt).toISOString();
  time.textContent = elapsed(move.movedAt);
  time.title = new Date(move.movedAt).toLocaleString();
  if (!move.canUndo || !move.available) {
    const hint = row.querySelector(".undo-hint");
    hint.textContent = move.undoHint || (move.available ? "This move can no longer be undone." : "This tab is no longer open.");
    hint.hidden = false;
    undo.title = hint.textContent;
  }
  return row;
}

async function send(type, id) {
  const message = { type, id };
  if (type === "undoMove") message.windowId = (await chrome.windows.getCurrent()).id;
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.message || "Couldn’t reach the extension. Try again.");
  return response;
}

async function refresh() {
  const request = ++revision;
  const result = await send("getRecentMoves");
  if (request !== revision) return;
  const previous = focusInList();
  const rows = result.moves.slice(0, 5).map(buildRow);
  const hasRules = result.ruleCount > 0;
  document.getElementById("heading").hidden = !hasRules && !rows.length;
  document.getElementById("empty-title").textContent = hasRules ? "No recent moves" : "Choose what belongs together";
  document.getElementById("empty-detail").textContent = hasRules
    ? "Tabs appear here as Tab Porter groups them."
    : "Start with a site, a title phrase, or an advanced rule.";
  manage.textContent = hasRules ? "Manage groups" : "Create your first group";
  scan.hidden = !hasRules;
  list.replaceChildren(...rows);
  list.hidden = !rows.length;
  empty.hidden = Boolean(rows.length);
  restoreFocus(previous);
}

function report(error) {
  status.textContent = error.message || "Something went wrong. Try again.";
}

async function act(type, id) {
  if (pending) return;
  pending = true;
  revision++;
  scan.setAttribute("aria-disabled", "true");
  status.textContent = type === "scanTabs" ? "Sorting background tabs…" : "";
  try {
    const result = await send(type, id);
    if (type === "showMovedTab") {
      window.close();
      return;
    }
    status.textContent = result.message || (type === "undoMove" ? "Move undone." : "Scan complete.");
  } catch (error) {
    report(error);
  } finally {
    pending = false;
    scan.removeAttribute("aria-disabled");
  }
  refresh().catch(report);
}

list.addEventListener("click", event => {
  const button = event.target.closest("button");
  if (!button || button.disabled) return;
  const id = button.closest(".move").dataset.id;
  act(button.classList.contains("undo") ? "undoMove" : "showMovedTab", id);
});
scan.addEventListener("click", () => act("scanTabs"));
manage.addEventListener("click", () => {
  chrome.runtime.openOptionsPage().then(() => window.close()).catch(report);
});
function scheduleRefresh() {
  if (pending) return;
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    if (!pending) refresh().catch(report);
  }, 80);
}
chrome.storage.onChanged.addListener((changes, area) => {
  if ((area === "session" && changes.recentMoves) || (area === "local" && changes.groupRules)) scheduleRefresh();
});
chrome.tabs.onRemoved.addListener(scheduleRefresh);
chrome.tabs.onUpdated.addListener((_id, changes) => {
  if (changes.groupId !== undefined || changes.pinned !== undefined) scheduleRefresh();
});
chrome.windows.onRemoved.addListener(scheduleRefresh);
refresh().catch(report);
