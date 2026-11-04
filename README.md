# FinderView

Browse your VS Code workspace in Finder-style columns. Open folders side by side, see the selected file's details, and open documents in their default desktop apps.

VS Code 워크스페이스를 macOS Finder의 열 보기처럼 탐색하세요. 폴더를 클릭하면 오른쪽 열이 펼쳐지고, 파일을 더블클릭하면 기본 외부 앱으로 열립니다.

## Get started / 시작하기

1. Open a folder or workspace in VS Code.
2. Click the FinderView logo in the editor's top-right toolbar, or run **FinderView: Open** from the Command Palette.
3. FinderView expands the path to the current editor's file and selects it. When no file is active, a new view starts at the workspace root.

## Features / 주요 기능

- **Column navigation:** click a folder to show its children in the next column; click it again to collapse the child columns. Refresh preserves collapsed folders. Changing an ancestor clears the old path.
- **Open documents:** double-click a file or press Enter to launch its default external app. Use the context menu to open in VS Code instead.
- **File details:** select a file to see its name, extension, size, and path. Office documents, PDFs, source files, and other file types appear in the list.
- **Workspace visibility:** respects `files.exclude` and, when enabled, `explorer.excludeGitIgnore`. Dotfiles are shown by default; the toolbar can hide them. macOS hidden attributes do not hide items.
- **Tools:** refresh, folder-first/name/recently-modified sorting, path copy, and reveal in Finder or your OS file manager.
- **File management:** hold **Shift** while dragging files or folders from your desktop onto a folder row or a column to copy them there. VS Code intercepts external drops without Shift. Drag inside FinderView to move; hold Alt/Option or Ctrl to copy. Select multiple items with Cmd/Ctrl or Shift.
- **Context menu:** move to a chosen workspace folder, rename files/folders, or move selected items to Trash. File-management actions are in the context menu; the toolbar shows a Shift-drag hint.
- **Name conflicts:** choose overwrite, save with another name, skip, or cancel. Existing targets are moved to Trash before replacement.
- **Keyboard navigation:** Up/Down, Left/Right, Home/End, Enter, and Cmd/Ctrl+R to refresh.
- **Workspace support:** multi-root selection, theme-aware colors, horizontal scrolling, and automatic refresh after file changes.

## Behavior and requirements / 지원 범위

VS Code **1.95 or newer** is required. External apps must already be installed and associated with the file types you want to open.

External opening is available only for local files in a trusted workspace. macOS uses `open`, Linux uses `xdg-open`, and Windows uses `rundll32`. External opening and OS reveal are unavailable in remote workspaces. This release was tested on macOS; Windows, Linux, and remote workspaces have not been verified on devices.

FinderView does not include an Office/PDF renderer. Opening inside VS Code depends on its installed viewers. File changes require a trusted workspace. Deletion asks for confirmation and uses Trash; it does not fall back to permanent deletion. Move and rename operations update VS Code editor paths. Workspace roots cannot be moved, renamed, deleted, or replaced. Workspace-external symbolic links are blocked; remote symbolic links are restricted.

Desktop drops copy file contents without modifying the original files. File and folder drops preserve empty items and transfer in chunks; each drop supports up to 1 GB and 10,000 entries. Transfers can finish some items before a filesystem error; completed work is reported. Moving with the folder picker is limited to folders inside the open workspace.

폴더·파일을 우클릭하면 **파일 추가 / 이동 / 이름 변경 / 삭제**을 사용할 수 있습니다. 같은 이름이 있으면 **덮어쓰기 / 다른 이름으로 저장 / 건너뛰기 / 취소**를 선택합니다. 외부 파일은 **Shift를 누른 채 원하는 폴더 위에 드롭**하면 그 폴더에 복사됩니다. 원본은 유지하며, FinderView 안에서 드래그하면 이동합니다.

Columns have a fixed width of 220px. Sidebar mode, resizable columns, search, list virtualization, and VS Code file nesting are not included in this release.

## Development

```sh
npm ci
npm run compile
npm test
npm run package
```

Press F5 in the source project to launch the Extension Development Host, then run **FinderView: Open**. Tests use an isolated temporary workspace and profile.

## License

MIT

## Distribution / 배포

[배포 폴더](distribution/README.md)에 설치용 VSIX, 게시자 로고, Marketplace 업로드 및 업데이트 방법을 보관합니다.

VS Code Webview 외부 드롭의 Shift 동작: [WebviewWindowDragMonitor](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/webview/browser/webviewWindowDragMonitor.ts)
