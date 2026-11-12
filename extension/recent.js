"use strict";

// Chrome's tab, group and window IDs are valid for this browser session.
async function recentHistory() {
  return (await chrome.storage.session.get("recentMoves")).recentMoves || [];
}

async function recordMove(tab, neighbors, rule, groupId, target) {
  const history = await recentHistory();
  const anchored = neighbors.some(other => other.id === tab.id && other.index === tab.index);
  const move = {
    id: crypto.randomUUID(),
    tabId: tab.id,
    title: tab.title && tab.title !== tab.url ? tab.title : new URL(tab.url).hostname,
    movedAt: Date.now(),
    group: rule.title,
    color: target?.color || rule.color,
    groupId,
    destination: target?.windowId ?? tab.windowId,
    origin: tab.windowId,
    index: tab.index,
    left: anchored ? neighbors.find(other => other.index === tab.index - 1)?.id ?? null : null,
    right: anchored ? neighbors.find(other => other.index === tab.index + 1)?.id ?? null : null,
  };
  const changes = { recentMoves: [move, ...history].slice(0, 5) };
  if (!target) changes[pendingNameKey(rule.title)] = groupId;
  await chrome.storage.session.set(changes);
}

async function ifPresent(promise) {
  try {
    return await promise;
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

async function moveState(move) {
  const [tab, origin, group] = await Promise.all([
    ifPresent(chrome.tabs.get(move.tabId)),
    ifPresent(chrome.windows.get(move.origin)),
    ifPresent(chrome.tabGroups.get(move.groupId)),
  ]);
  let undoHint = "";
  if (!tab) undoHint = "Tab closed";
  else if (!origin) undoHint = "Original window closed";
  else if (tab.pinned) undoHint = "Tab is now pinned";
  else if (tab.splitViewId >= 0) undoHint = "Tab is now in split view";
  else if (group?.shared && tab.groupId === move.groupId) undoHint = "Group is now shared";
  else {
    const grouped = group && tab.groupId === move.groupId && tab.windowId === move.destination;
    // A suspended or interrupted undo may already have ungrouped or returned the tab.
    const partial = move.undoing && tab.groupId === NO_GROUP &&
      (tab.windowId === move.origin || tab.windowId === move.destination);
    if (!grouped && !partial) undoHint = "Tab has been moved";
  }
  return { tab, group, undoHint };
}

async function getRecentMoves() {
  const history = await recentHistory();
  const moves = await Promise.all(history.map(async move => {
    const { tab, group, undoHint } = await moveState(move);
    const liveTitle = tab?.title && tab.title !== tab.url ? tab.title : move.title;
    return {
      id: move.id, title: liveTitle, group: group?.title || move.group,
      color: group?.color || move.color, crossWindow: move.origin !== move.destination,
      movedAt: move.movedAt, available: Boolean(tab), canUndo: !undoHint, undoHint,
    };
  }));
  return { ok: true, moves, ruleCount: sortRules.length };
}

async function focusTab(tab) {
  if (tab.groupId !== NO_GROUP) {
    const group = await ifPresent(chrome.tabGroups.get(tab.groupId));
    if (group?.collapsed) await chrome.tabGroups.update(group.id, { collapsed: false });
  }
  const active = await chrome.tabs.update(tab.id, { active: true });
  const host = await chrome.windows.get(active.windowId);
  if (host.state === "minimized") await chrome.windows.update(host.id, { state: "normal" });
  await chrome.windows.update(host.id, { focused: true });
}

async function showMove(move) {
  const tab = await ifPresent(chrome.tabs.get(move.tabId));
  if (!tab) return { ok: false, message: "That tab has been closed." };
  await focusTab(tab);
  return { ok: true };
}

function returnIndex(move, tabs) {
  const others = tabs.filter(t => t.id !== move.tabId).sort((a, b) => a.index - b.index);
  const right = others.findIndex(t => t.id === move.right);
  const left = others.findIndex(t => t.id === move.left);
  let index = Math.min(move.index, others.length);
  if (right >= 0) index = right;
  else if (left >= 0) index = left + 1;
  index = Math.max(index, others.filter(t => t.pinned).length);

  // Keep native groups contiguous if the original gap now falls inside a group.
  const group = others[index]?.groupId;
  if (group !== undefined && group !== NO_GROUP && others[index - 1]?.groupId === group) {
    let start = index, end = index;
    while (others[start - 1]?.groupId === group) start--;
    while (others[end]?.groupId === group) end++;
    index = index - start <= end - index ? start : end;
  }
  return index;
}

async function restorePosition(move) {
  const { tab, undoHint } = await moveState(move);
  if (undoHint) return { ok: false, message: undoHint + "." };

  // If the original window vanishes, a rejected cross-window move leaves the
  // tab in its current group. Ungroup only after it is back in its own window.
  if (tab.windowId !== move.origin) {
    const siblings = await chrome.tabs.query({ windowId: move.origin });
    const index = returnIndex(move, siblings);
    const latest = await chrome.tabs.get(tab.id);
    if (latest.windowId !== tab.windowId || latest.groupId !== tab.groupId || latest.pinned || latest.splitViewId >= 0) {
      return { ok: false, message: "The tab changed while it was being restored." };
    }
    await chrome.tabs.move(tab.id, { windowId: move.origin, index });
  }
  let current = await chrome.tabs.get(tab.id);
  if (current.windowId !== move.origin || current.pinned || current.splitViewId >= 0) {
    return { ok: false, message: "The tab changed while it was being restored." };
  }
  if (current.groupId === move.groupId) await chrome.tabs.ungroup(tab.id);
  else if (current.groupId !== NO_GROUP) return { ok: false, message: "The tab is now in a different group." };

  const siblings = await chrome.tabs.query({ windowId: move.origin });
  const index = returnIndex(move, siblings);
  current = siblings.find(t => t.id === move.tabId);
  if (!current || current.pinned || current.splitViewId >= 0 || current.groupId !== NO_GROUP) {
    return { ok: false, message: "The tab changed while it was being restored." };
  }
  if (current.index !== index) await chrome.tabs.move(current.id, { index });
  const restored = await chrome.tabs.get(current.id);
  if (restored.windowId !== move.origin || restored.groupId !== NO_GROUP) {
    return { ok: false, message: "The tab changed while it was being restored." };
  }
  return { ok: true };
}

async function undoMove(move, history, popupWindowId) {
  const { tab, undoHint } = await moveState(move);
  if (undoHint) return { ok: false, message: undoHint + "." };
  const follow = tab.active && tab.windowId === popupWindowId && tab.windowId !== move.origin;
  // Save the opt-out before touching Chrome's tabs. A click, delayed navigation
  // event or worker restart must not immediately send the tab back again.
  move.undoing = true;
  await chrome.storage.session.set({ recentMoves: history, [skipKey(tab.id)]: true });
  manualOverrides.add(tab.id);
  const result = await retryTransient(() => restorePosition(move));
  if (!result.ok) return result;
  await chrome.storage.session.set({ recentMoves: history.filter(item => item.id !== move.id) });
  if (follow) await focusTab(await chrome.tabs.get(tab.id));
  return { ok: true, message: "Move undone. This tab will stay where you put it." };
}

function handlePopupMessage(message) {
  switch (message?.type) {
    case "scanTabs":
      return scanOpenTabs().then(count => ({
        ok: true, message: count ? "Grouped " + count + (count === 1 ? " tab." : " tabs.") : "No background tabs ready to group.",
      }));
    case "getRecentMoves":
      return enqueue(getRecentMoves);
    case "showMovedTab":
    case "undoMove":
      return enqueue(async () => {
        const history = await recentHistory();
        const move = history.find(item => item.id === message.id);
        if (!move) return { ok: false, message: "That move is no longer in the recent list." };
        return message.type === "undoMove" ? undoMove(move, history, message.windowId) : showMove(move);
      });
    default:
      return undefined;
  }
}
