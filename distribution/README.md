# FinderView 배포 안내

Marketplace 게시자: **magon8696**  
확장 ID: **magon8696.finderview**

## 배포 파일

- [FinderView-0.2.2.vsix](vsix/FinderView-0.2.2.vsix): 최신 업데이트 — Shift 드래그 안내 글씨 확대 및 강조 배지.
- [FinderView-0.2.1.vsix](vsix/FinderView-0.2.1.vsix): 외부 파일 Shift 드롭, 폴더 클릭 토글, 우클릭 삭제, 최근 수정순 정렬.
- [FinderView-0.2.0.vsix](vsix/FinderView-0.2.0.vsix): 파일 관리 기능 최초 추가 버전.
- [FinderView-0.1.5.vsix](vsix/FinderView-0.1.5.vsix): 최초 제출 패키지 보관본.
- [SHA256SUMS](SHA256SUMS): 패키지의 SHA-256 체크섬입니다.
- [publisher-logo-128.png](publisher-logo-128.png): 게시자 프로필용 128×128 PNG 로고입니다.

확장 자체의 Marketplace 로고는 소스의 `media/icon.png`를 사용하며 VSIX 안에 포함되어 있습니다.

## VSIX 다운로드 및 직접 설치

GitHub에서 위 VSIX 링크를 연 뒤 **Download raw file**로 다운로드합니다.

VS Code에서 확장 탭 → `⋯` → **Install from VSIX…** → 다운로드한 파일을 선택합니다. 또는 터미널에서 실행합니다.

```sh
code --install-extension FinderView-0.2.2.vsix
```

로컬 소스를 빌드하거나 Node.js를 설치하지 않고도 VSIX를 설치할 수 있습니다. 설치 후 명령 팔레트에서 **FinderView: Open**을 실행하거나 에디터 오른쪽 위 FinderView 로고를 클릭합니다.

## Marketplace에 처음 올리기

1. [게시자 관리 페이지](https://marketplace.visualstudio.com/manage)에 게시자 계정으로 로그인합니다.
2. **JiHun Choi (magon8696)** 게시자를 선택합니다.
3. **New extension → Visual Studio Code**를 선택합니다.
4. 최신 `FinderView-0.2.2.vsix`를 업로드하고 **Upload**를 클릭합니다.
5. `Verifying` 상태가 끝나는지 확인합니다. 오류가 있으면 상세 메시지를 확인합니다.
6. 검증·게시 및 검색 반영 후 VS Code 확장 탭에서 `FinderView` 또는 아래 ID를 검색합니다.

```text
@id:magon8696.finderview
```

Marketplace 주소: https://marketplace.visualstudio.com/items?itemName=magon8696.finderview

0.1.5는 이미 제출한 버전입니다. 현재 0.2.2는 기존 FinderView 항목의 **Update** 메뉴로 올립니다. GitHub에 푸시하는 것만으로 Marketplace가 자동 업데이트되지는 않습니다.

## 수정 후 새 버전 만들기

소스 빌드에는 Node.js 22 이상이 필요합니다. 프로젝트 루트에서 실행합니다.

```sh
npm ci
npm version patch --no-git-tag-version
```

`CHANGELOG.md`에 새 버전의 변경 내용을 기록한 뒤 검증하고 패키징합니다.

```sh
npm test
npm run package
```

버전이 `0.2.3`이라면 프로젝트 루트에 `finderview-0.2.3.vsix`가 생성됩니다. 생성된 파일을 이 폴더에 보관합니다.

```sh
release_version=$(node -p "require('./package.json').version")
cp "finderview-${release_version}.vsix" "distribution/vsix/FinderView-${release_version}.vsix"
(cd distribution && shasum -a 256 vsix/*.vsix > SHA256SUMS)
```

README의 배포 파일 목록도 갱신하고 소스·잠금 파일·변경 내역·새 VSIX를 함께 커밋합니다. 같은 버전 번호의 파일을 교체하는 대신 새 버전 번호를 사용합니다.

## Marketplace 업데이트

1. [게시자 관리 페이지](https://marketplace.visualstudio.com/manage)에서 기존 **FinderView** 항목을 찾습니다.
2. 해당 항목의 `⋯` 메뉴에서 **Update**를 선택합니다.
3. 새 버전 VSIX를 업로드합니다. **New extension**으로 별도 확장을 만들지 않습니다.
4. 검증 상태와 공개 페이지의 버전을 확인합니다.

후속 버전에서도 `package.json`의 `name: finderview`와 `publisher: magon8696`는 유지합니다.

## 패키지 확인

```sh
(cd distribution && shasum -a 256 -c SHA256SUMS)
```

VSIX에는 실행 코드·런타임 의존성·로고·공개 문서를 포함합니다. `distribution/`, 개발 소스, 테스트, 테스트 캡처 등은 `.vscodeignore`로 패키징에서 제외합니다. 계정 비밀번호·인증 토큰을 이 폴더나 Git 저장소에 넣지 마세요. 웹 업로드 방식은 저장소에 인증 토큰을 보관할 필요가 없습니다.

공식 문서: [Publishing Extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
