# mullive-plusplus STATUS

현재 버전: `v0.1.0` / GitHub: `tiamatiramisu/mullive-plusplus` / Greasy Fork: [593484](https://greasyfork.org/ko/scripts/593484)

## 스테이지

- [~] Stage 0 — 스캐폴딩 + 릴리스 파이프라인 + CSP 스모크 테스트 `v0.1.0`
- [~] Stage 2 — 채팅창 너비 조절 (F1) `v0.2.0` — 코드 완료, 브라우저 검증 대기
- [ ] Stage 3 — 채팅 백그라운드 유지 (F2) `v0.3.0`
- [ ] Stage 4 — 영상 레이아웃 최적화 (F3) `v0.4.0`
- [ ] Stage 5 — 드래그 위치 교환 (F4) `v0.5.0`

Stage 1(업스트림 분석)은 `SPEC.md`로 완료.

### Stage 0 상세

- [x] esbuild 번들 + `meta.js` 배너 · 태그→`@version` 주입
- [x] `jsconfig.json` checkJs 타입체크
- [x] GitHub repo 생성 · SSH 원격 · 최초 push
- [x] 태그 릴리스 워크플로우 (`v0.1.0` 성공, 에셋 `mullive-plusplus.user.js` 6044 B)
- [x] Greasy Fork `release` 웹훅 등록 (hook id `671923702`, ping → 200 OK)
- [x] 페이지 훅 표 실사이트 검증
- [x] CSP 주입 경로 실측 → `style.js` 판정 로직 수정
- [x] Greasy Fork 스크립트 등록 (id `593484`, 언어 JavaScript, 동기화 `자동`)
- [ ] **Violentmonkey 설치 후 스모크 테스트** (GM_addStyle 경로 확인)

## 다음 할 일

1. Violentmonkey에 `dist/mullive-plusplus.user.js`를 로컬 파일 추적으로 설치 → 스모크 테스트
   (콘솔 `[mullive-plusplus] v… booted`, `style` 모드값, `#chat-container` 초록 외곽선)
2. Stage 2 착수
3. `v0.2.0` 릴리스 때 Greasy Fork 동기화 유형이 `자동`에서 `웹훅`으로 전환되는지 배달 로그로 확인

## 알려진 이슈

- **자동 배치의 커버리지가 낮다.** 현재 엔진은 "16:9 타일을 가장 크게" 만 기준으로 삼는다.
  1920×1080 + 채팅 356px에서 3분할이면 2×2(779×438)를 골라 가용 영역의 60.8%만 덮는다.
  타일을 키우는 것과 영역을 채우는 것이 다른 목표라서 생기는 문제이며 Stage 4에서 다룬다.
- **flex 줄바꿈은 계산된 열 수를 강제하지 않는다.** 타일 폭만 지정하므로 실제 줄바꿈은 브라우저가 정한다.
  현재까지 확인된 케이스에서는 계산과 일치하지만, 원리상 어긋날 수 있다. Stage 4에서 CSS Grid로 전환하며 해소한다.
- 페이지의 `message` 핸들러는 `e.source`를 **영상** iframe 목록에서만 찾는다.
  채팅 프레임이 보내는 `PonReady`는 `idx === -1`이 되어 `iframes[-1].name`에서 예외가 난다.
  현행(채팅 1개)에서도 발생하는 문제이며, Stage 3에서 채팅 iframe이 늘 때 빈도를 관측할 것.

## 검증 로그

### 2026-08-29 — Stage 0

**릴리스 파이프라인** — `v0.1.0` 태그 push → Actions 성공 → 릴리스 에셋 생성.
`https://github.com/tiamatiramisu/mullive-plusplus/releases/latest/download/mullive-plusplus.user.js`
→ HTTP 200, 배포된 파일의 `@version` = `0.1.0` (태그값 주입 확인).
웹훅 배달 → Greasy Fork 전부 `200 OK` (`ping`, `release.created/published/released/edited/deleted`).

**개명** — 공식 확장 "Mul.Live Plus"와의 혼동을 피해 repo·산출물·콘솔 태그를 `mullive-plusplus`로 변경.
repo 이름을 바꿔도 웹훅(id `671923702`)은 그대로 유지됨을 확인. Greasy Fork 등록 전이라
기존 `v0.1.0` 릴리스·태그를 삭제하고 새 이름으로 다시 잘랐다.

**페이지 훅** — 실제 Chrome, `https://mul.live/khm11903/phonics1/ecvhao` (SOOP 3개), 뷰포트 560×862:

| 항목 | 결과 |
|---|---|
| `#streams` `#chat-container` `#chat` `#chat-select` `#chat-toggle` | 전부 존재 |
| `#chat-container` 계산된 width | `350px` (하드코딩 확인) |
| 영상 iframe `name` | `khm11903` `phonics1` `ecvhao` — 스트림 id와 일치 |
| 영상 iframe 인라인 style | `width:202px; height:113px; flex-grow:0` — 페이지 `adjustLayout()`이 인라인으로 쓰는 것 확인 |
| `#streams` 계산된 display | `flex` / `flex-wrap: wrap` |
| `#chat-select` 옵션 | SOOP 3개 + `about:blank`(숨기기). **`disabled` 없음 → Mul.Live Plus 확장 활성** |
| 페이지 전역 함수 | `adjustLayout`, `setName` 모두 `function` |

**CSP 주입 경로** — 같은 탭, 페이지 컨텍스트에서 직접 시도:

| 경로 | 결과 |
|---|---|
| `<style>` 요소 삽입 | **차단**. `securitypolicyviolation` (`style-src-elem`, blocked=`inline`), 외곽선 미적용 |
| `adoptedStyleSheets` + `replaceSync` | **통과**. 위반 없음, 외곽선 정상 적용 |

→ `style.js`의 성공 판정을 `isConnected`(막힌 요소도 true)에서 **센티넬 커스텀 속성 계산값**으로 변경.

**미검증** — `GM_addStyle` 경로는 유저스크립트 매니저가 필요해 아직 확인 못 함.

### 2026-08-29 — Greasy Fork 등록

동기화 URL `https://github.com/tiamatiramisu/mullive-plusplus/releases/latest/download/mullive-plusplus.user.js`
로 가져오기 완료. 스크립트 id `593484`, 표시 버전 `0.1.0`, 라이선스 MIT.
릴리스 에셋 경로에서 정상적으로 코드를 당겨왔음을 확인.

### 2026-08-29 — Stage 2 레이아웃 계산 점검 (node, 브라우저 없이)

`computeGrid(n, availW, availH, gap=4)` 결과. 모든 케이스에서 가용 영역을 넘지 않음.

| 상황 | 배치 | 타일 | 차지/가용 | 덮음 |
|---|---|---|---|---|
| 1920×1080, 채팅 356, n=2 | 1×2 | 954×537 | 954×1078 / 1562×1078 | 60.8% |
| 1920×1080, 채팅 356, n=3 | 2×2 | 779×438 | 1562×880 | 60.8% |
| 1920×1080, 채팅 356, n=4 | 2×2 | 779×438 | 1562×880 | 81.1% |
| 1920×1080, 채팅 356, n=6 | 2×3 | 632×356 | 1268×1076 | 80.2% |
| 1920×1080, 채팅 닫힘, n=3 | 2×2 | 954×537 | 1912×1078 | 74.3% |
| 1920×1080, 채팅 806, n=3 | 1×3 | 632×356 | 632×1076 | 56.3% |
| 1080×1920(세로), 채팅 356, n=4 | 1×4 | 722×406 | 722×1636 | 84.7% |

경계값: `n=0` → `null`, 음수 폭 → `null`, 20×20 영역 → `8×4` 타일(비정상 종료 없음).
