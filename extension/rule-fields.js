"use strict";

// The editor and worker use the same field definitions for list-based matches.
const ruleFields = (() => {
  const field = (key, label, help, optional = false) => ({ key, label, help, optional });
  const list = (label, help, fields) => ({ label, help, fields });
  const values = (label, help) => [field("values", label, help)];
  const titleList = (label, help, fields, extra = "") => ({
    ...list(label, help, fields),
    articleScope: {
      label: "Skip YouTube and GitHub navigation pages",
      help: "Skip all YouTube pages and all GitHub pages except repository homepages." + extra,
    },
  });
  return {
    repositories: list(
      "GitHub repositories",
      "Match these repositories and their GitHub sections, including code, issues, and pull requests.",
      values("Repositories", "Enter one owner/repository per line."),
    ),
    repositoryNames: list(
      "Words in a repository name",
      "Match a phrase in a GitHub repository name. Dashes, dots, and underscores separate words.",
      values("Repository name phrases", "Enter one phrase per line, such as release notes."),
    ),
    repositoryFolders: list(
      "Folders in a GitHub repository",
      "Match a folder or its contents in a GitHub code view.",
      values("Folder paths", "Enter one folder path per line, such as docs/guides."),
    ),
    repositoryFiles: list(
      "Files in a GitHub repository",
      "Match a filename in a GitHub code view. Capitalization matters.",
      values("Filenames", "Enter one filename per line, such as README.md."),
    ),
    repositoryTitleWords: list(
      "Phrases in a repository title",
      "Match a complete phrase in a GitHub repository’s main page title. Punctuation separates words.",
      values("Title phrases", "Enter one phrase per line."),
    ),
    repositoryTitleText: list(
      "Text in a repository title",
      "Match literal text anywhere in a GitHub repository’s main page title. Works with punctuation and unspaced text.",
      values("Title text", "Enter one text match per line."),
    ),
    repositoryAudience: list(
      "Word combinations in repository titles",
      "On a repository’s main page, match an opening phrase followed by one to three modifiers and a noun, or by an alternative ending. For example, “tools for local teams” or “tools for schools”.",
      [
        field("openings", "Opening phrases", "Enter one phrase per line, such as tools for."),
        field(
          "qualifiers",
          "Modifiers",
          "One to three of these words can appear before a noun.",
          true,
        ),
        field("nouns", "Nouns", "Enter one noun per line, such as teams.", true),
        field("assistants", "Alternative endings", "Enter one ending per line, such as schools.", true),
      ],
    ),
    sites: list(
      "Sites and their subdomains",
      "Match any page on a listed domain or its subdomains.",
      values("Domains", "Enter one domain per line."),
    ),
    siteFolders: list("Folders on specific hosts", "Match a folder and its subpages on the exact hosts listed.", [
      field("hosts", "Hosts", "Enter one exact hostname per line. List www separately when needed."),
      field("paths", "Folder paths", "Enter one path per line starting with /."),
    ]),
    pathTopics: list(
      "Topics in a URL path",
      "Match complete topics in paths. Slashes, dots, dashes, underscores, plus signs, and encoded spaces separate words. Capitalization matters.",
      [
        field("values", "Path topics", "Enter one topic per line."),
        field("excludedSites", "Skip these sites", "These domains and their subdomains are excluded.", true),
      ],
    ),
    publisherTopics: titleList(
      "Topics in publication titles",
      "Match a topic in a title that ends with a publisher name after a dash, vertical bar, or middle dot.",
      [
        field("publishers", "Publisher names", "Enter the name as shown at the end of a page title."),
        field("values", "Whole-word title phrases", "Enter one topic per line.", true),
        field("text", "Text anywhere in the title", "Use for Japanese or other unspaced text.", true),
      ],
      " Also skip titles beginning with the GitHub site label.",
    ),
    titleWords: titleList(
      "Whole phrases in page titles",
      "Match whole phrases after punctuation and spacing are normalized.",
      values("Title phrases", "Enter one phrase per line."),
    ),
    titleText: titleList(
      "Text within page titles",
      "Match literal text, including punctuation and unspaced text.",
      values("Title text", "Enter one text match per line."),
    ),
  };
})();
