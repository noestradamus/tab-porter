"use strict";

// Only selection IDs and unexpired deadlines are needed for the current session.
const GRACE_MS = 30_000;
const GRACE_KEY = "selectionGrace";
const GRACE_ALARM = "selectionGraceWake";
let selection = { active: {}, until: {} };
let earlyChanges = [];
let graceWrites = Promise.resolve();
let wakeAt = null;
let wakeTimer;

function selectTab(windowId, tabId, when) {
  const previous = selection.active[windowId];
  if (previous === tabId) return false;
  if (previous !== undefined) selection.until[previous] = when + GRACE_MS;
  selection.active[windowId] = tabId;
  delete selection.until[tabId];
  return true;
}

function graceChange(windowId, apply) {
  if (earlyChanges) earlyChanges.push({ windowId, apply });
  else if (apply()) saveGrace();
}

function inGrace(tab) {
  return selection.active[tab.windowId] === tab.id || selection.until[tab.id] > Date.now();
}

function releaseDueTabs() {
  const now = Date.now();
  for (const [id, deadline] of Object.entries(selection.until)) {
    if (deadline <= now) {
      delete selection.until[id];
      scheduleTab(Number(id));
    }
  }
}

async function syncGrace() {
  const deadlines = Object.values(selection.until);
  const next = deadlines.length ? Math.min(...deadlines) : 0;
  const writes = [chrome.storage.session.set({ [GRACE_KEY]: selection })];
  if (next !== wakeAt) {
    clearTimeout(wakeTimer);
    // The timer gives precise transitions while the worker is running. The one
    // native alarm also wakes a suspended worker, even if no tabs are touched.
    if (next) {
      wakeTimer = setTimeout(graceWake, Math.max(0, next - Date.now()));
      writes.push(chrome.alarms.create(GRACE_ALARM, { when: next }));
    } else {
      writes.push(chrome.alarms.clear(GRACE_ALARM));
    }
    wakeAt = next;
  }
  await Promise.all(writes);
}

function saveGrace() {
  // Selection changes take effect synchronously, even during a long manual
  // scan. Only the storage and alarm writes need to complete in order.
  graceWrites = graceWrites.then(syncGrace).catch(() => {
    wakeAt = null;
    console.warn("Tab selection timing could not be saved.");
  });
  return graceWrites;
}

function graceWake() {
  releaseDueTabs();
  saveGrace();
}

async function initializeGrace(savedSession = chrome.storage.session.get(GRACE_KEY)) {
  const [stored, activeTabs] = await Promise.all([
    savedSession,
    chrome.tabs.query({ windowType: "normal", active: true }),
  ]);
  if (stored[GRACE_KEY]) selection = stored[GRACE_KEY];
  const touched = new Set(earlyChanges.map(change => change.windowId));
  const liveWindows = new Set(activeTabs.map(tab => tab.windowId));
  for (const key of Object.keys(selection.active)) {
    if (!liveWindows.has(Number(key)) && !touched.has(Number(key))) delete selection.active[key];
  }
  for (const tab of activeTabs) {
    // A wake triggered by A → B can already see B in this query. Replay that
    // event against the saved A so its full countdown starts at the switch.
    if (!touched.has(tab.windowId) || selection.active[tab.windowId] === undefined) {
      selectTab(tab.windowId, tab.id, Date.now());
    }
  }
  for (const change of earlyChanges) change.apply();
  earlyChanges = null;
  releaseDueTabs();
  await saveGrace();
}

function forgetGrace(tabId, windowId) {
  graceChange(windowId, () => {
    const wasActive = selection.active[windowId] === tabId;
    const wasWaiting = Object.hasOwn(selection.until, tabId);
    if (wasActive) delete selection.active[windowId];
    delete selection.until[tabId];
    return wasActive || wasWaiting;
  });
}

// Chrome can swap in a prerendered tab with a new ID without the user
// switching tabs. Carry the selection or its existing deadline to that ID.
function replaceGraceTab(added, removed) {
  graceChange(undefined, () => {
    let changed = false;
    for (const windowId of Object.keys(selection.active)) {
      if (selection.active[windowId] === removed) {
        selection.active[windowId] = added;
        changed = true;
      }
    }
    if (Object.hasOwn(selection.until, removed)) {
      if (!Object.values(selection.active).includes(added)) {
        selection.until[added] = Math.max(selection.until[added] || 0, selection.until[removed]);
      }
      delete selection.until[removed];
      changed = true;
    }
    return changed;
  });
}
