# FinderView

Browse your VS Code workspace in Finder-style columns. Open folders side by side, see the selected file's details, and open documents in their default desktop apps.

VS Code 워크스페이스를 macOS Finder의 열 보기처럼 탐색하세요. 폴더를 클릭하면 오른쪽 열이 펼쳐지고, 파일을 더블클릭하면 기본 외부 앱으로 열립니다.

## Get started / 시작하기

1. Open a folder or workspace in VS Code.
2. Click the FinderView logo in the editor's top-right toolbar, or run **FinderView: Open** from the Command Palette.
3. FinderView expands the path to the current editor's file and selects it. When no file is active, a new view starts at the workspace root.

## Features / 주요 기능

- **Column navigation:** click a folder to show its children in the next column. Changing an ancestor clears the old path.
- **Open documents:** double-click a file or press Enter to launch its default external app. Use the context menu to open in VS Code instead.
- **File details:** select a file to see its name, extension, size, and path. Office documents, PDFs, source files, and other file types appear in the list.
- **Workspace visibility:** respects `files.exclude` and, when enabled, `explorer.excludeGitIgnore`. Dotfiles are shown by default; the toolbar can hide them. macOS hidden attributes do not hide items.
- **Tools:** refresh, folder-first/name sorting, path copy, and reveal in Finder or your OS file manager.
- **Keyboard navigation:** Up/Down, Left/Right, Home/End, Enter, and Cmd/Ctrl+R to refresh.
- **Workspace support:** multi-root selection, theme-aware colors, horizontal scrolling, and automatic refresh after file changes.

## Behavior and requirements / 지원 범위

VS Code **1.95 or newer** is required. External apps must already be installed and associated with the file types you want to open.

External opening is available only for local files in a trusted workspace. macOS uses `open`, Linux uses `xdg-open`, and Windows uses `rundll32`. External opening and OS reveal are unavailable in remote workspaces. This release was tested on macOS; Windows, Linux, and remote workspaces have not been verified on devices.

FinderView does not include an Office/PDF renderer. Opening inside VS Code depends on its installed viewers. It does not move, rename, delete, or overwrite files. Workspace-external symbolic links are blocked; remote symbolic links are restricted.

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
