# Column Explorer

VS Code 워크스페이스를 macOS Finder 열 보기처럼 탐색하는 확장입니다. 파일 내용을 수정하는 기능은 없습니다.

## 실행과 디버깅

Node.js 22 이상과 VS Code 1.95 이상이 필요합니다.

```sh
npm install
npm run compile
code .
```

VS Code에서 F5 → **Run Column Explorer**를 실행합니다. 새 Extension Development Host에서 탐색할 폴더를 연 뒤 명령 팔레트(`Cmd+Shift+P`)에서 **FinderView: Open**을 실행하세요.

## 사용법

- 폴더 한 번 클릭: 오른쪽에 하위 열 추가. 상위 선택 변경 시 하위 열 초기화.
- 파일 한 번 클릭: 이름, 확장자, 크기, 경로 표시. 더블클릭 또는 Enter: OS 기본 외부 앱으로 열기.
- 우클릭: VS Code / 외부 앱으로 열기, 경로 복사, Finder 또는 파일 탐색기에서 표시.
- 툴바: 새로고침, 점(.) 파일 표시, 폴더 우선 또는 이름순 정렬. 다중 루트에서는 루트 선택 표시.
- 방향키와 Home/End: 항목 및 열 탐색. Cmd/Ctrl+R: 새로고침.
- 파일 변경은 디바운싱 후 자동 갱신합니다. 삭제된 선택 경로는 유효한 상위 열로 돌아갑니다.

열 너비는 220px이며 수평 스크롤을 지원합니다. 밝은/어두운/고대비 테마는 VS Code 색상 변수를 따릅니다. 아이콘은 확장자별 자체 배지이며 설치된 파일 아이콘 테마를 가져오지 않습니다.

## 파일 열기와 안전성

파일 더블클릭은 OS 기본 앱을 사용합니다. 우클릭의 VS Code에서 열기는 `vscode.open`을 사용하므로 PDF/Office 문서의 내부 열기는 설치된 뷰어 확장에 따라 달라집니다. 문서 렌더러는 포함하지 않으며 바이너리를 텍스트로 강제 디코딩하지 않습니다.

외부 앱은 macOS `open`, Linux `xdg-open`, Windows `rundll32`를 셸 없이 인자 배열로 실행합니다. 로컬의 신뢰된 워크스페이스에서만 지원하며, 원격에서는 외부 앱 실행과 OS 위치 표시를 지원하지 않습니다. 원격 파일 목록은 `workspace.fs`로 조회합니다.

워크스페이스 URI 경계와 로컬 심볼릭 링크의 실제 경로를 확인합니다. 외부 링크는 목록에 보이더라도 탐색/열기 시 차단합니다. 원격 심볼릭 링크는 실제 경계를 보장할 수 없어 접근을 제한합니다. Webview는 직접 파일 시스템에 접근하지 않으며 CSP와 `textContent`를 사용합니다. 이동, 삭제, 이름 변경, 덮어쓰기는 구현하지 않았습니다.

## 검증 및 패키징

```sh
npm test
npm run package
code --install-extension column-explorer-0.1.5.vsix
```

통합 테스트는 설치된 macOS VS Code를 우선 사용하며 없으면 테스트용 VS Code를 다운로드합니다. 다른 실행 파일은 `VSCODE_EXECUTABLE_PATH`로 지정할 수 있습니다. 임시 워크스페이스와 별도 사용자 프로필을 사용합니다.

## 구조 및 범위

`src/extension.ts`는 명령과 패널 생성, `explorerProvider.ts`는 상태/메시지/변경 감지, `fileService.ts`는 검증과 파일 API, `messageTypes.ts`는 통신 타입을 담당합니다. `media/`는 별도 Webview UI입니다.

Phase 1과 Phase 2 기능을 포함합니다. 사이드바, 열 너비 조절, 검색, 파일 관리, Marketplace 배포는 미구현입니다. 다중 루트 및 원격 환경의 실기기 검증은 별도로 필요합니다. 매우 큰 폴더는 비동기 로딩하지만 목록 가상화는 아직 없습니다.

공식 API: https://code.visualstudio.com/api/references/vscode-api

## 현재 검증 결과

macOS의 VS Code 1.139.1 Extension Development Host에서 `npm test`를 통과했습니다. 파일 서비스/탐색 상태 통합 테스트, 5개 Webview 상호작용 테스트, 실제 Webview 클릭 테스트를 포함합니다. 실제 UI에서 4개 열 생성, 빈 폴더, 상위 선택 변경, 메타데이터, 숨김 파일, 정렬, 컨텍스트 메뉴를 확인했습니다. 캡처는 `artifacts/column-explorer.png`에 있습니다.

외부 앱 실행, Finder 표시, Windows/Linux 및 원격 환경은 자동 테스트에서 실제 실행하지 않았습니다.

에디터 오른쪽 위의 세 장이 겹친 모양의 FinderView 아이콘을 클릭해도 탐색기가 열립니다. 이미 열려 있으면 기존 탭으로 이동합니다.

아이콘을 누르면 해당 에디터에서 보고 있던 파일의 폴더까지 열을 펼치고 파일을 선택합니다. 이미 열려 있는 FinderView도 현재 파일 위치로 이동합니다. Welcome/Untitled 등 파일 위치가 없는 화면은 기본 워크스페이스를 사용하며, FinderView에서 다시 누르면 탐색 위치를 유지합니다.

기본 파일 목록은 VS Code `files.exclude`를 반영합니다. `explorer.excludeGitIgnore`가 켜져 있으면 Git 무시 규칙도 반영합니다. 점(.) 파일은 기본 표시하며 툴바에서 추가로 숨길 수 있습니다. macOS `UF_HIDDEN` 속성은 필터링하지 않습니다. VS Code의 파일 중첩 표시는 적용하지 않고 항목별로 표시합니다.

파일 더블클릭/Enter는 기본 외부 앱으로 열고, 폴더 클릭/Enter는 하위 폴더로 이동합니다. VS Code에서 열기는 우클릭 메뉴로 사용할 수 있습니다.
