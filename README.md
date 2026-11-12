# Tab Porter

Tab Porter sorts background tabs into native Chrome groups using rules you choose for sites, URL paths, page titles, GitHub repositories, and YouTube videos. Each Chrome profile starts with an empty list.

## Try it in Chrome

1. Download or clone this repository. If you download a ZIP, extract it first.
2. In desktop Chrome 137 or later, open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and select the `extension` folder containing `manifest.json`.
4. Open Tab Porter from Chrome’s Extensions menu and click **Create your first group**. Pick a name and color, add a site, title phrase, or advanced rule, and save.

To add another group, open **Tab Porter → Manage groups → New group**. Click **Save group** after choosing your matches. A new group appears in Chrome’s tab strip when the first matching tab is sorted.

For example, a group named *Reading* could match `wikipedia.org` and the phrase *book review*. Either condition is enough. Sites include their subdomains. If two rules match, the first one in the list wins.

## Advanced rules

Open **New group → Advanced rules → Add condition** and choose a match type. For an existing group, click **Edit**, expand a condition, and save your changes.

- **GitHub.** List exact repositories, match words in repository names, or enter folders and filenames. For example, choose **Files in a GitHub repository** and enter `CHANGELOG.md` to collect changelog files. Repository title rules can match whole phrases, text within a title, or a phrase followed by one of several endings.
- **Sites and URL paths.** Enter domains, pair hostnames with folders, or look for topics in URL paths while excluding sites you specify. For one documentation section, choose **URL path → Path and its subpages**, enter `/handbook`, then put the domain in **Limit to site**.
- **Page and publication titles.** Enter phrases or text, including Japanese. Publication conditions accept your own publisher names and topics. Detailed page-title and publication rules apply across sites by default. Their optional page filter skips YouTube pages and GitHub pages outside repository homepages.
- **YouTube.** Choose watch pages, Shorts, live videos, standard embeds, privacy-enhanced embeds, or short links. Leave **Sites** empty for a videos-only group.

Each condition can match a tab on its own. A domain entered within a condition limits that condition. A domain entered in the basic **Sites** field matches the whole site.

## While you browse

- A tab opened in the background can group immediately. A tab you were viewing gets a 30-second grace period after you leave it. Returning resets the timer.
- A matching tab can join a group in another window. Pinned tabs and tabs already in a group keep their place.
- **Recently moved** lists the last five moves. Click a title to jump to it, or use **Undo** to send it back and exclude it from grouping for the session.

## Privacy

Tab Porter uses Chrome’s extension APIs to match open tab addresses and titles on your device. The repository contains the complete extension and has no build dependencies. [Privacy policy](PRIVACY.md)
