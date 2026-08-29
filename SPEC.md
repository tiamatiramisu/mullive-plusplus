# mullive-plus SPEC

Mul.Live(https://mul.live)에 얹는 유저스크립트. 사이트를 포크하지 않고 기존 페이지를 강화한다.

## 대상 / 스코프

- `@match https://mul.live/*`, `https://www.mul.live/*`
- 스트림이 없는 랜딩 페이지에서는 훅을 못 찾으므로 자동 no-op.
- **SOOP 인스턴스 전용으로 개발·검증한다.** chzzk/트위치/유튜브는 대상이 아니며 플랫폼별 특수 처리를 넣지 않는다.
  (채팅 멀티플렉서 등은 플랫폼 구분 없는 코드가 더 단순하므로 결과적으로 함께 동작할 수 있으나, 검증하지 않는다.)
- SOOP 채팅은 Mul.Live Plus 확장 프로그램이 있어야 활성화된다. 확장 미설치 시 해당 옵션은 `disabled`이며 스크립트는 이를 건너뛴다.

## 업스트림 구조

`jebibot/mullive`는 Cloudflare Worker 단일 파일(`src/index.ts`)이 HTML 전체를 문자열로 생성한다.
프레임워크·번들러·클래스명 없음. 아래 id들이 훅의 전부다.

## 페이지 훅

| 셀렉터 | 내용 |
|---|---|
| `#streams` | 영상 컨테이너. `display:flex; flex-wrap:wrap` |
| `#streams iframe` | 영상 iframe. `name` = 스트림 id (숫자 id면 `#id`) |
| `#chat-container` | 채팅 패널. **`width: 350px` 하드코딩** |
| `#chat-select` | 채팅 선택 `<select>`. `option[value]` = 채팅 URL, 마지막 항목은 `about:blank`(숨기기) |
| `#chat-select option[disabled]` | 확장 프로그램 필요 (SOOP) |
| `#chat` | 채팅 iframe **1개**. `src` 교체로 채널 전환 → 전환할 때마다 전체 리로드 |
| `#chat-toggle` | 채팅 열기/닫기. `chat.src`를 `about:blank`와 토글 |

페이지 전역 스크립트가 하는 일:

- `adjustLayout()` — `resize`와 `#chat`의 `load`에서 호출. cols 1..n을 순회해 16:9 최대 타일을 찾고 iframe에 **인라인** `style.width/height`를 쓴다. 가용 폭 계산에 **350을 하드코딩**한다.
- `setName(i, name)` — 스트리머 이름을 `#chat-select`의 옵션 텍스트에 반영.
- `message` 리스너 — `https://play.sooplive.com` 출처의 `PonReady` / `PupdateBroadInfo` / `showRefreshOverlay` 처리.
- `securitypolicyviolation` 리스너 — `https://nid.naver.com` 차단 시 네이버 로그인 창을 연다.

## 제약 (설계를 강제하는 사실)

1. **CSP**: `script-src 'nonce-…'; style-src 'nonce-…'`, `unsafe-inline` 없음. HTTP 헤더로만 전달된다(meta 태그 없음).
   → `@grant none`이면 주입 자체가 차단된다. GM API를 최소 1개 grant해 샌드박스 컨텍스트로 실행해야 한다.
   → 스타일 주입은 `src/style.js`의 3단 폴백(GM_addStyle → adoptedStyleSheets → `<style>`)을 통한다.

   **2026-08-29 실측** (페이지 컨텍스트에서 직접 확인):
   - `<style>` 요소 삽입 → **차단됨**. `style-src-elem` 위반 이벤트 발생, 스타일 미적용.
   - `document.adoptedStyleSheets` + `CSSStyleSheet.replaceSync` → **통과**. 위반 없이 정상 적용.

   CSP에 막힌 `<style>` 요소도 DOM에 남아 `isConnected === true`이므로, 주입 성공 여부는
   **요소의 존재가 아니라 효과로 판정해야 한다.** `style.js`는 센티넬 커스텀 속성(`--mlp-style-ok`)이
   계산된 스타일에 반영됐는지로 각 단계를 검증한다.
2. **iframe을 DOM에서 옮기면 리로드된다.** 타일 위치 교환은 DOM 이동 없이 CSS 좌표만 바꾼다.
3. 페이지 `adjustLayout()`은 **인라인 style**을 쓴다. 우리 규칙은 전부 `!important`로 준다. 메인 월드 접근이나 함수 패치는 불필요.
4. 새 iframe은 페이지 `frame-src` 화이트리스트 안이어야 한다.
   허용: `'self'`, `chzzk.naver.com`, `*.chzzk.naver.com`, `*.twitch.tv`, `*.sooplive.com`, `www.youtube.com`.
   `#chat-select`의 모든 채팅 URL이 이 안에 들어가므로 채팅 iframe 추가 생성은 가능하다.
5. 페이지 리스너를 떼어낼 수 없다(함수 참조 접근 불가). `document`의 **캡처 단계**에서 `stopPropagation()`으로 선점한다.
   페이지 JS가 `#chat` 등의 참조를 들고 있으므로 해당 요소는 DOM에 남겨둔다.

## 기능

### F1. 채팅창 너비 조절
- `#chat-container`와 `#streams` 사이의 리사이저 바를 드래그해 폭 조절. 더블클릭 시 350px로 리셋.
- 범위 `[240px, 뷰포트 폭 * 0.6]`.
- 폭은 전역으로 영속화된다.
- 수용 기준: 드래그 중 영상 타일이 즉시 재배치되고, 새로고침 후 폭이 유지되며, 채팅을 닫으면 영상이 전체 폭을 쓴다.

### F2. 채팅 백그라운드 유지
- 채팅별 iframe을 각각 하나씩 보유하고, 활성 채팅만 보이게 한다. 전환 시 리로드되지 않는다.
- 비활성 채팅은 크기를 유지한 채 숨긴다(`display:none` 금지 — 크기가 0이 되면 채팅이 내려가지 않는다).
- 기본 정책은 lazy keep-alive(최초 선택 시 생성 후 유지). 옵션으로 전부 미리 로드.
- `disabled` 옵션은 생성 대상에서 제외.
- 수용 기준: A↔B를 여러 번 전환해도 각 채팅의 누적 메시지와 스크롤 위치가 유지되고, 전환 시 해당 채팅의 네트워크 재요청이 없다.

### F3. 영상 레이아웃
- `auto` — 가용 영역(뷰포트 − 채팅 폭 − gap)을 16:9 타일로 최대한 덮는 배치. 마지막 행 잔여 타일은 중앙 정렬.
- `manual` — `m × n` 직접 지정.
- 수용 기준: 스트림 2·3·4·6개 × 창 비율 × 채팅 열림/닫힘 조합에서 잘림 없이 여백이 최소가 된다.

### F4. 드래그 위치 교환
- 타일 상단 핸들을 드래그해 두 타일의 위치를 교환한다. 레이아웃 모드/그리드는 고정.
- 순서는 `location.pathname` 단위로 영속화.
- 수용 기준: 교환 후 두 영상 모두 **재생이 끊기지 않는다**(끊기면 DOM을 옮긴 것이므로 실패). 플레이어 컨트롤 클릭이 정상 동작한다.

## 설정 스키마

| 키 | 타입 | 기본값 |
|---|---|---|
| `chatWidth` | number(px) | 350 |
| `chatKeepAlive` | enum | `lazy` \| `all` \| `off` (기본 `lazy`) |
| `layoutMode` | enum | `auto` \| `manual` (기본 `auto`) |
| `layoutCols` / `layoutRows` | number | manual 모드에서만 사용 |
| `tileGap` | number(px) | 4 |
| `order:<pathname>` | string[] | 스트림 id 배열 |

## 스코프 제외

- 1대형 + N소형 포커스 배치, PiP
- 채팅 필터/알림/통합 채팅
- 스트림 추가·제거 UI (URL 편집은 사이트 기능)
- chzzk 네이버 로그인 흐름 등 SOOP 외 플랫폼 특수 처리
