"use strict";

const advancedEditor = (() => {
  const details = document.getElementById("advanced-rules");
  const conditions = document.getElementById("advanced-conditions");
  const count = document.getElementById("advanced-count");
  const template = document.getElementById("advanced-condition");
  const add = document.getElementById("add-condition");
  const readers = new WeakMap();
  const pathExamples = { subtree: "/docs", equals: "/about", startsWith: "/blog/", contains: "/guides/", endsWith: ".md" };
  const videoNames = Object.fromEntries(
    Array.from(template.content.querySelectorAll(".condition-formats input"), box => [box.value, box.closest("label").textContent.trim()])
  );
  const conditionGroups = {
    GitHub: ["repositories", "repositoryNames", "repositoryFolders", "repositoryFiles", "repositoryTitleWords", "repositoryTitleText", "repositoryAudience"],
    "Sites and paths": ["sites", "siteFolders", "pathTopics"],
    "Page titles": ["publisherTopics", "titleWords", "titleText"],
  };
  let nextId = 0;

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function listValues(input) {
    return input.value.split("\n").map(value => value.trim()).filter(Boolean);
  }

  function formatPreview(values) {
    return values.slice(0, 3).join(" · ") + (values.length > 3 ? " · +" + (values.length - 3) : "");
  }

  function describe(condition) {
    if (condition.type === "collection") return condition.label || ruleFields[condition.kind].label;
    if (condition.type === "youtube") return "YouTube videos";
    const scope = condition.site ? " on " + condition.site : "";
    if (condition.type === "title") return condition.value ? "Title contains “" + condition.value + "”" + scope : "Page title";
    if (!condition.value) return "URL path";
    if (condition.operator === "subtree") return condition.value + " and its subpages" + scope;
    const verbs = { equals: "is", startsWith: "starts with", contains: "contains", endsWith: "ends with" };
    return "Path " + verbs[condition.operator] + " “" + condition.value + "”" + scope;
  }

  function preview(condition) {
    if (condition.type === "youtube") return formatPreview(condition.formats.map(value => videoNames[value]));
    if (condition.type !== "collection") return "";
    const spec = ruleFields[condition.kind];
    for (const field of spec.fields) {
      const values = condition[field.key] || [];
      if (!values.length) continue;
      return formatPreview(values);
    }
    return "";
  }

  function updateCount() {
    const n = conditions.children.length;
    count.textContent = n ? n + (n === 1 ? " condition" : " conditions") : "";
  }

  function makeCollectionPanel(panel, kind, saved, id) {
    const spec = ruleFields[kind];
    panel.replaceChildren();
    if (spec.help) panel.append(element("p", "hint", spec.help));
    const nameLabel = element("label", "", "Condition name");
    const name = element("input", "collection-label");
    name.type = "text";
    name.value = saved.label || spec.label;
    name.placeholder = spec.label;
    name.autocomplete = "off";
    nameLabel.append(name);
    panel.append(nameLabel);
    const fieldReaders = [];
    for (const field of spec.fields) {
      const initial = saved[field.key] || [];
      const wrapper = element("div", "collection-field");
      const label = element("label", "", field.label + (field.optional ? " (optional)" : ""));
      const total = element("span", "field-count");
      total.setAttribute("aria-hidden", "true");
      label.append(total);
      const input = element("textarea");
      const hint = element("p", "hint", field.help && /per line/i.test(field.help) ? field.help : [field.help, "One entry per line."].filter(Boolean).join(" "));
      input.id = id + "-" + field.key;
      label.htmlFor = input.id;
      hint.id = input.id + "-hint";
      input.setAttribute("aria-describedby", hint.id);
      input.dataset.key = field.key;
      input.rows = Math.max(2, Math.min(5, initial.length || 3));
      input.spellcheck = false;
      input.setAttribute("autocapitalize", "off");
      input.value = initial.join("\n");
      input.required = !field.optional;
      function showCount() {
        const n = listValues(input).length;
        if (input.required) input.setCustomValidity(n ? "" : "Enter at least one value.");
        total.textContent = n ? "(" + n + ")" : "";
      }
      showCount();
      input.addEventListener("input", showCount);
      wrapper.append(label, hint, input);
      panel.append(wrapper);
      fieldReaders.push(() => [field.key, listValues(input)]);
    }
    let scope;
    if (spec.articleScope) {
      const wrapper = element("div", "collection-field");
      const label = element("label", "scope-toggle");
      const hint = element("p", "hint", spec.articleScope.help);
      hint.id = id + "-scope-help";
      scope = element("input");
      scope.type = "checkbox";
      scope.dataset.key = "articleScope";
      scope.checked = saved.articleScope === true;
      scope.setAttribute("aria-describedby", hint.id);
      label.append(scope, document.createTextNode(spec.articleScope.label));
      wrapper.append(label, hint);
      panel.append(wrapper);
    }
    return () => ({
      type: "collection", kind, label: name.value.trim() || spec.label,
      ...Object.fromEntries(fieldReaders.map(read => read())),
      ...(scope?.checked ? { articleScope: true } : {}),
    });
  }

  function makeRow(condition = { type: "path", operator: "subtree" }, expanded = false) {
    const row = template.content.firstElementChild.cloneNode(true);
    const type = row.querySelector(".condition-type");
    const operator = row.querySelector(".condition-operator");
    const value = row.querySelector(".condition-value");
    const site = row.querySelector(".condition-site");
    const formats = row.querySelector(".condition-formats");
    const boxes = Array.from(formats.querySelectorAll("input"));
    const pathHint = row.querySelector(".path-hint");
    const panel = row.querySelector(".collection-settings");
    const remove = row.querySelector(".remove-condition");
    const id = "advanced-" + (++nextId);
    pathHint.id = id + "-path-help";
    row.open = expanded;

    for (const [group, kinds] of Object.entries(conditionGroups)) {
      const groupOptions = element("optgroup");
      groupOptions.label = group;
      for (const kind of kinds) groupOptions.append(new Option(ruleFields[kind].label, "collection:" + kind));
      type.append(groupOptions);
    }
    type.value = condition.type === "collection" ? "collection:" + condition.kind : condition.type;
    operator.value = condition.operator || "subtree";
    site.value = condition.site || "";
    const drafts = new Map([[type.value, condition]]);
    if (condition.formats) boxes.forEach(box => { box.checked = condition.formats.includes(box.value); });
    let previousType;
    let readCollection;

    function read() {
      if (readCollection) return readCollection();
      if (type.value === "youtube") return { type: "youtube", formats: boxes.filter(box => box.checked).map(box => box.value) };
      const rule = { type: type.value, site: site.value.trim(), value: value.value.trim() };
      if (type.value === "path") rule.operator = operator.value;
      return rule;
    }

    function labelRow() {
      const current = read();
      const title = describe(current);
      row.querySelector(".condition-name").textContent = title;
      row.querySelector(".condition-preview").textContent = preview(current);
      remove.setAttribute("aria-label", "Remove condition " + title);
    }

    function validateVideo() {
      const empty = type.value === "youtube" && !boxes.some(box => box.checked);
      boxes[0].setCustomValidity(empty ? "Choose at least one video link type." : "");
    }

    function updatePathHint() {
      value.placeholder = type.value === "path" ? "e.g. " + pathExamples[operator.value] : "e.g. book review";
    }

    function setType() {
      if (previousType) {
        // Keep unfinished values if the user switches the selector and switches back.
        const old = readCollection ? readCollection() : { value: value.value, site: site.value, operator: operator.value };
        drafts.set(previousType, old);
      }
      previousType = type.value;
      const draft = drafts.get(type.value) || {};
      const isPath = type.value === "path";
      const isText = isPath || type.value === "title";
      const isVideo = type.value === "youtube";
      const isCollection = type.value.startsWith("collection:");
      row.querySelector(".condition-inputs").hidden = !isText;
      row.querySelector(".operator-field").hidden = !isPath;
      row.querySelector(".scope-field").hidden = !isText;
      row.querySelector(".value-label").textContent = isPath ? "Path" : "Title contains";
      pathHint.hidden = !isPath;
      operator.disabled = !isPath;
      value.disabled = !isText;
      site.disabled = !isText;
      value.required = isText;
      value.value = draft.value || "";
      site.value = draft.site || "";
      if (isPath) {
        operator.value = draft.operator || "subtree";
        value.setAttribute("aria-describedby", pathHint.id);
      } else value.removeAttribute("aria-describedby");
      formats.hidden = !isVideo;
      boxes.forEach(box => { box.disabled = !isVideo; });
      panel.hidden = !isCollection;
      panel.replaceChildren();
      readCollection = isCollection ? makeCollectionPanel(panel, type.value.slice("collection:".length), draft, id) : null;
      updatePathHint();
      validateVideo();
      labelRow();
    }

    type.addEventListener("change", setType);
    operator.addEventListener("change", updatePathHint);
    formats.addEventListener("change", validateVideo);
    row.addEventListener("input", event => { if (event.target !== type) labelRow(); });
    row.addEventListener("change", labelRow);
    remove.addEventListener("click", () => {
      const next = row.nextElementSibling || row.previousElementSibling;
      row.remove();
      updateCount();
      (next?.querySelector(".condition-summary") || add).focus();
    });
    setType();
    readers.set(row, read);
    return row;
  }

  function read() {
    return Array.from(conditions.children, row => readers.get(row)());
  }

  function open(saved) {
    conditions.replaceChildren(...saved.map(condition => makeRow(condition, saved.length === 1)));
    details.open = Boolean(saved.length);
    updateCount();
  }

  add.addEventListener("click", () => {
    const row = makeRow(undefined, true);
    conditions.append(row);
    updateCount();
    row.querySelector(".condition-type").focus();
  });
  details.addEventListener("invalid", event => {
    details.open = true;
    const row = event.target.closest(".condition");
    if (row) row.open = true;
  }, true);
  return { open, read, describe };
})();
