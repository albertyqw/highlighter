# Close Reader

Five-colour highlighting and notes for reading on the web. Works in Chrome, Arc, Brave and Edge.

| Key | Colour | Use it for |
|---|---|---|
| 1 | Yellow | Core argument, thesis, conclusion or main idea |
| 2 | Orange | Supporting qualitative or subjective premises |
| 3 | Blue | Supporting evidence, data or statistics |
| 4 | Green | Methodology, new techniques or definitions |
| 5 | Pink | Questions, gaps, counter-arguments, surprises to look up |

## Install

1. Unzip this folder somewhere permanent, such as `~/Tools/close-reader`.
2. Open `chrome://extensions` and switch on **Developer mode** (top right).
3. Click **Load unpacked** and choose the folder.
4. Pin Close Reader to the toolbar. Reload any tabs that were already open.

## Use

- **Alt+Shift+H** (Option+Shift+H on Mac) or the toolbar button turns highlighting on for the tab.
- Select text, then press **1 to 5** or click a colour. **Shift + number** highlights and opens a note.
- Click a highlight to change its colour, add a note, or delete it.
- **Alt+Shift+N** opens the notes panel. Click an entry to jump to it. **Copy as Markdown** exports the page's notes grouped by colour, ready for Notion or Claude.
- **Import to Notion** creates a new page in your **Reads** database. Review the detected article title and publication date, then choose existing topic tags and projects from the dropdowns. **Notion settings** opens the one-time connection setup.
- While the notes panel is open, the article reflows into the space beside it. Close the panel to restore the full reading width. On narrow screens, notes dock below the article instead.

Highlights save per page and come back when you return. Change the shortcuts at `chrome://extensions/shortcuts`.

## Connect Notion

1. Open **Notion settings** in the notes panel (or the extension's **Options** page).
2. Create an internal connection at [Notion's connection settings](https://www.notion.so/profile/integrations) with **Read content** and **Insert content** capabilities. Copy its token.
3. Open your **Reads database** and add your connection in its **••• → Connections** menu.
4. Enter the token and **Save connection**. Close Reader finds the database named Reads automatically. If more than one matches, paste the specific database link. Its schema must contain a title property, **Date** (date), **Topic Tags** (multi-select), and **Project** (multi-select). Existing connections from version 0.2 automatically search for Reads instead of using the old page destination.
5. Return to the article's notes panel. The title and publication date are detected from publisher metadata (JSON-LD, publication meta tags, or an explicitly marked publication time). Verify or edit them. A missing publication date must be entered manually; the import date is never substituted. **Date** in Reads stores this publication date, also labelled in the page body.
6. Expand **Topic tags** and **Projects** to select one or more existing choices. **Refresh Notion choices** reloads the latest options; it never creates new tags or projects. Click **Import to Notion**, then **Open in Notion** to see the result.

Each import creates a new database page; it does not sync or update previous imports. The source URL is linked in the body. Main ideas (yellow) become outermost bullets; subsequent supporting highlights nest beneath the preceding main idea, in reading order. Highlights before the first main idea stay at the outermost level. Personal notes nest beneath their highlight. Original colours map to the corresponding Notion background colours.

The import button is disabled while sending, while choices are loading, when Reads is disconnected, or when there are no highlights. Long quotes and notes are split into blocks; larger collections are batched while preserving nesting. If a batch fails after page creation, the error links to the partially imported page. Check that page before trying again to avoid duplicates.

Your token stays in this browser's local extension storage (not encrypted or synced). Requests go directly from the extension's background worker to `api.notion.com`; no third-party server is involved. Opening the notes panel reads the schema and choices; article notes are sent only when you click Import. **Disconnect** removes the saved connection and keeps your highlights and notes. Never put a token in source code. After updating the extension, reload it at `chrome://extensions` and refresh article tabs.

## Why export?

**Markdown** keeps headings, quotations, notes, and the source URL in readable text. It's useful for backups, pasting into an AI assistant, or moving notes into editors such as Obsidian. **Copy as Markdown** remains available alongside direct Notion import.

Other formats could serve different purposes: JSON can preserve all highlight metadata for backup/restore or automation; CSV makes highlights easy to filter in a spreadsheet; PDF is convenient for sharing a fixed reading copy. These formats are not currently implemented. Direct Notion import saves the copy-and-paste step and creates editable Notion blocks.

## Development checks

No build step or dependencies are required. With Node.js installed, run `node --test tests/*.test.cjs` from the repository root. Tests mock Notion responses; a live import requires your own connection and destination page.

## Limits

- Chrome's built-in PDF viewer, `chrome://` pages and the Web Store block extensions. For PDFs, open them in a web-based reader instead.
- If a page's text changes, a highlight may not re-attach. The panel marks those as "Not found on the page right now"; the text and note are kept.
- Single-page apps that change the URL without reloading may need a refresh to show the right highlights and article metadata.
- Reader reflow works with normal document layouts. Sites that render articles in canvases, embedded frames, or unusual fixed-position layouts may still need their own reader view.
