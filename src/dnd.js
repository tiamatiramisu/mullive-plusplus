import { setStyle } from './style.js';

/**
 * 영상 타일 위치 교환.
 *
 * iframe을 DOM에서 옮기면 리로드되므로 DOM은 건드리지 않는다.
 * 슬롯(화면상의 자리)과 스트림(방송)의 대응만 바꾸고 좌표는 배치 엔진이 다시 계산한다.
 * 그래서 교환해도 재생이 끊기지 않는다.
 *
 * **그냥 좌클릭 드래그로 한다.** 예전에는 Alt를 누르는 동안만 켰는데,
 * 키 이벤트가 포커스를 가진 문서에만 가는 탓에 플레이어를 한 번 클릭하면 부모가 Alt를 영영 못 봤다.
 * 조합키를 없애니 그 문제가 통째로 사라진다.
 *
 * 좌클릭은 솔로 토글도 쓴다. 그래서 **클릭인지 드래그인지는 부모가 정한다** —
 * 프레임 에이전트는 누름(`ldown`)과 뗌(`lup`)만 보고하고,
 * 여기서 `DRAG_SLOP` 을 넘게 움직였는지로 가른다. 안 움직였으면 솔로 토글로 넘긴다.
 *
 * 오버레이는 **끌기 시작한 뒤에만** 보인다. 클릭할 때마다 깜빡이면 눈에 거슬리고,
 * 상시로 얹으면 플레이어 UI를 가린다. `pointer-events: none` 이라 표시 말고는 아무것도 하지 않는다 —
 * 어느 타일 위인지는 실드가 받은 좌표로 계산한다.
 */

const MODIFIER_HINT = '플레이어를 끌어서 위치 교환';
/** 이만큼 넘게 움직여야 클릭이 아니라 드래그로 본다 */
const DRAG_SLOP = 6;

const BASE_CSS = `
.mlpp-tile {
  position: absolute !important;
  z-index: 7 !important;
  display: none !important;
  align-items: flex-start !important;
  justify-content: center !important;
  box-sizing: border-box !important;
  padding-top: 10px !important;
  border: 3px solid rgba(255, 255, 255, 0.35) !important;
  border-radius: 6px !important;
  background-color: rgba(0, 0, 0, 0.4) !important;
  pointer-events: none !important;
  user-select: none !important;
}
/* 영상 밝기와 무관하게 읽히도록 라벨에 배경을 준다. */
.mlpp-tile-label {
  padding: 4px 10px !important;
  border-radius: 999px !important;
  background-color: rgba(17, 18, 20, 0.9) !important;
  color: #fff !important;
  font-size: 13px !important;
  font-weight: 700 !important;
  line-height: 1.2 !important;
  white-space: nowrap !important;
}
html.mlpp-swap .mlpp-tile { display: flex !important; }
/* 잡은 곳은 보라, 놓을 곳은 파랑. */
.mlpp-tile.mlpp-from {
  border-color: #bb9af7 !important;
  background-color: rgba(187, 154, 247, 0.25) !important;
}
.mlpp-tile.mlpp-over {
  border-color: #7aa2f7 !important;
  background-color: rgba(122, 162, 247, 0.25) !important;
}
`;

/**
 * @param {object} deps
 * @param {HTMLElement} deps.root 오버레이를 담을 컨테이너
 * @param {(slot: number) => string} deps.labelOf 슬롯에 지금 놓인 방송의 표시 이름
 * @param {(a: number, b: number) => void} deps.swap 두 슬롯의 방송을 맞바꾼다
 * @param {(slot: number, x: number, y: number) => void} deps.click 끌지 않고 놓았을 때
 * @param {() => void} deps.schedule 다시 그리기를 요청한다
 */
