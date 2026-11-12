"use strict";

// Decode Unicode and spaces one segment at a time. An encoded slash still belongs to its segment.
function readablePath(path) {
  return path.split("/").map(segment => {
    try {
      return decodeURIComponent(segment).normalize("NFC").replace(/%/g, "%25").replace(/\//g, "%2F");
    } catch {
      return segment.normalize("NFC");
    }
  }).join("/");
}

const advancedRules = (() => {
  const pathOperators = ["equals", "subtree", "startsWith", "contains", "endsWith"];
  const videoFormats = ["watch", "shorts", "live", "standardEmbed", "privateEmbed", "shortLink"];
  const videoId = /^[A-Za-z0-9_-]{11}$/;

  function selectedVideoFormats(values) {
    if (!Array.isArray(values) || !values.length) return null;
    // Earlier releases used one checkbox for both standard and privacy-enhanced embeds.
    const selected = values.flatMap(format => format === "embed" ? ["standardEmbed", "privateEmbed"] : [format]);
    if (selected.some(format => !videoFormats.includes(format))) return null;
    return videoFormats.filter(format => selected.includes(format));
  }

  function normalizeCondition(condition) {
    if (condition?.type === "collection") return listMatcher.normalize(condition);
    if (condition?.type === "youtube") {
      const formats = selectedVideoFormats(condition.formats);
      if (!formats) throw new Error("Select at least one supported YouTube video format.");
      return { type: "youtube", formats };
    }
    if (condition?.type !== "path" && condition?.type !== "title") throw new Error("Choose a supported advanced rule.");
    const domain = condition.site ?? "";
    if (typeof domain !== "string") throw new Error("Enter a domain for the advanced rule.");
    const site = domain.trim() ? siteHostname(domain.trim()) : "";
    const value = typeof condition.value === "string" ? condition.value.trim().normalize("NFC") : "";
    if (condition.type === "title") {
      if (!value) throw new Error("Enter a phrase for the page title.");
      return { type: "title", site, value };
    }
    const operator = condition.operator;
    if (!pathOperators.includes(operator)) throw new Error("Choose how the URL path should match.");
    if (!value || /[?#*]/.test(value) || value.includes("://")) {
      throw new Error("Enter a URL path or fragment, without a domain, query, hash, or wildcard.");
    }
    if (["equals", "subtree", "startsWith"].includes(operator) && !value.startsWith("/")) {
      throw new Error("Start the URL path with /, for example /docs.");
    }
    return { type: "path", site, operator, value };
  }

  function normalize(conditions = []) {
    if (!Array.isArray(conditions)) throw new Error("Enter a list of advanced rules.");
    return conditions.map(normalizeCondition);
  }

  function matchesPath(path, operator, value) {
    const fragment = readablePath(value);
    switch (operator) {
      case "equals": return path === fragment;
      case "startsWith": return path.startsWith(fragment);
      case "contains": return path.includes(fragment);
      case "endsWith": return path.endsWith(fragment);
      case "subtree": {
        const folder = fragment.replace(/\/+$/, "");
        return path === folder || path.startsWith(folder + "/");
      }
      default: return false;
    }
  }

  function youtubeFormat(page, hostname) {
    const path = page.pathname;
    if (hostname === "youtu.be" || hostname === "www.youtu.be") {
      return /^\/[A-Za-z0-9_-]{11}\/?$/.test(path) ? "shortLink" : null;
    }
    const youtube = ["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"].includes(hostname);
    const privateEmbed = hostname === "youtube-nocookie.com" || hostname === "www.youtube-nocookie.com";
    if (!youtube && !privateEmbed) return null;
    if (youtube && (path === "/watch" || path === "/watch/")) {
      return videoId.test(page.searchParams.get("v") || "") ? "watch" : null;
    }
    const match = /^\/(shorts|live|embed)\/([A-Za-z0-9_-]{11})\/?$/.exec(path);
    if (!match || (privateEmbed && match[1] !== "embed")) return null;
    if (match[1] === "embed" && ["videoseries", "live_stream"].includes(match[2])) return null;
    if (match[1] === "embed") return privateEmbed ? "privateEmbed" : "standardEmbed";
    return match[1];
  }

  function matches(conditions, page, hostname, title, tab) {
    if (!conditions?.length) return false;
    let path;
    let format;
    let context;
    return conditions.some(condition => {
      if (condition.type === "collection") {
        context ??= listMatcher.context(page, tab || {url:page.href, title, status:"complete"});
        return listMatcher.matches(condition, context);
      }
      if (condition.type === "youtube") {
        if (format === undefined) format = youtubeFormat(page, hostname);
        return condition.formats.includes(format);
      }
      if (condition.site && !matchesSite(hostname, condition.site)) return false;
      if (condition.type === "title") return title.includes(foldedText(condition.value));
      path ??= readablePath(page.pathname);
      return matchesPath(path, condition.operator, condition.value);
    });
  }

  function equal(left = [], right = []) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((condition, index) => {
      const other = right[index];
      if (condition.type !== other?.type) return false;
      if (condition.type === "collection") return listMatcher.equal(condition, other);
      if (condition.type === "youtube") return sameTerms(condition.formats, selectedVideoFormats(other.formats));
      return condition.site === other.site && condition.operator === other.operator && condition.value === other.value;
    });
  }

  return { normalize, matches, equal };
})();
