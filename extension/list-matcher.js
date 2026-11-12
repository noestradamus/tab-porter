"use strict";

const listMatcher = (() => {
  const cache = new WeakMap();
  const youtubeSites = ["youtube.com", "youtube-nocookie.com", "youtu.be"];
  const githubSections = new Set([
    "about", "account", "apps", "blog", "business", "codespaces", "collections",
    "contact", "copilot", "customer-stories", "dashboard", "discussions", "education",
    "enterprise", "enterprises", "events", "explore", "features", "gist", "issues",
    "join", "login", "marketplace", "new", "notifications", "organizations", "orgs",
    "partners", "premium-support", "pricing", "pulls", "readme", "resources", "search",
    "security", "sessions", "settings", "site", "solutions", "sponsors", "stars",
    "team", "teams", "topics", "trending", "users",
  ]);
  const repoSections = new Set(
    "actions archive blame blob branches commit commits compare discussions forks graphs issues labels milestone milestones network packages projects pull pulls pulse raw releases security stargazers tags tree wiki".split(
      " ",
    ),
  );
  const codeSections = new Set(["tree", "raw", "blob", "blame"]);
  const esc = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const normalizedTitle = (title) =>
    title
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[\p{P}\p{S}_]+/gu, " ")
      .replace(/\s+/g, " ");
  const literalText = text => text.normalize("NFKC").toLowerCase();
  const pathWords = text => text.replace(/(?:[-_.+/]|%20|\s)+/g, " ").trim();
  const repoWords = text => text.toLowerCase().replace(/[-._\s]+/g, " ").trim();
  const domainFields = new Set(["hosts", "excludedSites"]);
  function repositorySlug(value) {
    const slug = value.replace(/^(?:https?:\/\/)?(?:www\.)?github\.com\//i, "").replace(/\/$/, "").toLowerCase();
    if (!/^[a-z0-9-]+\/[a-z0-9._-]+$/.test(slug) || githubSections.has(slug.split("/")[0])) {
      throw new Error("Enter a GitHub repository as owner/repository.");
    }
    return slug;
  }
  function normalize(c) {
    if (!Object.hasOwn(ruleFields, c.kind)) throw new Error("Choose a supported advanced rule type.");
    const def = ruleFields[c.kind];
    const label = typeof c.label === "string" && c.label.trim() ? c.label.trim() : def.label;
    const rule = { type: "collection", kind: c.kind, label };
    if (def.articleScope && c.articleScope === true) rule.articleScope = true;
    for (const field of def.fields) {
      const values = c[field.key];
      if (!Array.isArray(values) || values.some((v) => typeof v !== "string"))
        throw new Error("Enter one value per line for " + field.label + ".");
      let terms = [...new Set(values.map((v) => v.trim()).filter(Boolean))];
      if ((c.kind === "sites" && field.key === "values") || domainFields.has(field.key)) {
        terms = ruleTerms(terms, true);
      } else if (c.kind === "repositories") {
        terms = [...new Set(terms.map(repositorySlug))];
      } else if (field.key === "paths" && terms.some((v) => !v.startsWith("/") || /[?#]/.test(v))) {
        throw new Error("Enter a folder path starting with / and without a query or fragment.");
      } else if (c.kind === "repositoryFiles" && terms.some((v) => /[/?#]/.test(v))) {
        throw new Error("Enter a filename without a folder, query, or fragment.");
      } else if (c.kind === "repositoryFolders") {
        terms = terms.map((v) => v.replace(/^\/+|\/+$/g, ""));
        if (terms.some((v) => !v || /[?#]/.test(v) || v.includes("//")))
          throw new Error("Enter a folder path such as docs/guides.");
      }
      const wordField = c.kind === "titleWords" || c.kind === "repositoryTitleWords" ||
        c.kind === "repositoryAudience" || (c.kind === "publisherTopics" && field.key === "values");
      if (wordField && terms.some(term => !normalizedTitle(term).trim())) {
        throw new Error("Use a word or phrase under " + field.label + ". Use a text match for punctuation or symbols.");
      }
      if (c.kind === "repositoryNames" && terms.some(term => !/^[a-z0-9]+(?: [a-z0-9]+)*$/.test(repoWords(term)))) {
        throw new Error("Use letters A–Z or numbers in repository name phrases. Separate words with spaces, dashes, dots, or underscores.");
      }
      if (c.kind === "pathTopics" && field.key === "values" && terms.some(term => !pathWords(term))) {
        throw new Error("Enter a path topic containing more than separators.");
      }
      if (!field.optional && !terms.length) throw new Error("Add at least one entry under " + field.label + ".");
      rule[field.key] = terms;
    }
    if (
      c.kind === "repositoryAudience" &&
      !rule.assistants.length &&
      !(rule.qualifiers.length && rule.nouns.length)
    ) {
      throw new Error("Add an alternative ending or both a modifier and a noun.");
    }
    if (c.kind === "publisherTopics" && !rule.values.length && !rule.text.length)
      throw new Error("Add at least one publication title phrase or text match.");
    return rule;
  }

  // Only escaped, literal phrases reach these patterns. Separators and boundaries are built in.
  function phrasePieces(values, separator, transform = (x) => x) {
    return values.map((value) => transform(value).trim().split(/\s+/).map(esc).join(separator)).filter(Boolean);
  }
  function wholePhrases(values) {
    return values.map(value => " " + normalizedTitle(value).trim() + " ");
  }

  function compile(c) {
    switch (c.kind) {
      case "repositoryNames":
        return c.values.map(value => " " + repoWords(value) + " ");
      case "repositoryTitleWords":
      case "titleWords":
        return wholePhrases(c.values);
      case "repositoryTitleText":
      case "titleText":
        return c.values.map(literalText);
      case "repositoryAudience": {
        const part = values => "(?:" + phrasePieces(values, " ", normalizedTitle).join("|") + ")";
        const targets = [];
        if (c.qualifiers.length && c.nouns.length) targets.push("(?:" + part(c.qualifiers) + " ){1,3}" + part(c.nouns));
        if (c.assistants.length) targets.push(part(c.assistants));
        return new RegExp("(?:^| )" + part(c.openings) + " (?:" + targets.join("|") + ")(?= |$)");
      }
      case "pathTopics":
        return c.values.map(value => " " + pathWords(value) + " ");
      case "publisherTopics":
        return {
          topics: wholePhrases(c.values),
          literal: c.text.map(literalText),
          publisher: new RegExp("^[\\s\\S]+[|·–—-]\\s*(?:" + c.publishers.map(value => esc(literalText(value))).join("|") + ")\\s*$"),
        };
      default:
        return null;
    }
  }

  function context(page, tab) {
    const hostname = page.hostname.replace(/\.$/, "");
    const domain = page.username || page.password ? "" : hostname;
    const path = readablePath(page.pathname);
    const isGitHub = hostname === "github.com" || hostname === "www.github.com";
    const repo = isGitHub && /^\/([a-z0-9-]+)\/([a-z0-9._-]+)(?:\/(.*))?$/i.exec(path);
    const isRepository = repo && !githubSections.has(repo[1].toLowerCase());
    const repoHome = isRepository && !repo[3];
    let link;
    if (isRepository && domain) {
      const remainder = repo[3] || "";
      link = {slug: (repo[1] + "/" + repo[2]).toLowerCase(), name: repo[2],
        section: remainder.split("/")[0], remainder, home: !remainder};
    }
    const title = tab.status === "loading" ? "" : tab.title || "";
    const onYoutube = youtubeSites.some(site => matchesSite(hostname, site));
    return {
      domain, path, link, title,
      githubTitle: repoHome && !!title,
      articleTitle: !onYoutube && (!isGitHub || repoHome) && !!title,
      loadingRepoHome: repoHome && tab.status === "loading",
    };
  }

  function codePaths(link) {
    if (!link || !codeSections.has(link.section)) return "";
    // A code URL has a Git reference before the first folder or filename.
    const tail = link.remainder.slice(link.section.length + 1);
    const split = tail.indexOf("/", 1);
    return split > 0 ? tail.slice(split) : "";
  }
  function matches(c, ctx) {
    if (!cache.has(c)) cache.set(c, compile(c));
    const compiled = cache.get(c);
    const { link, domain, path, githubTitle, articleTitle, title } = ctx;
    if (c.kind === "repositories" || c.kind === "repositoryNames") {
      if (!link || (!link.home && !repoSections.has(link.section))) return false;
      if (c.kind === "repositories") return c.values.includes(link.slug);
      const name = " " + repoWords(link.name) + " ";
      return compiled.some(phrase => name.includes(phrase));
    }
    if (c.kind === "repositoryFiles" || c.kind === "repositoryFolders") {
      const rest = codePaths(link);
      if (!rest) return false;
      return c.kind === "repositoryFiles"
        ? c.values.some((v) => rest.endsWith("/" + v) || rest.endsWith("/" + v + "/"))
        : c.values.some((v) => (rest + "/").includes("/" + v + "/"));
    }
    if (c.kind === "sites")
      return !ctx.loadingRepoHome && !!domain && c.values.some((site) => matchesSite(domain, site));
    if (c.kind === "siteFolders")
      return (
        !ctx.loadingRepoHome &&
        c.hosts.includes(domain) &&
        c.paths.some((v) => {
          const root = readablePath(v).replace(/\/+$/, "");
          return path === root || path.startsWith(root + "/");
        })
      );
    if (c.kind === "pathTopics") {
      if (ctx.loadingRepoHome || !domain || c.excludedSites.some(site => matchesSite(domain, site))) return false;
      const normalized = " " + pathWords(path) + " ";
      return compiled.some((phrase) => normalized.includes(phrase));
    }
    if (!title || (c.kind.startsWith("repository") && !githubTitle) || (c.articleScope && !articleTitle)) return false;
    if (c.kind === "repositoryTitleText" || c.kind === "titleText") {
      const text = ctx.literal ??= literalText(title);
      return compiled.some(value => text.includes(value));
    }
    const words = ctx.words ??= " " + normalizedTitle(title).trim() + " ";
    if (c.kind === "publisherTopics") {
      const text = ctx.literal ??= literalText(title);
      if ((c.articleScope && /^github(?:[\s:–—-]|$)/.test(text)) || !compiled.publisher.test(text)) return false;
      return compiled.topics.some(phrase => words.includes(phrase)) || compiled.literal.some(value => text.includes(value));
    }
    if (c.kind === "repositoryAudience") return compiled.test(words);
    return compiled.some(phrase => words.includes(phrase));
  }
  function equal(left, right) {
    if (!right || left.kind !== right.kind || left.label !== right.label) return false;
    if ((left.articleScope === true) !== (right.articleScope === true)) return false;
    return ruleFields[left.kind].fields.every((field) => sameTerms(left[field.key], right[field.key]));
  }
  return { normalize, context, matches, equal };
})();
