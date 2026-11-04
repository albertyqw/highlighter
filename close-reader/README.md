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

Highlights save per page and come back when you return. Change the shortcuts at `chrome://extensions/shortcuts`.

## Limits

- Chrome's built-in PDF viewer, `chrome://` pages and the Web Store block extensions. For PDFs, open them in a web-based reader instead.
- If a page's text changes, a highlight may not re-attach. The panel marks those as "Not found on the page right now"; the text and note are kept.
- Single-page apps that change the URL without reloading may need a refresh to show the right highlights.
