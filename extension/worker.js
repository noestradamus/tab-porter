"use strict";
importScripts("rule-fields.js", "list-matcher.js", "advanced.js", "rules.js", "recent.js", "grace.js");

const rulesReady = loadRules();
const graceReady = initializeGrace();
importScripts("sorting.js");

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL("options.html")) return;
  if (!["getRules", "saveRule", "deleteRule"].includes(message?.type)) return;
  enqueue(async () => {
    await rulesReady;
    if (message.type === "getRules") return { ok: true, rules: sortRules };
    const result = await mutateRules(message);
    if (result.ok && message.type === "saveRule") scanOpenTabs();
    return result;
  }).then(respond, () => respond({ ok: false, message: "Couldn’t access your saved groups. Try again." }));
  return true;
});
