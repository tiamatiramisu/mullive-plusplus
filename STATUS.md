# mullive-plusplus STATUS

현재 버전: `v0.1.0` / GitHub: `tiamatiramisu/mullive-plusplus` / Greasy Fork: (미등록)

## 스테이지

- [~] Stage 0 — 스캐폴딩 + 릴리스 파이프라인 + CSP 스모크 테스트 `v0.1.0`
- [ ] Stage 2 — 채팅창 너비 조절 (F1) `v0.2.0`
- [ ] Stage 3 — 채팅 백그라운드 유지 (F2) `v0.3.0`
- [ ] Stage 4 — 영상 레이아웃 최적화 (F3) `v0.4.0`
- [ ] Stage 5 — 드래그 위치 교환 (F4) `v0.5.0`

Stage 1(업스트림 분석)은 `SPEC.md`로 완료.

### Stage 0 상세

- [x] esbuild 번들 + `meta.js` 배너 · 태그→`@version` 주입
- [x] `jsconfig.json` checkJs 타입체크
- [x] GitHub repo 생성 · SSH 원격 · 최초 push
- [x] 태그 릴리스 워크플로우 (`v0.1.0` 성공, 에셋 `mullive-plusplus.user.js` 5617 B)
- [x] Greasy Fork `release` 웹훅 등록 (hook id `671923702`, ping → 200 OK)
- [x] 페이지 훅 표 실사이트 검증
- [x] CSP 주입 경로 실측 → `style.js` 판정 로직 수정
- [ ] **Greasy Fork 스크립트 등록** (사용자 수동)
- [ ] **Violentmonkey 설치 후 스모크 테스트** (GM_addStyle 경로 확인)

## 다음 할 일

1. Greasy Fork에 스크립트 등록, 동기화 URL:
   `https://github.com/tiamatiramisu/mullive-plusplus/releases/latest/download/mullive-plusplus.user.js`
2. Violentmonkey에 `dist/mullive-plusplus.user.js`를 로컬 파일 추적으로 설치 → 스모크 테스트
   (콘솔 `[mullive-plusplus] v… booted`, `style` 모드값, `#chat-container` 초록 외곽선)
3. Stage 2 착수

## 알려진 이슈

- 페이지의 `message` 핸들러는 `e.source`를 **영상** iframe 목록에서만 찾는다.
  채팅 프레임이 보내는 `PonReady`는 `idx === -1`이 되어 `iframes[-1].name`에서 예외가 난다.
  현행(채팅 1개)에서도 발생하는 문제이며, Stage 3에서 채팅 iframe이 늘 때 빈도를 관측할 것.

## 검증 로그

### 2026-08-29 — Stage 0

**릴리스 파이프라인** — `v0.1.0` 태그 push → Actions 성공 → 릴리스 에셋 생성.
`https://github.com/tiamatiramisu/mullive-plusplus/releases/latest/download/mullive-plusplus.user.js`
→ HTTP 200, 배포된 파일의 `@version` = `0.1.0` (태그값 주입 확인).
웹훅 ping 배달 → Greasy Fork `200 OK`.

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
