import { setStyle } from './style.js';
import { load, save } from './settings.js';
import { isChatVisible } from './layout.js';

/**
 * 채팅 패널 폭 조절.
 *
 * 페이지는 #chat-container의 폭을 CSS에 350px로 하드코딩하고, adjustLayout()의 가용 폭
 * 계산에도 같은 값을 박아뒀다. 폭을 바꾸면 페이지 계산은 어긋나지만 layout.js가 우리 값으로
 * 다시 계산해 !important로 덮으므로 문제되지 않는다.
 */

const DEFAULT_WIDTH = 350;
const MIN_WIDTH = 240;
const RESIZER_WIDTH = 6;
const RESIZER_ID = 'mlpp-resizer';

function maxWidth() {
  return Math.max(MIN_WIDTH, Math.floor(window.innerWidth * 0.6));
}

/** @param {number} w */
function clampWidth(w) {
  return Math.min(maxWidth(), Math.max(MIN_WIDTH, Math.round(w)));
}

/**
 * @param {import('./dom.js').Hooks} hooks
 * @returns {{ reservedWidth: () => number, schedule: (fn: () => void) => void }}
 */
export function setupChatResizer(hooks) {
  // 사용자가 고른 값. 창 크기 때문에 절대 덮어쓰지 않는다.
  // 클램프를 이 값에 직접 적용하면, 창이 좁은 순간에 로드됐을 때 하한으로 눌린 뒤
  // 창을 넓혀도 원래 폭이 복구되지 않는다.
  let preferred = Number(load('chatWidth', DEFAULT_WIDTH)) || DEFAULT_WIDTH;
  /** 실제로 적용되는 폭. 현재 창 크기에 맞춰 매번 다시 계산한다. */
  const effective = () => clampWidth(preferred);
  /** @type {(() => void) | null} */
  let onChange = null;

  const resizer = document.createElement('div');
  resizer.id = RESIZER_ID;
  resizer.title = '채팅 폭 조절 (더블클릭: 기본값)';
  // #chat-container 앞에 형제로 끼워넣는다. 기존 노드를 옮기는 것이 아니므로 iframe이 리로드되지 않는다.
  hooks.chatContainer.before(resizer);

  function paint() {
    const visible = isChatVisible(hooks);
    const width = effective();
    setStyle(
      'chat',
      `#chat-container {
  flex: 0 0 ${width}px !important;
  width: ${width}px !important;
  max-width: none !important;
}
#${RESIZER_ID} {
  display: ${visible ? 'block' : 'none'} !important;
  flex: 0 0 ${RESIZER_WIDTH}px !important;
  align-self: stretch !important;
  background-color: #222 !important;
  border-left: 1px solid #3a3a3a !important;
  cursor: col-resize !important;
  transition: background-color 120ms ease-in-out !important;
}
#${RESIZER_ID}:hover, #${RESIZER_ID}.mlpp-dragging {
  background-color: #555 !important;
}`,
    );
  }

  /** @param {number} next */
  function setWidth(next) {
    const w = clampWidth(next);
    if (w === preferred) return;
    preferred = w;
    paint();
    onChange?.();
  }

  /** 창 크기가 바뀌면 preferred는 그대로 두고 적용값만 다시 그린다. */
  function repaint() {
    paint();
    onChange?.();
  }

  /** @type {HTMLDivElement | null} */
  let shield = null;

  /**
   * 드래그 중에는 화면 전체를 덮는 투명 레이어를 깐다.
   * 포인터 캡처만으로도 이벤트는 오지만, 커서 모양이 iframe 위에서 흔들리고
   * 플레이어가 실수로 눌리는 것을 막기 위해 함께 쓴다.
   */
  function addShield() {
    shield = document.createElement('div');
    shield.style.position = 'fixed';
    shield.style.inset = '0';
    shield.style.zIndex = '2147483646';
    shield.style.cursor = 'col-resize';
    document.body.append(shield);
  }

  function removeShield() {
    shield?.remove();
    shield = null;
  }

  /** @param {PointerEvent} e */
  function onMove(e) {
    // 리사이저 중앙이 커서에 오도록 맞춘다.
    setWidth(window.innerWidth - e.clientX - RESIZER_WIDTH / 2);
  }

  function endDrag() {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', endDrag);
    document.removeEventListener('pointercancel', endDrag);
    resizer.classList.remove('mlpp-dragging');
    removeShield();
    save('chatWidth', preferred);
  }

  resizer.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    // 포인터 캡처는 창 밖으로 나가도 이벤트를 받기 위한 보강일 뿐이다.
    // 실패해도 문서 레벨 리스너 + 실드로 드래그가 성립해야 한다.
    try {
      resizer.setPointerCapture(e.pointerId);
    } catch {
      /* 캡처 없이 진행 */
    }
    resizer.classList.add('mlpp-dragging');
    addShield();
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', endDrag);
    document.addEventListener('pointercancel', endDrag);
  });

  resizer.addEventListener('dblclick', () => {
    setWidth(DEFAULT_WIDTH);
    save('chatWidth', preferred);
  });

  // 채팅 열기/닫기 시 리사이저 표시 여부를 맞춘다.
  new MutationObserver(paint).observe(hooks.chat, {
    attributes: true,
    attributeFilter: ['src'],
  });
  window.addEventListener('resize', repaint); // 상한이 바뀌므로 적용값을 다시 계산한다

  paint();

  return {
    reservedWidth: () => effective() + RESIZER_WIDTH,
    schedule: (fn) => {
      onChange = fn;
    },
  };
}