export function createDragSwap({ root, labelOf, swap, click, schedule }) {
  /** @type {import('./geometry.js').Rect[]} */
  let rects = [];
  /** @type {Map<number, HTMLElement>} */
  const overlays = new Map();
  let active = false;
  let from = -1;
  let over = -1;
  /** 슬롭을 넘겨 드래그로 확정됐는가 */
  let moved = false;
  let startX = 0;
  let startY = 0;
  /** @type {HTMLDivElement | null} */
  let shield = null;

  /** @param {number} slot */
  function ensureOverlay(slot) {
    const existing = overlays.get(slot);
    if (existing) return existing;
    const el = document.createElement('div');
    el.id = `mlpp-tile-${slot}`;
    el.className = 'mlpp-tile';
    const label = document.createElement('span');
    label.className = 'mlpp-tile-label';
    el.append(label);
    root.append(el);
    overlays.set(slot, el);
    return el;
  }

  /** @param {number} x @param {number} y */
  function slotAt(x, y) {
    return rects.findIndex((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
  }

  function paint() {
    const rules = [BASE_CSS];
    rects.forEach((r, slot) => {
      const el = ensureOverlay(slot);
      const label = el.querySelector('.mlpp-tile-label');
      if (label) label.textContent = labelOf(slot);
      el.classList.toggle('mlpp-from', slot === from);
      el.classList.toggle('mlpp-over', slot === over && slot !== from);
      rules.push(
        `#${el.id} { left: ${r.x}px !important; top: ${r.y}px !important; width: ${r.w}px !important; height: ${r.h}px !important; }`,
      );
    });
    // 남는 오버레이는 숨긴다(방송 수가 줄었을 때).
    for (const [slot, el] of overlays) {
      if (slot >= rects.length) rules.push(`#${el.id} { display: none !important; }`);
    }
    setStyle('dnd', rules.join('\n'));
  }

  /** @param {boolean} next */
  function setActive(next) {
    if (active === next) return;
    active = next;
    document.documentElement.classList.toggle('mlpp-swap', active);
  }

  /**
   * 프레임이 좌클릭을 눌렀다고 알려오면 부른다. 아직 드래그로 확정하지 않는다 —
   * 슬롭을 넘겨야 오버레이가 뜬다. 그냥 클릭일 때 화면이 깜빡이면 안 된다.
   * @param {number} slot
   * @param {number} x 문서 좌표
   * @param {number} y 문서 좌표
   */
  function begin(slot, x, y) {
    if (from >= 0 || slot < 0 || slot >= rects.length) return;
    from = slot;
    over = slot;
    moved = false;
    startX = x;
    startY = y;
    // iframe이 pointermove를 삼키지 않도록 화면 전체를 덮는다. 뗀 신호도 여기서 받는다.
    shield = document.createElement('div');
    shield.style.cssText = 'position:fixed;inset:0;z-index:2147483646';
    document.body.append(shield);
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', cancelDrag);
    document.addEventListener('keydown', onDragKey);
    window.addEventListener('blur', cancelDrag);
  }

  /** @param {PointerEvent} e */
  function onMove(e) {
    if (from < 0) return;
    if (!moved) {
      if (Math.abs(e.clientX - startX) + Math.abs(e.clientY - startY) <= DRAG_SLOP) return;
      moved = true;
      if (shield) shield.style.cursor = 'grabbing';
      setActive(true);
    }
    const next = slotAt(e.clientX, e.clientY);
    if (next === over) return;
    over = next;
    paint();
  }

  /** @param {PointerEvent} e */
  function onUp(e) {
    finish(e.clientX, e.clientY);
  }

  /**
   * 손을 뗐다. 끌었으면 자리를 맞바꾸고, 안 끌었으면 그냥 클릭으로 넘긴다.
   * @param {number} x
   * @param {number} y
   */
  function finish(x, y) {
    if (from < 0) return;
    const source = from;
    const dragged = moved;
    const target = slotAt(x, y);
    endDrag();
    if (!dragged) {
      click(source, x, y);
      return;
    }
    if (target >= 0 && target !== source) {
      swap(source, target);
      schedule();
    }
  }

  function cancelDrag() {
    if (from < 0) return;
    endDrag();
  }

  /** @param {KeyboardEvent} e */
  function onDragKey(e) {
    if (e.key === 'Escape') cancelDrag();
  }

  /** 실드가 남으면 페이지 전체가 먹통이 된다. 빠져나갈 길을 모두 여기서 정리한다. */
  function endDrag() {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', cancelDrag);
    document.removeEventListener('keydown', onDragKey);
    window.removeEventListener('blur', cancelDrag);
    shield?.remove();
    shield = null;
    from = -1;
    over = -1;
    moved = false;
    setActive(false);
    paint();
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) cancelDrag();
  });

  return {
    begin,
    finish,
    /** @param {import('./geometry.js').Rect[]} videoRects */
    update(videoRects) {
      rects = videoRects;
      paint();
    },
    hint: MODIFIER_HINT,
  };
}
