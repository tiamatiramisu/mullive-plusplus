/**
 * 채팅 iframe 안에서 도는 쪽.
 *
 * 채팅 칸을 닫는 조작 하나만 받는다. 부모는 교차 출처라 채팅 위의 클릭을 볼 수 없고,
 * 그렇다고 채팅 위에 상시 오버레이를 얹으면 스크롤도 입력도 다 막힌다.
 * 그래서 프레임 안에서 Shift+우클릭만 가로채 부모에 알린다.
 *
 * 그냥 우클릭은 건드리지 않는다. 채팅에서 닉네임 메뉴나 복사를 쓰는 사람이 있다.
 */

const PARENT_ORIGIN = /^https:\/\/(www\.)?mul\.live$/;

/** @type {string | null} 부모가 인사해 온 origin. 확인되기 전에는 아무것도 보내지 않는다. */
let parentOrigin = null;

export function startChatAgent() {
  if (window.top === window) return;

  window.addEventListener('message', (e) => {
    if (!PARENT_ORIGIN.test(e.origin)) return;
    const data = /** @type {{ mlpp?: unknown, kind?: string } | null} */ (e.data);
    if (data && data.mlpp === true && data.kind === 'hello') parentOrigin = e.origin;
  });

  window.addEventListener(
    'contextmenu',
    (e) => {
      if (!e.shiftKey || !parentOrigin) return;
      e.preventDefault();
      e.stopPropagation();
      window.parent.postMessage({ mlpp: true, kind: 'close' }, parentOrigin);
    },
    true,
  );

  // 부모가 우리보다 먼저 준비됐을 수도, 나중일 수도 있다. 양쪽에서 인사한다.
  window.parent.postMessage({ mlpp: true, kind: 'chatagent' }, '*');
}
