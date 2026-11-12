"use strict";

const collection = document.getElementById("collection");
const editor = document.getElementById("editor");
const list = document.getElementById("groups");
const form = document.getElementById("group-form");
const fields = document.getElementById("fields");
const titleField = document.getElementById("group-name");
const colorField = document.getElementById("group-color");
const sitesField = document.getElementById("sites");
const keywordsField = document.getElementById("keywords");
const advancedSection = document.getElementById("advanced-rules");
const basicSites = document.getElementById("basic-sites");
const sortNote = document.querySelector(".sort-note");
const newButton = document.getElementById("new");
const cancelButton = document.getElementById("cancel");
const deleteButton = document.getElementById("delete");
const retryButton = document.getElementById("retry");
const status = document.getElementById("status");

let rules = [];
let originalRule = null;
let loadVersion = 0;

function notice(message, error = false) {
  status.textContent = message;
  status.classList.toggle("error", error);
}

async function request(message) {
  const result = await chrome.runtime.sendMessage(message);
  if (!result?.ok) throw new Error(result?.message || "Couldn’t reach Tab Porter. Try again.");
  return result.rules;
}

function renderRows() {
  const template = document.getElementById("group-row");
  const rows = rules.map(rule => {
    const row = template.content.firstElementChild.cloneNode(true);
    row.querySelector(".swatch").dataset.color = rule.color;
    row.querySelector("strong").textContent = rule.title;
    const labels = [...rule.sites, ...rule.keywords.map(term => "“" + term + "”"), ...(rule.advanced || []).map(advancedEditor.describe)];
    const preview = labels.slice(0, 3);
    if (labels.length > preview.length) preview.push((labels.length - preview.length) + " more");
    row.querySelector("p").textContent = preview.join(" · ");
    const edit = row.querySelector(".edit");
    edit.dataset.id = rule.id;
    edit.setAttribute("aria-label", "Edit " + rule.title);
    edit.addEventListener("click", () => openEditor(rule));
    return row;
  });
  list.replaceChildren(...rows);
  document.getElementById("priority").hidden = rules.length < 2;
}

function openEditor(rule, focus = true) {
  // Keep the original version so a second settings tab cannot silently overwrite an edit.
  originalRule = rule;
  form.reset();
  const advanced = rule?.advanced || [];
  fields.insertBefore(advancedSection, advanced.length && !rule.sites.length && !rule.keywords.length ? basicSites : sortNote);
  advancedEditor.open(advanced);
  titleField.setCustomValidity("");
  document.getElementById("editor-heading").textContent = rule ? "Edit group" : (rules.length ? "Create a group" : "Create your first group");
  if (rule) {
    titleField.value = rule.title;
    colorField.value = rule.color;
    sitesField.value = rule.sites.join("\n");
    keywordsField.value = rule.keywords.join("\n");
  }
  deleteButton.hidden = !rule;
  cancelButton.hidden = !rule && !rules.length;
  collection.hidden = true;
  editor.hidden = false;
  notice("");
  if (focus) titleField.focus();
}

function showGroups(focusId) {
  originalRule = null;
  if (!rules.length) {
    openEditor(null, focusId !== undefined);
    return;
  }
  editor.hidden = true;
  collection.hidden = false;
  renderRows();
  if (focusId !== undefined) {
    const edit = Array.from(list.querySelectorAll(".edit")).find(button => button.dataset.id === focusId);
    (edit || newButton).focus();
  }
}

async function loadRules() {
  const version = ++loadVersion;
  try {
    const latest = await request({ type: "getRules" });
    if (version !== loadVersion) return;
    rules = latest;
    if (retryButton.hidden === false || (collection.hidden && editor.hidden)) notice("");
    retryButton.hidden = true;
    if (editor.hidden) {
      const focused = list.contains(document.activeElement) ? document.activeElement.dataset.id : undefined;
      showGroups(focused);
    } else {
      cancelButton.hidden = !originalRule && !rules.length;
    }
  } catch (error) {
    if (version !== loadVersion) return;
    notice(error.message, true);
    retryButton.hidden = false;
  }
}

function entries(field) {
  return field.value.split(/[\n,]/u).map(value => value.trim()).filter(Boolean);
}

async function changeRules(message, success) {
  if (fields.disabled) return;
  fields.disabled = true;
  try {
    rules = await request(message);
    ++loadVersion;
    const saved = message.rule && rules.find(rule => rule.id === message.rule.id || rule.title === message.rule.title);
    fields.disabled = false;
    showGroups(saved?.id || "");
    notice(success);
  } catch (error) {
    notice(error.message, true);
    fields.disabled = false;
  }
}

form.addEventListener("submit", event => {
  event.preventDefault();
  const title = titleField.value.trim();
  const sites = entries(sitesField);
  const keywords = entries(keywordsField);
  const advanced = advancedEditor.read();
  if (!title) {
    titleField.setCustomValidity("Enter a group name.");
    titleField.reportValidity();
    return;
  }
  if (!sites.length && !keywords.length && !advanced.length) {
    notice("Add a site, a page title keyword, or an advanced rule.", true);
    sitesField.focus();
    return;
  }
  const rule = { title, color: colorField.value, sites, keywords, advanced };
  const message = { type: "saveRule", rule };
  if (originalRule) {
    rule.id = originalRule.id;
    message.expected = originalRule;
  }
  changeRules(message, "Group saved.");
});
titleField.addEventListener("input", () => titleField.setCustomValidity(""));
newButton.addEventListener("click", () => openEditor(null));
cancelButton.addEventListener("click", () => {
  notice("");
  showGroups(originalRule?.id || "");
});
deleteButton.addEventListener("click", () => {
  if (originalRule) changeRules({ type: "deleteRule", id: originalRule.id, expected: originalRule }, "Sorting rule deleted.");
});
retryButton.addEventListener("click", loadRules);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.groupRules) loadRules();
});
loadRules();
