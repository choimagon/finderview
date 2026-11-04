# Changelog

## 0.2.4

- Rename the OS file-manager context action to “Finder / 파일 탐색기에서 열기”.

## 0.2.3

- Increase the FinderView header to 20px with an extra-bold font weight.

## 0.2.2

- Enlarge the external Shift-drag hint and highlight it with a theme-aware badge and keycap.

## 0.2.1

- Add newest-modified-first sorting for files and folders.
- Toggle folder expansion on repeated clicks and preserve collapsed state on refresh.
- Place the external-file Shift-drag hint where file-action toolbar buttons were.
- Keep add/move/rename/delete actions in the right-click menu; label deletion explicitly.
- Capture dropped files synchronously and preserve mixed file/folder drops.
- Verify a trusted native Chromium drop with Shift onto an unopened folder.

## 0.2.0

- Add desktop file/folder drag-and-drop imports and a native file picker.
- Add internal drag move, Alt/Option/Ctrl drag copy, and multiple selection.
- Add context-menu move, rename, and Trash actions for files and folders.
- Add overwrite, save under another name, skip, and cancel choices for conflicts.
- Preserve replaced items in Trash and reject unsafe workspace/root operations.
- Keep editor paths synchronized during moves and renames.
- Add chunked imports and file-management integration/UI tests.

## 0.1.5

First Marketplace package.

- Finder-style column browsing in an editor tab.
- Editor toolbar logo opens the current file's location.
- Double-click files to open them in their default external app.
- File details, sorting, dotfile toggle, context menu, and keyboard navigation.
- VS Code exclusion settings and automatic filesystem refresh.
- FinderView branding and theme-aware icons.
