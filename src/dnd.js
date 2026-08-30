import { setStyle } from './style.js';

/**
 * 영상 타일 위치 교환.
 *
 * iframe을 DOM에서 옮기면 리로드되므로 DOM은 건드리지 않는다.
 * 슬롯(화면상의 자리)과 스트림(방송)의 대응만 바꾸고 좌표는 배치 엔진이 다시 계산한다.
 * 그래서 교환해도 재생이 끊기지 않는다.
 *
 * 조작은 Alt(맥에서는 Option)를 누른 동안만 활성화된다.
 * 상시 핸들을 얹으면 플레이어 UI를 가리고 클릭을 먹기 때문에,
 * 평소 오버레이는 투명하고 pointer-events: none 이라 플레이어 조작을 전혀 방해하지 않는다.
 *
 * Alt를 알아내는 게 까다롭다. 키 이벤트는 포커스를 가진 문서에만 가는데,
 * 플레이어를 한 번 클릭하면 포커스가 교차 출처 iframe으로 넘어가 부모는 아무것도 못 받는다.
 * 그래서 셋을 겹쳐 쓴다.
 *
 * 1. 부모의 키 이벤트 — 포커스가 페이지에 있을 때
 * 2. 부모의 `mousemove.altKey` — 마우스 이벤트는 포커스와 무관하게 altKey를 싣고 온다
 * 3. 프레임 안 에이전트의 보고 — 포커스가 플레이어에 있을 때
 *
 * 커서가 부모 쪽 요소 위에 있으면 부모가 사실을 안다. 그때는 프레임이 남긴 표시를 싹 지운다.
 * (오버레이가 켜지는 순간 마우스는 부모 것이 되므로 프레임의 표시가 갇힐 일이 없다.)
 */

const MODIFIER_HINT = 'Alt(Option)을 누른 채 끌어서 위치 교환';

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
  cursor: grab !important;
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
html.mlpp-swap .mlpp-tile {
  display: flex !important;
  pointer-events: auto !important;
}
/* 잡기 전 호버는 색을 쓰지 않는다. 보라와 파랑은 끄는 동안의 뜻이 정해져 있다. */
html.mlpp-swap .mlpp-tile:hover { border-color: rgba(255, 255, 255, 0.7) !important; }
/* 잡은 곳은 보라, 놓을 곳은 파랑. */
.mlpp-tile.mlpp-from {
  border-color: #bb9af7 !important;
  background-color: rgba(187, 154, 247, 0.25) !important;
  cursor: grabbing !important;
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
 * @param {() => void} deps.schedule 다시 그리기를 요청한다
 */
export function createDragSwap({ root, labelOf, swap, schedule }) {
  /** @type {import('./geometry.js').Rect[]} */
  let rects = [];
  /** @type {Map<number, HTMLElement>} */
  const overlays = new Map();
  let active = false;
  /** 부모가 직접 본 Alt */
  let selfAlt = false;
  /** Alt를 누르고 있다고 알려온 프레임들 */
  const frameAlt = new Set();
  let from = -1;
  let over = -1;
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
    el.addEventListener('pointerdown', (e) => onDown(e, slot));
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
    // 이미 타일을 잡고 있으면 놓지 않는다. 끌던 도중에 Alt를 놓아도 드롭까지는 마치게 한다.
    if (!next && from >= 0) return;
    if (active === next) return;
    active = next;
    document.documentElement.classList.toggle('mlpp-swap', active);
    if (!active) endDrag(false);
  }

  function refresh() {
    setActive(selfAlt || frameAlt.size > 0);
  }

  /** @param {PointerEvent} e @param {number} slot */
  function onDown(e, slot) {
    if (!active || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    from = slot;
    over = slot;
    // iframe이 pointermove를 삼키지 않도록 화면 전체를 덮는다.
    shield = document.createElement('div');
    shield.style.cssText = 'position:fixed;inset:0;z-index:2147483646;cursor:grabbing';
    document.body.append(shield);
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onCancel);
    paint();
  }

  /** @param {PointerEvent} e */
  function onMove(e) {
    const next = slotAt(e.clientX, e.clientY);
    if (next === over) return;
    over = next;
    paint();
  }

  /** @param {PointerEvent} e */
  function onUp(e) {
    const target = slotAt(e.clientX, e.clientY);
    const source = from;
    endDrag(true);
    if (source >= 0 && target >= 0 && target !== source) {
      swap(source, target);
      schedule();
    }
    // 잡고 있는 동안 미뤄 둔 해제를 이제 반영한다.
    refresh();
  }

  function onCancel() {
    endDrag(true);
    refresh();
  }

  /** @param {boolean} repaint */
  function endDrag(repaint) {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', onCancel);
    shield?.remove();
    shield = null;
    from = -1;
    over = -1;
    if (repaint) paint();
  }

  window.addEventListener('keydown', (e) => {
    if (!e.altKey && e.key !== 'Alt') return;
    selfAlt = true;
    refresh();
  });
  window.addEventListener('keyup', (e) => {
    if (e.key !== 'Alt' && e.altKey) return;
    selfAlt = false;
    refresh();
  });
  // 커서가 부모 쪽에 있으면 부모가 사실을 안다. 프레임이 남긴 표시도 같이 정리한다.
  document.addEventListener('mousemove', (e) => {
    if (selfAlt === e.altKey && (e.altKey || frameAlt.size === 0)) return;
    selfAlt = e.altKey;
    if (!e.altKey) frameAlt.clear();
    refresh();
  });
  // 창 포커스를 잃어도 프레임 쪽은 살아 있을 수 있다. 부모 것만 푼다.
  window.addEventListener('blur', () => {
    selfAlt = false;
    refresh();
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) return;
    selfAlt = false;
    frameAlt.clear();
    refresh();
  });

  return {
    /**
     * 프레임 안 에이전트가 알려온 Alt 상태.
     * @param {number} index
     * @param {boolean} on
     */
    setFrameAlt(index, on) {
      if (on) frameAlt.add(index);
      else frameAlt.delete(index);
      refresh();
    },
    /** @param {import('./geometry.js').Rect[]} videoRects */
    update(videoRects) {
      rects = videoRects;
      paint();
    },
    hint: MODIFIER_HINT,
  };
}
