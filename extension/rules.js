"use strict";

let sortRules = [];
const groupColors = new Set(["grey", "blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange"]);

function foldedText(text) {
  return text.normalize("NFC").toLowerCase();
}

function siteHostname(site) {
  const address = site.replace(/^https?:\/\//i, "").replace(/\/$/, "");
  const hint = "Enter a domain such as example.com, without a path, port, or wildcard.";
  if (!address || /[\s/\\?#%@*]/u.test(address)) throw new Error(hint);
  if (address.includes(":") && !/^\[[\da-f:.]+\]$/i.test(address)) throw new Error(hint);
  let hostname;
  try {
    hostname = new URL("https://" + address).hostname.replace(/\.$/, "");
  } catch {
    throw new Error(hint);
  }
  if (hostname.startsWith("[")) return hostname;
  const validLabel = /^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/;
  if (hostname.length > 253 || !hostname.split(".").every(label => validLabel.test(label))) throw new Error(hint);
  // The URL parser expands shorthand and octal IPv4 addresses. Require the explicit address.
  if (/^\d+(?:\.\d+){3}$/.test(hostname) && hostname !== address.replace(/\.$/, "")) throw new Error(hint);
  return hostname;
}

function matchesSite(hostname, site) {
  return hostname === site || hostname.endsWith("." + site);
}

function ruleTerms(values, isSite) {
  if (!Array.isArray(values)) throw new Error("Enter a list of sites or title phrases.");
  const terms = [];
  const seen = new Set();
  for (const value of values) {
    if (typeof value !== "string") throw new Error("Sites and title phrases must be text.");
    const trimmed = value.trim();
    if (!trimmed) continue;
    const term = isSite ? siteHostname(trimmed) : trimmed;
    const key = foldedText(term);
    if (!seen.has(key)) terms.push(term);
    seen.add(key);
  }
  return terms;
}

function validatedRule(input, id) {
  const title = typeof input?.title === "string" ? input.title.trim() : "";
  if (!title) throw new Error("Give the group a name.");
  if (!groupColors.has(input.color)) throw new Error("Choose a Chrome group color.");
  const sites = ruleTerms(input.sites ?? [], true);
  const keywords = ruleTerms(input.keywords ?? [], false);
  const advanced = advancedRules.normalize(input.advanced);
  if (!sites.length && !keywords.length && !advanced.length) throw new Error("Add a site, title phrase, or advanced rule.");
  const rule = { id, title, color: input.color, sites, keywords };
  if (advanced.length) rule.advanced = advanced;
  return rule;
}

async function loadRules() {
  const { groupRules } = await chrome.storage.local.get("groupRules");
  const rules = [];
  if (Array.isArray(groupRules)) {
    for (const saved of groupRules) {
      if (typeof saved?.id !== "string" || !saved.id) continue;
      try {
        rules.push(validatedRule(saved, saved.id));
      } catch {
        // A damaged entry must not prevent the user's other groups from working.
      }
    }
  }
  sortRules = rules;
  return sortRules;
}

function matchingRule(tab) {
  if (!sortRules.length || !/^https?:\/\//i.test(tab.url || "") || (tab.pendingUrl && tab.pendingUrl !== tab.url)) return null;
  let page;
  try {
    page = new URL(tab.url);
  } catch {
    return null;
  }
  const hostname = page.hostname.replace(/\.$/, "");
  const title = tab.status === "complete" ? foldedText(tab.title || "") : "";
  return sortRules.find(rule =>
    rule.sites.some(site => matchesSite(hostname, site)) ||
    rule.keywords.some(keyword => title.includes(foldedText(keyword))) ||
    advancedRules.matches(rule.advanced, page, hostname, title, tab)
  ) || null;
}

function sameTerms(left, right) {
  return Array.isArray(right) && left.length === right.length && left.every((term, index) => term === right[index]);
}

function sameRule(current, expected) {
  return current && expected && current.id === expected.id && current.title === expected.title &&
    current.color === expected.color && sameTerms(current.sites, expected.sites) && sameTerms(current.keywords, expected.keywords) &&
    advancedRules.equal(current.advanced, expected.advanced);
}

async function mutateRules(message) {
  const deleting = message.type === "deleteRule";
  if (!deleting && message.type !== "saveRule") return { ok: false, message: "Unknown group action." };
  const input = message.rule;
  const creating = !deleting && input && !Object.hasOwn(input, "id");
  const id = deleting ? message.id : input?.id;
  const index = sortRules.findIndex(rule => rule.id === id);
  if (!creating && !sameRule(sortRules[index], message.expected)) {
    return { ok: false, message: "This group changed. Reopen it to use the latest settings." };
  }
  if (creating && message.expected !== undefined) return { ok: false, message: "Reopen this group before saving." };

  const next = [...sortRules];
  if (deleting) {
    next.splice(index, 1);
  } else {
    let rule;
    try {
      // An editor opened before the update may omit advanced conditions. Clearing them is explicit.
      const updated = creating || Object.hasOwn(input, "advanced") ? input : { ...input, advanced: sortRules[index].advanced };
      rule = validatedRule(updated, creating ? crypto.randomUUID() : id);
    } catch (error) {
      return { ok: false, message: error.message };
    }
    if (sortRules.some(item => item.id !== rule.id && foldedText(item.title) === foldedText(rule.title))) {
      return { ok: false, message: "A group already uses that name. Choose another name." };
    }
    if (creating) next.push(rule);
    else next[index] = rule;
  }
  try {
    await chrome.storage.local.set({ groupRules: next });
  } catch {
    return { ok: false, message: "Chrome couldn’t save this change. Try again." };
  }
  sortRules = next;
  return { ok: true, rules: sortRules };
}
