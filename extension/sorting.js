"use strict";

const NO_GROUP = chrome.tabGroups.TAB_GROUP_ID_NONE;
const manualOverrides = new Set();
const scheduledTabs = new Set();
let work = Promise.all([rulesReady, graceReady]);

function enqueue(operation) {
  const result = work.then(operation);
  work = result.catch(() => console.warn("A tab grouping operation could not be completed."));
  return result;
}

function isMissing(error) {
  return /no (?:tab|window|group|tab group) with id|invalid (?:tab|window|group)(?: group)? id|(?:tab|group|window) (?:was closed|not found)/i.test(error.message);
}

function isRetryable(error) {
  return isMissing(error) || /editable|dragging|cannot be edited|cannot be moved|can't be edited/i.test(error.message);
}

const skipKey = id => "ignore:" + id;
const pendingNameKey = title => "naming:" + title;

async function isIgnored(id) {
  return manualOverrides.has(id) || Boolean((await chrome.storage.session.get(skipKey(id)))[skipKey(id)]);
}

function rememberUngrouping(id) {
  manualOverrides.add(id);
  chrome.storage.session.set({ [skipKey(id)]: true }).catch(() => {
    console.warn("A manual grouping override could not be saved for this session.");
  });
}

// Group creation and naming are separate Chrome operations. Persist the intermediate
// group ID so a retry or a later worker can finish an interrupted name change.
async function finishNaming(rule, groupId) {
  let group;
  try {
    group = await chrome.tabGroups.get(groupId);
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
  if (group && !group.shared && !group.title) {
    await chrome.tabGroups.update(groupId, { title: rule.title, color: rule.color });
  }
  await chrome.storage.session.remove(pendingNameKey(rule.title));
}

async function repairName(rule) {
  const key = pendingNameKey(rule.title);
  const id = (await chrome.storage.session.get(key))[key];
  if (id !== undefined) await finishNaming(rule, id);
}

async function eligibleTab(id) {
  await graceReady;
  let tab;
  try {
    tab = await chrome.tabs.get(id);
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
  if (tab.active || tab.incognito || tab.pinned || tab.groupId !== NO_GROUP || tab.splitViewId >= 0 || inGrace(tab)) return null;
  return tab;
}

async function sortOne(id) {
  let tab = await eligibleTab(id);
  const rule = tab && matchingRule(tab);
  if (!rule || await isIgnored(id)) return false;

  const source = await chrome.windows.get(tab.windowId);
  if (source.type !== "normal" || source.incognito) return false;
  await repairName(rule);
  // Chrome's title filter is a pattern. Group names entered by users are literal.
  const groups = (await chrome.tabGroups.query({}))
    .filter(group => group.title === rule.title).sort((a, b) => a.id - b.id);
  let target;
  for (const group of groups) {
    if (group.shared) continue;
    const window = await chrome.windows.get(group.windowId);
    if (window.type === "normal" && !window.incognito) {
      target = group;
      break;
    }
  }
  if (!target && groups.length) return false;

  if (target) {
    const latest = await chrome.tabGroups.get(target.id);
    if (latest.shared || latest.title !== rule.title) return false;
  }

  const neighbors = await chrome.tabs.query({ windowId: source.id });
  // Re-read the tab immediately before moving it. The user may have switched back
  // while Chrome was looking up the group or while a previous attempt was waiting.
  tab = await eligibleTab(id);
  if (!tab || tab.windowId !== source.id || matchingRule(tab) !== rule || manualOverrides.has(id) || inGrace(tab)) return false;
  const groupId = target
    ? await chrome.tabs.group({ tabIds: id, groupId: target.id })
    : await chrome.tabs.group({ tabIds: id, createProperties: {windowId: tab.windowId} });
  await recordMove(tab, neighbors, rule, groupId, target);
  if (!target) await retryTransient(() => finishNaming(rule, groupId));
  return true;
}

async function retryTransient(operation) {
  for (const delay of [0, 150, 450, 1000]) {
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    try {
      return await operation();
    } catch (error) {
      if (!isRetryable(error) || delay === 1000) throw error;
    }
  }
}

function scheduleTab(id) {
  if (scheduledTabs.has(id)) return;
  scheduledTabs.add(id);
  enqueue(async () => {
    scheduledTabs.delete(id);
    if (!sortRules.length) return;
    await retryTransient(() => sortOne(id));
  });
}

function backgroundTabs(scope = {}) {
  return chrome.tabs.query({ ...scope, windowType: "normal", active: false, pinned: false, groupId: NO_GROUP });
}

function scanOpenTabs() {
  return enqueue(async () => {
    if (!sortRules.length) return 0;
    for (const rule of sortRules) await retryTransient(() => repairName(rule));
    const tabs = await backgroundTabs();
    let moved = 0;
    let deferred = 0;
    for (const tab of tabs) {
      if (tab.incognito || !matchingRule(tab)) continue;
      try {
        if (await retryTransient(() => sortOne(tab.id))) moved++;
      } catch {
        deferred++;
      }
    }
    const summary = "Last scan grouped " + moved + " tab" + (moved === 1 ? "" : "s") +
      (deferred ? " (" + deferred + " deferred)" : "");
    await chrome.action.setTitle({title: chrome.runtime.getManifest().action.default_title + " · " + summary});
    return moved;
  });
}

function scheduleIfMatching(tab) {
  // A navigation can wake the worker before this profile's saved rules have loaded.
  rulesReady.then(() => {
    if (matchingRule(tab)) scheduleTab(tab.id);
  }).catch(() => console.warn("Tab grouping rules could not be loaded."));
}

chrome.tabs.onCreated.addListener(tab => {
  if (!tab.active && !tab.incognito && tab.status === "complete") scheduleIfMatching(tab);
});
chrome.tabs.onActivated.addListener(({windowId, tabId}) => {
  const switchedAt = Date.now();
  graceChange(windowId, () => selectTab(windowId, tabId, switchedAt));
  enqueue(async () => {
    await graceReady;
    if (!sortRules.length) return;
    for (const tab of await backgroundTabs({windowId})) {
      if (!tab.incognito && !inGrace(tab) && matchingRule(tab)) scheduleTab(tab.id);
    }
  });
});
chrome.tabs.onUpdated.addListener((id, changes, tab) => {
  if (tab.incognito) return;
  if (changes.groupId === NO_GROUP) {
    rememberUngrouping(id);
    return;
  }
  if (!tab.active && tab.groupId === NO_GROUP && !tab.pinned && (changes.url || changes.title || changes.status === "complete")) {
    scheduleIfMatching(tab);
  }
});
chrome.tabs.onRemoved.addListener((id, {windowId}) => {
  forgetGrace(id, windowId);
  manualOverrides.delete(id);
  chrome.storage.session.remove(skipKey(id)).catch(() => {});
});
chrome.tabs.onReplaced.addListener((added, removed) => {
  replaceGraceTab(added, removed);
  scheduleTab(added);
});
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === GRACE_ALARM) graceReady.then(() => {
    // Recheck the live deadlines in case this was a superseded or late alarm.
    wakeAt = null;
    graceWake();
  });
});
// Start observing the selected tab at browser startup, before the first switch.
chrome.runtime.onStartup.addListener(() => graceReady);
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL("popup.html")) return;
  const task = handlePopupMessage(message);
  if (!task) return;
  task.then(respond, () => respond({ ok: false, message: "Chrome couldn’t finish that action. Try again." }));
  return true;
});
enqueue(async () => {
  for (const rule of sortRules) await retryTransient(() => repairName(rule));
});
