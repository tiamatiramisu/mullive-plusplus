import { setStyle } from './style.js';
import * as settings from './settings.js';
import { columnLayout, masterStackLayout, sideLayout } from './geometry.js';
import * as panes from './panes.js';
import { zoneAt, previewRect } from './dropzone.js';
import { createDragSwap } from './dnd.js';
import { showToast } from './toast.js';

/**
 * 배치 적용과 사용자 조작.
 *
 * 모든 iframe을 절대 위치로 놓는다. flex/grid로 흐름을 잡지 않는 이유는,
 * "영상 위 / 그 아래 자기 채팅" 구조를 만들려면 DOM을 열 단위로 묶어야 하는데
 * iframe을 DOM에서 옮기면 리로드되기 때문이다. 좌표만 바꾸면 재생이 끊기지 않는다.
 */

const RESIZER_WIDTH = 6;
/** 사이드 모드에서 채팅 선택 select가 차지하는 높이 */
const SELECT_HEIGHT = 28;
const MIN_CHAT_WIDTH = 240;
/** 쪼갠 채팅 한 칸의 하한. 이보다 작아지면 칸을 더 늘리지 않는다. */
const MIN_PANE_WIDTH = 240;
const MIN_PANE_HEIGHT = 200;
const DEFAULT_CHAT_WIDTH = 350;
/** 열 모드로 갈지 정하는 기준. 열 하나의 폭이 곧 영상 폭이자 채팅 폭이다. */
const MIN_COLUMN_WIDTH = 400;
/** 타일 사이 여백. 붙여 놓는 편이 낫다고 판단해 고정한다. */
const TILE_GAP = 0;
/** 이만큼 넘게 움직여야 클릭이 아니라 드래그로 본다 */
const DRAG_SLOP = 6;
/** 손을 뗀 뒤 우클릭 메뉴를 막아 두는 시간. 윈도우는 mouseup 뒤에 메뉴가 온다. */
const MENU_GRACE_MS = 300;
/** 마스터를 바꾼 직후, 커서 밑으로 들어온 화면의 호버를 무시하는 시간 */
const HOVER_GRACE_MS = 700;

const BASE_CSS = `
#streams {
  position: absolute !important;
  inset: 0 !important;
  display: block !important;
  width: auto !important;
  height: auto !important;
  min-width: 0 !important;
  pointer-events: none !important;
}
/* 층 순서: 채팅(1) < 자리표시자(2) < 솔로 글로우(3) < 영상(4) < 리사이저(5) < select(6) < 드래그 타일(7).
   글로우가 채팅 위에 보여야 열 모드에서 솔로 단서가 가려지지 않고,
   영상 아래여야 이웃 화면을 가리지 않는다. */
#streams iframe {
  position: absolute !important;
  z-index: 4 !important;
  flex: none !important;
  aspect-ratio: auto !important;
  pointer-events: auto !important;
}
#chat-container { display: none !important; }
#mlpp-chats {
  position: absolute !important;
  inset: 0 !important;
  pointer-events: none !important;
}
#mlpp-chats iframe {
  position: absolute !important;
  z-index: 1 !important;
  border: 0 !important;
  background-color: #141517 !important;
  pointer-events: auto !important;
}
/* 개별 규칙(#mlpp-ph-N)이 이기도록 특정도를 낮게 둔다. audio.js 의 같은 주석 참고. */
.mlpp-placeholder {
  position: absolute !important;
  z-index: 2 !important;
  display: none !important;
  align-items: center !important;
  justify-content: center !important;
  background-color: #141517 !important;
  color: #8a8f98 !important;
  font-size: 14px !important;
  pointer-events: none !important;
}
/* 페이지의 채팅 드롭다운은 감춘다. 우클릭과 설정 패널이 그 일을 대신한다.
   값은 계속 맞춰 둔다 — 드래그 라벨이 이 select 의 옵션 텍스트를 읽는다. */
#chat-select { display: none !important; }
/* 드롭 표시. 드래그 타일(7)보다 위에 둔다. */
#mlpp-dropbg, #mlpp-drop {
  position: absolute !important;
  z-index: 8 !important;
  display: none !important;
  box-sizing: border-box !important;
  pointer-events: none !important;
}
#mlpp-dropbg {
  border: 2px dashed rgba(255, 255, 255, 0.3) !important;
  background-color: rgba(0, 0, 0, 0.28) !important;
}
#mlpp-drop {
  border: 2px solid #7aa2f7 !important;
  border-radius: 4px !important;
  background-color: rgba(122, 162, 247, 0.28) !important;
}
/* 잡는 영역은 세로 전체로 넓게 두되, 보이는 것은 가운데의 짧은 그립뿐이다.
   막대를 세로로 길게 그리면 영상과 채팅 사이에 경계선이 생겨 눈에 거슬린다. */
#mlpp-resizer {
  position: absolute !important;
  z-index: 5 !important;
  background-color: transparent !important;
  border: 0 !important;
  cursor: col-resize !important;
  pointer-events: auto !important;
}
#mlpp-resizer::after {
  content: '' !important;
  position: absolute !important;
  left: 1px !important;
  right: 1px !important;
  top: 50% !important;
  height: 56px !important;
  transform: translateY(-50%) !important;
  border-radius: 2px !important;
  background-color: rgba(255, 255, 255, 0.1) !important;
  transition: background-color 120ms ease-in-out, height 120ms ease-in-out !important;
}
#mlpp-resizer:hover::after, #mlpp-resizer.mlpp-dragging::after {
  height: 80px !important;
  background-color: rgba(255, 255, 255, 0.4) !important;
}
`;

/**
 * @param {string} selector
 * @param {import('./geometry.js').Rect} r
 * @param {string} [extra]
 */
function place(selector, r, extra = '') {
  return `${selector} { left: ${r.x}px !important; top: ${r.y}px !important; width: ${r.w}px !important; height: ${r.h}px !important; ${extra} }`;
}

/**
 * @param {import('./dom.js').Hooks} hooks
 * @param {HTMLElement} chatsRoot
 * @param {ReturnType<typeof import('./chats.js').createChatManager>} chats
 * @param {ReturnType<typeof import('./audio.js').createAudioMixer>} audio
 * @param {ReturnType<typeof import('./frames.js').createFrameBus>} bus
 */
export function startLayout(hooks, chatsRoot, chats, audio, bus) {
  // #chat-toggle 앞에 넣어야 토글 버튼이 채팅 위에 그려진다.
  hooks.chatToggle.before(chatsRoot);
  // select는 iframe이 아니라 옮겨도 리로드되지 않는다. 페이지 JS가 들고 있는 참조도 그대로 유효하다.
  chatsRoot.append(hooks.chatSelect);

  const resizer = document.createElement('div');
  resizer.id = 'mlpp-resizer';
  resizer.title = '채팅 폭 조절 (더블클릭: 기본값)';
  chatsRoot.append(resizer);

  // 우클릭 드래그로 채팅 칸을 나눌 때 쓰는 표시. 전체 영역과 새 칸이 생길 자리.
  const dropBg = document.createElement('div');
  dropBg.id = 'mlpp-dropbg';
  const dropBox = document.createElement('div');
  dropBox.id = 'mlpp-drop';
  chatsRoot.append(dropBg, dropBox);

  /** @type {ReturnType<typeof setTimeout> | 0} */
  let timer = 0;
  let chatVisible = true;
  /** 채팅 칸 트리. 잎 하나가 채팅 하나다. 구조는 `panes.js` 가 들고 있다. */
  let tree = /** @type {import('./panes.js').PaneNode} */ (panes.leaf(chats.firstUsable()));
  let preview = -1;
  /** 마지막 렌더에서 채팅이 차지한 영역. 칸을 더 넣을 수 있는지 판단하는 데 쓴다. */
  let chatRegion = /** @type {import('./geometry.js').Rect | null} */ (null);
  /** 마지막 렌더의 잎별 사각형. 드롭 자리 판정에 쓴다. */
  let paneBoxes = /** @type {Map<number, import('./geometry.js').Rect>} */ (new Map());

  /** 가장 나중에 생긴 칸. 호버와 우클릭 전환이 노리는 자리다. */
  function newestLeaf() {
    return panes.leaves(tree).reduce((best, l) => (l.id > best.id ? l : best));
  }

  /** 가장 큰 칸. 마스터 채팅이 앉는 자리다. */
  function largestLeaf() {
    return chatRegion ? panes.largestLeaf(tree, chatRegion, TILE_GAP) : newestLeaf();
  }

  /** @param {number} stream */
  function leafOfStream(stream) {
    return panes.leaves(tree).find((l) => l.stream === stream) ?? null;
  }

  /**
   * 두 칸의 방송을 맞바꾼다. 구조는 그대로 두고 내용만 옮긴다.
   * @param {{ stream: number }} a
   * @param {{ stream: number }} b
   */
  function swapStreams(a, b) {
    const held = a.stream;
    a.stream = b.stream;
    b.stream = held;
  }

  /**
   * 자동으로 한 칸 늘린다. 가장 큰 칸을 반으로 가른다.
   * @param {number} stream
   */
  function addPane(stream) {
    if (!chatRegion) return false;
    const next = panes.autoSplit(tree, chatRegion, TILE_GAP, MIN_PANE_WIDTH, MIN_PANE_HEIGHT, stream);
    if (!next) return false;
    tree = next;
    return true;
  }

  /**
   * 칸 하나를 닫는다. 마지막 하나는 지우지 않고 패널을 접는다(다시 펼 때 빈 화면이 나오지 않게).
   * @param {number} id
   * @returns {string | null}
   */
  function closePane(id) {
    const held = panes.findLeaf(tree, id);
    if (!held) return null;
    if (held.stream === masterChat) masterChat = -1;
    if (panes.leaves(tree).length === 1) {
      chatVisible = false;
      return '➖\u{1F4AC}';
    }
    tree = panes.remove(tree, id);
    return '➖\u{1F4AC}';
  }

  // 마스터 앤 스택의 마스터 방송. -1이면 평범한 격자. 새로고침하면 풀린다.
  let master = -1;
  /** 이 시각 전에 오는 호버 한 번은 무시한다. 마스터 전환 직후의 자리바꿈 때문에 생긴다. */
  let ignoreHoverUntil = 0;
  /** 마지막 렌더의 방송별 화면 위치. 프레임이 보낸 클릭 좌표를 문서 좌표로 옮기는 데 쓴다. */
  let videoRects = /** @type {Map<number, import('./geometry.js').Rect>} */ (new Map());
  /** 지금 첫 칸을 마스터 자격으로 차지한 방송. -1이면 없음. */
  let masterChat = -1;
  /** 그 칸을 우리가 새로 만든 것인가. 원래 켜 두었던 것이면 마스터를 풀어도 남긴다. */
  let masterChatAuto = false;
  /** 이번 렌더에서 슬롯마다 어떤 방송이 놓였는지. 마스터 모드에서는 order와 달라진다. */
  let slotStream = /** @type {number[]} */ ([]);

  // 슬롯(화면상의 자리) → 스트림(방송) 대응. 드래그 교환으로만 바뀐다.
  // iframe을 옮기지 않고 이 대응만 바꾸므로 교환해도 재생이 끊기지 않는다.
  const orderKey = `order:${location.pathname}`;
  let order = settings.loadOrder(orderKey, hooks.players.length);

  const dnd = createDragSwap({
    root: chatsRoot,
    labelOf: (slot) => hooks.chatSelect.options[slotStream[slot]]?.textContent ?? '',
    swap: (a, b) => {
      // 슬롯이 아니라 방송 기준으로 맞바꾼다. 마스터 모드에서는 슬롯과 order 순서가 다르다.
      const sa = slotStream[a];
      const sb = slotStream[b];
      const ia = order.indexOf(sa);
      const ib = order.indexOf(sb);
      if (ia < 0 || ib < 0) return;
      [order[ia], order[ib]] = [order[ib], order[ia]];
      settings.saveOrder(orderKey, order);
      // 마스터 모드에서 첫 자리만은 order가 아니라 master가 정한다.
      // 그 자리와 맞바꿀 때 master를 안 바꾸면 첫 칸은 그대로고 나머지만 흔들린다.
      // 둘을 같이 해야 두 타일이 실제로 자리를 맞바꾼다.
      if (master >= 0 && (a === 0 || b === 0)) {
        master = a === 0 ? sb : sa;
        setMasterChat(master);
        audio.setMaster(master);
      }
    },
    schedule: () => schedule(),
  });

  /**
   * 마스터 추종. 그 방송의 채팅을 가장 큰 칸, 곧 첫 칸에 놓고 있던 칸들을 뒤로 민다.
   *
   * 장부는 솔로와 같다(`audio.js` 의 `masterAutoPinned`).
   * 원래 켜 두었던 채팅이면 마스터를 풀어도 남고, 큰 칸에서 밀려나 맨 뒤로 간다.
   * 우리가 마스터 때문에 켠 것이면 마스터를 풀 때 같이 사라진다.
   *
   * 칸 수 상한은 여기서 보지 않는다. `panes` 는 "보고 싶은 것"이고,
   * 실제로 안 들어가면 render가 뒤에서부터 덜어낸다. 마스터를 풀면 그대로 되살아난다.
   *
   * @param {number} index -1이면 마스터 해제
   */
  function setMasterChat(index) {
    if (settings.get('masterFollowsChat') === 0) return;
    if (masterChat >= 0 && masterChat !== index) {
      const old = leafOfStream(masterChat);
      // 우리가 켠 것이면 닫는다. 원래 켜 두었던 것이면 남기되 가장 작은 칸으로 민다.
      if (old && masterChatAuto) closePane(old.id);
      else if (old) {
        const smallest = smallestLeaf();
        if (smallest && smallest.id !== old.id) swapStreams(old, smallest);
      }
      masterChat = -1;
      masterChatAuto = false;
    }
    if (index < 0 || !chats.usable.includes(index)) return;
    chatVisible = true;
    masterChatAuto = !leafOfStream(index);
    // 없으면 칸을 하나 늘려서라도 띄운다. 자리가 없으면 가장 큰 칸을 갈아끼운다.
    if (masterChatAuto && !addPane(index)) {
      const big = largestLeaf();
      if (big) big.stream = index;
      masterChatAuto = false;
    }
    const holder = leafOfStream(index);
    const big = largestLeaf();
    if (holder && big && holder.id !== big.id) swapStreams(holder, big);
    masterChat = index;
  }

  /** 가장 작은 칸. 마스터에서 내려온 채팅이 밀려나는 자리다. */
  function smallestLeaf() {
    const list = panes.leaves(tree);
    if (!chatRegion) return list[list.length - 1];
    const boxes = panes.rects(tree, chatRegion, TILE_GAP);
    return list.reduce((best, l) => {
      const a = boxes.get(l.id);
      const b = boxes.get(best.id);
      return a && b && a.w * a.h < b.w * b.h ? l : best;
    }, list[0]);
  }

  /**
   * 우클릭 전환. 쪼개 놓은 칸을 없애지 않고 **마지막 칸만** 갈아끼운다(LIFO).
   * 나중에 넣은 칸이 먼저 밀려난다.
   *
   * 호버 미리보기가 노리는 칸과 같은 자리다. 넘겨보다 우클릭하면 보고 있던 그 자리에 그대로 확정된다.
   * @param {number} index
   * @returns {string | null} 알릴 기호. 바뀐 게 없으면 null
   */
  function switchPane(index) {
    chatVisible = true;
    if (leafOfStream(index)) return null;
    const target = newestLeaf();
    if (target.stream === masterChat) masterChat = -1;
    target.stream = index;
    return '\u{1F504}\u{1F4AC}';
  }

  /**
   * 프레임이 보낸 좌표를 문서 좌표로 옮긴다. 그 방송 타일의 원점을 더하면 된다.
   * @param {number} index
   * @param {import('./frames.js').FrameMessage} data
   */
  function docPoint(index, data) {
    const r = videoRects.get(index);
    if (!r) return null;
    return { x: r.x + (Number(data.x) || r.w / 2), y: r.y + (Number(data.y) || r.h / 2) };
  }

  // --- 우클릭 드래그 ---
  // 영상에서 우클릭으로 잡아 채팅 영역에 떨어뜨리면 그 자리에 채팅이 붙는다.
  // 안 끌고 그냥 놓으면 예전과 같은 우클릭 동작이다.
  /** @type {{ stream: number, shift: boolean, x: number, y: number, moved: boolean } | null} */
  let rcDrag = null;
  /** @type {import('./dropzone.js').Zone | null} */
  let dropZone = null;
  /** @type {HTMLDivElement | null} */
  let dropShield = null;

  /** @param {Event} e */
  function swallowMenu(e) {
    e.preventDefault();
    e.stopPropagation();
  }

  /**
   * @param {import('./dropzone.js').Zone | null} a
   * @param {import('./dropzone.js').Zone | null} b
   */
  function sameZone(a, b) {
    if (!a || !b) return a === b;
    if (a.kind !== b.kind) return false;
    const ai = a.kind === 'edge' ? -1 : a.id;
    const bi = b.kind === 'edge' ? -1 : b.id;
    const as = a.kind === 'center' ? '' : a.side;
    const bs = b.kind === 'center' ? '' : b.side;
    return ai === bi && as === bs;
  }

  /**
   * @param {number} stream
   * @param {boolean} shift
   * @param {number} x
   * @param {number} y
   */
  function startRightDrag(stream, shift, x, y) {
    if (rcDrag) return;
    rcDrag = { stream, shift, x, y, moved: false };
    dropZone = null;
    // iframe이 pointermove를 삼키지 않도록 화면 전체를 덮는다. 뗀 신호도 여기서 받는다.
    dropShield = document.createElement('div');
    dropShield.style.cssText = 'position:fixed;inset:0;z-index:2147483646;cursor:copy';
    document.body.append(dropShield);
    document.addEventListener('pointermove', onDragMove);
    document.addEventListener('pointerup', onDragUp);
    document.addEventListener('pointercancel', cancelDrag);
    document.addEventListener('keydown', onDragKey);
    window.addEventListener('blur', cancelDrag);
    document.addEventListener('contextmenu', swallowMenu, true);
    schedule();
  }

  /** 창 밖에서 손을 떼는 등으로 뗀 신호를 놓치면 실드가 남아 페이지 전체가 먹통이 된다. */
  function cancelDrag() {
    if (!rcDrag) return;
    endRightDrag();
    schedule();
  }

  /** @param {KeyboardEvent} e */
  function onDragKey(e) {
    if (e.key === 'Escape') cancelDrag();
  }

  function endRightDrag() {
    document.removeEventListener('pointermove', onDragMove);
    document.removeEventListener('pointerup', onDragUp);
    document.removeEventListener('pointercancel', cancelDrag);
    document.removeEventListener('keydown', onDragKey);
    window.removeEventListener('blur', cancelDrag);
    dropShield?.remove();
    dropShield = null;
    rcDrag = null;
    dropZone = null;
    // 우클릭 메뉴는 플랫폼에 따라 뗀 뒤에 온다. 그 한 번까지 막고 나서 푼다.
    setTimeout(() => document.removeEventListener('contextmenu', swallowMenu, true), MENU_GRACE_MS);
  }

  /** @param {PointerEvent} e */
  function onDragMove(e) {
    if (!rcDrag) return;
    if (Math.abs(e.clientX - rcDrag.x) + Math.abs(e.clientY - rcDrag.y) > DRAG_SLOP) rcDrag.moved = true;
    const next = chatVisible && chatRegion ? zoneAt(e.clientX, e.clientY, chatRegion, paneBoxes) : null;
    if (sameZone(next, dropZone)) return;
    dropZone = next;
    schedule();
  }

  /** @param {PointerEvent} e */
  function onDragUp(e) {
    finishRightDrag(e.clientX, e.clientY);
  }

  /**
   * @param {number} x
   * @param {number} y
   */
  function finishRightDrag(x, y) {
    const drag = rcDrag;
    if (!drag) return;
    const zone = chatVisible && chatRegion ? zoneAt(x, y, chatRegion, paneBoxes) : null;
    endRightDrag();
    preview = -1;
    const done =
      drag.moved && zone
        ? applyDrop(zone, drag.stream)
        : drag.shift
          ? togglePane(drag.stream)
          : switchPane(drag.stream);
    if (done) showToast(done, x, y);
    schedule();
  }

  /**
   * Shift+우클릭 추가/제거. 마지막 칸을 빼면 채팅 패널 자체를 접는다(타일링 WM에서 마지막 창을 닫는 것과 같다).
   * 접힌 상태에서 우클릭하면 다시 편다.
   * @param {number} index
   * @returns {string | null} 알릴 기호. 바뀐 게 없으면 null
   */
  function togglePane(index) {
    // 직접 건드린 순간부터는 사용자 것이다. 마스터를 풀어도 되돌리지 않는다.
    if (index === masterChat) masterChatAuto = false;
    if (!chatVisible) {
      chatVisible = true;
      if (!leafOfStream(index)) addPane(index);
      return '➕\u{1F4AC}';
    }
    const held = leafOfStream(index);
    if (held) return closePane(held.id);
    // 자리가 없으면 조용히 무시한다. 억지로 넣으면 있던 칸들까지 못 쓰게 된다.
    return addPane(index) ? '➕\u{1F4AC}' : null;
  }

  /**
   * 채팅 영역에 떨어뜨렸을 때. 가운데면 그 칸을 갈아끼우고, 가장자리면 그쪽으로 쪼갠다.
   * 한 방송이 두 칸에 있을 수 없으므로, 이미 떠 있으면 자리를 맞바꾸거나 원래 칸을 걷어낸다.
   * @param {import('./dropzone.js').Zone} zone
   * @param {number} stream
   * @returns {string | null}
   */
  function applyDrop(zone, stream) {
    chatVisible = true;
    const held = leafOfStream(stream);
    if (zone.kind === 'center') {
      const target = panes.findLeaf(tree, zone.id);
      if (!target || held?.id === target.id) return null;
      if (held) swapStreams(held, target);
      else {
        if (target.stream === masterChat) masterChat = -1;
        target.stream = stream;
      }
      return '\u{1F504}\u{1F4AC}';
    }
    // 쪼개서 새 칸을 만든다. 이미 떠 있던 칸은 걷어낸다.
    if (held && zone.kind === 'pane' && zone.id === held.id) return null;
    let base = tree;
    if (held) {
      if (panes.leaves(base).length === 1) return null;
      base = panes.remove(base, held.id);
    }
    const next =
      zone.kind === 'edge' ? panes.wrap(base, zone.side, stream) : panes.insert(base, zone.id, zone.side, stream);
    if (chatRegion && !panes.fits(next, chatRegion, TILE_GAP, MIN_PANE_WIDTH, MIN_PANE_HEIGHT)) return null;
    if (held && held.stream === masterChat) masterChat = -1;
    tree = next;
    return '➕\u{1F4AC}';
  }

  /** 드래그 교환 순서를 기본으로 되돌린다. */
  function resetOrder() {
    master = -1;
    setMasterChat(-1);
    audio.setMaster(-1);
    order = hooks.players.map((_, i) => i);
    settings.saveOrder(orderKey, order);
    schedule();
  }
  /** 드래그 중에만 쓰는 임시 폭. 놓을 때 설정에 커밋한다. */
  let dragWidth = /** @type {number | null} */ (null);

  // 페이지의 #chat은 쓰지 않는다. 확장이 PonReady에서 src를 채우므로 계속 비워둔다.
  function blankPageChat() {
    if (hooks.chat.getAttribute('src') !== 'about:blank') hooks.chat.src = 'about:blank';
  }
  new MutationObserver(blankPageChat).observe(hooks.chat, { attributes: true, attributeFilter: ['src'] });
  blankPageChat();

  function chatWidth() {
    const raw = dragWidth ?? settings.get('chatWidth');
    const max = Math.max(MIN_CHAT_WIDTH, Math.floor(window.innerWidth * 0.6));
    return Math.min(max, Math.max(MIN_CHAT_WIDTH, Math.round(raw)));
  }

  function render() {
    timer = 0;
    const W = window.innerWidth;
    const H = window.innerHeight;
    const n = hooks.players.length;
    const gap = TILE_GAP;
    const mode = settings.layoutMode();
    const cw = chatWidth();

    const forceCols = settings.get('gridCols');
    const forceRows = settings.get('gridRows');

    let layout = null;
    // 마스터를 고르면 지금 배치가 열이든 사이드든 마스터 앤 스택으로 간다.
    // 마스터 앤 스택은 사이드 채팅 배치라, 열 모드에서 들어오면 채팅이 단일 패널로 바뀐다.
    // 마스터를 다시 눌러 해제하면 원래 배치로 되돌아온다.
    if (master >= 0 && forceCols <= 0) {
      layout = masterStackLayout(n, W, H, gap, cw, RESIZER_WIDTH, chatVisible, settings.stackPlacement());
    }
    // 수동 격자를 지정하면 영상이 여러 행에 놓이므로 "영상 아래 자기 채팅"이 성립하지 않는다. 사이드로 간다.
    if (!layout && chatVisible && forceCols <= 0 && mode !== 'side') {
      layout = columnLayout(n, W, H, gap, MIN_COLUMN_WIDTH, mode === 'columns');
    }
    if (!layout) {
      layout = sideLayout(n, W, H, gap, cw, RESIZER_WIDTH, chatVisible, forceCols, forceRows);
    }

    // 마스터 모드에서는 첫 자리가 마스터다. 나머지는 원래 순서대로 스택에 쌓인다.
    slotStream =
      layout.mode === 'master' ? [master, ...order.filter((stream) => stream !== master)] : order;

    const columns = layout.mode === 'columns';
    // 안 보이는 채팅도 크기를 유지해야 뒤에서 계속 내려간다. 사이드 패널 자리를 빌려 쓴다.
    const parked = { x: W - cw, y: SELECT_HEIGHT, w: cw, h: Math.max(1, H - SELECT_HEIGHT) };

    const region = columns ? null : layout.chats[0] ?? null;
    chatRegion = region;

    // 지금 화면에 자리를 가진 채팅과 그 사각형. 열 모드에서는 채팅이 자기 영상을 따라간다.
    /** @type {Map<number, import('./geometry.js').Rect>} */
    const slots = new Map();
    /** @type {number[]} */
    const visible = [];
    paneBoxes = new Map();
    if (columns) {
      visible.push(...chats.usable);
      layout.chats.forEach((r, slot) => {
        const stream = slotStream[slot];
        if (visible.includes(stream)) slots.set(stream, r);
      });
    } else if (chatVisible && region) {
      // 창이 줄어 다 못 담게 되면 나중에 생긴 칸부터 덜어낸 **사본**으로 그린다.
      // 저장된 트리는 그대로 둬서 창을 도로 넓히면 되살아난다.
      const shown = panes.trimToFit(tree, region, gap, MIN_PANE_WIDTH, MIN_PANE_HEIGHT);
      paneBoxes = panes.rects(shown, region, gap);
      const list = panes.leaves(shown);
      const newest = list.reduce((best, l) => (l.id > best.id ? l : best), list[0]);
      // 호버 미리보기는 가장 나중에 생긴 칸 하나만 갈아끼운다. 배치는 흔들리지 않는다.
      const peek =
        preview >= 0 && settings.get('chatHoverPreview') !== 0 && !list.some((l) => l.stream === preview)
          ? preview
          : -1;
      for (const leafNode of list) {
        const stream = peek >= 0 && leafNode.id === newest.id ? peek : leafNode.stream;
        const r = paneBoxes.get(leafNode.id);
        if (!r || !chats.usable.includes(stream) || slots.has(stream)) continue;
        slots.set(stream, r);
        visible.push(stream);
      }
    }
    const current = visible[0] ?? -1;

    const states = chats.sync(visible, settings.get('chatLimit'));

    const rules = [BASE_CSS];

    // 슬롯 순서대로 좌표를 나눠준다. DOM 순서(=방송 순서)와 화면 자리는 별개다.
    layout.videos.forEach((r, slot) => {
      rules.push(place(`#streams iframe:nth-child(${slotStream[slot] + 1})`, r));
    });

    // 채팅 페이지는 무거워서 로딩이 길다. 그동안 검은 화면만 보이면 고장인지 로딩인지 알 수 없다.
    for (const [index, slot] of slots) {
      if (chats.isLoaded(index)) continue;
      const ph = chats.ensurePlaceholder(index);
      rules.push(place(`#${ph.id}`, slot, 'display: flex !important;'));
    }

    for (const { index, state } of states) {
      const selector = `#mlpp-chat-${index}`;
      if (state === 'suspended') {
        rules.push(`${selector} { display: none !important; }`);
        continue;
      }
      let slot = parked;
      if (state === 'visible') {
        const found = slots.get(index);
        if (!found) continue;
        slot = found;
      }
      const extra =
        state === 'visible'
          ? 'display: block !important; visibility: visible !important;'
          : 'display: block !important; visibility: hidden !important; pointer-events: none !important;';
      rules.push(place(selector, slot, extra));
    }

    // 감춰 두었어도 값은 첫 칸에 맞춰 둔다. 드래그 라벨이 이 select 를 읽는다.
    if (current >= 0 && hooks.chatSelect.selectedIndex !== current) hooks.chatSelect.selectedIndex = current;
    if (columns || !chatVisible) rules.push('#mlpp-resizer { display: none !important; }');
    else if (layout.resizer) rules.push(place('#mlpp-resizer', layout.resizer, 'display: block !important;'));

    // 우클릭 드래그 중이면 채팅 영역 전체를 흐리고, 새 칸이 생길 자리를 파랗게 보여 준다.
    if (rcDrag && region && chatVisible) {
      rules.push(place('#mlpp-dropbg', region, 'display: block !important;'));
      const box = dropZone ? previewRect(dropZone, region, paneBoxes) : null;
      if (box) rules.push(place('#mlpp-drop', box, 'display: block !important;'));
    }

    // 토글 아이콘은 페이지가 #chat의 src로 판단하지만 우리는 #chat을 비워두므로 직접 정한다.
    rules.push(`#chat-toggle .open { display: ${chatVisible ? 'none' : 'inline'} !important; }`);
    rules.push(`#chat-toggle .close { display: ${chatVisible ? 'inline' : 'none'} !important; }`);

    setStyle('layout', rules.join('\n'));
    // 어떤 배치가 왜 잡혔는지 밖에서 읽을 수 있게 남긴다.
    // 설정끼리 서로를 죽이는 상황(수동 격자가 열 모드를 끄는 등)을 눈으로 확인하기 어렵다.
    document.documentElement.dataset.mlppLayout =
      `mode=${layout.mode} master=${master} chat=${visible.join('+') || -1}` +
      ` panes=[${panes.leaves(tree).map((l) => l.stream).join(',')}]` +
      ` mchat=${masterChat}${masterChatAuto ? '(auto)' : ''}` +
      ` slots=[${slotStream.join(',')}] grid=${forceCols}x${forceRows} setting=${mode}` +
      ` stack=${settings.stackPlacement()}`;
    dnd.update(layout.videos);

    // 오디오 오버레이는 슬롯이 아니라 방송 기준이다. 드래그로 자리가 바뀌어도 따라간다.
    /** @type {Map<number, import('./geometry.js').Rect>} */
    const byStream = new Map();
    layout.videos.forEach((r, slot) => byStream.set(slotStream[slot], r));
    videoRects = byStream;
    audio.update(byStream);
  }

  // requestAnimationFrame을 쓰지 않는다. 배경 탭에서는 rAF가 발화하지 않아 재계산이 밀린다.
  function schedule() {
    if (timer) return;
    timer = setTimeout(render, 0);
  }

  // --- 페이지 리스너 선점 ---
  // 페이지 핸들러는 요소에 직접 달려 있어 제거할 수 없다. 문서 캡처 단계에서 가로챈다.
  document.addEventListener(
    'change',
    (e) => {
      if (e.target !== hooks.chatSelect) return;
      e.stopPropagation();
      if (hooks.chatSelect.value === 'about:blank') {
        chatVisible = false;
      } else {
        // 페이지의 드롭다운은 "이 채팅을 봐라"는 뜻이다. 쪼개 놓은 것을 한 칸으로 되돌린다.
        tree = panes.leaf(hooks.chatSelect.selectedIndex);
        masterChat = -1;
        masterChatAuto = false;
        preview = -1;
        chatVisible = true;
      }
      schedule();
    },
    true,
  );

  document.addEventListener(
    'click',
    (e) => {
      if (!(e.target instanceof Node) || !hooks.chatToggle.contains(e.target)) return;
      e.stopPropagation();
      e.preventDefault();
      chatVisible = !chatVisible;
      schedule();
    },
    true,
  );

  // --- 리사이저 ---
  /** @type {HTMLDivElement | null} */
  let shield = null;

  /** @param {PointerEvent} e */
  function onMove(e) {
    // 리사이저는 채팅 왼쪽 끝에 겹쳐 있다. 그립 가운데가 커서를 따라오게 맞춘다.
    dragWidth = window.innerWidth - e.clientX + RESIZER_WIDTH / 2;
    schedule();
  }

  function endDrag() {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', endDrag);
    document.removeEventListener('pointercancel', endDrag);
    resizer.classList.remove('mlpp-dragging');
    shield?.remove();
    shield = null;
    if (dragWidth !== null) {
      const committed = chatWidth();
      dragWidth = null;
      settings.set('chatWidth', committed);
    }
    schedule();
  }

  resizer.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    // 캡처는 창 밖으로 나가도 이벤트를 받기 위한 보강. 실패해도 문서 리스너 + 실드로 성립한다.
    try {
      resizer.setPointerCapture(e.pointerId);
    } catch {
      /* 캡처 없이 진행 */
    }
    resizer.classList.add('mlpp-dragging');
    shield = document.createElement('div');
    shield.style.cssText = 'position:fixed;inset:0;z-index:2147483646;cursor:col-resize';
    document.body.append(shield);
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', endDrag);
    document.addEventListener('pointercancel', endDrag);
  });

  resizer.addEventListener('dblclick', () => {
    settings.set('chatWidth', DEFAULT_CHAT_WIDTH);
    schedule();
  });

  // 사이드 모드에서 영상에 호버하면 그 방송 채팅을 잠깐 보여주고, 우클릭하면 진짜로 넘어간다.
  // 열 모드는 채팅이 전부 보이므로 해당 없다.
  bus.on((index, data) => {
    // 위치 교환은 채팅과 무관하다. 가드보다 앞에 둔다.
    if (data.kind === 'alt') {
      dnd.setFrameAlt(index, !!data.on);
      return;
    }
    // 마스터 앤 스택은 영상 배치라 그 방송의 채팅을 쓸 수 있는지와 무관하다. 가드보다 앞에 둔다.
    if (data.kind === 'master') {
      // 마스터를 다시 누르면 해제, 다른 화면을 누르면 그쪽이 마스터가 된다.
      master = master === index ? -1 : index;
      if (master >= 0) {
        // 슬레이브를 마스터로 올리면 그 자리에 다른 화면이 들어와 커서 밑에 놓인다.
        // 그때 곧바로 오는 호버 한 번은 무시해야 방금 고른 마스터의 채팅이 그대로 보인다.
        ignoreHoverUntil = Date.now() + HOVER_GRACE_MS;
        preview = -1;
      }
      setMasterChat(master);
      audio.setMaster(master);
      schedule();
      return;
    }
    // 아래는 사이드 채팅 전환이라 채팅이 있는 방송에만 해당한다.
    if (!chats.usable.includes(index)) return;
    if (data.kind === 'hover') {
      if (data.on) {
        if (Date.now() < ignoreHoverUntil) {
          ignoreHoverUntil = 0; // 한 번만 무시한다
          return;
        }
        preview = index;
      } else if (preview === index) {
        preview = -1;
      }
      schedule();
    } else if (data.kind === 'rcdown') {
      const at = docPoint(index, data);
      if (at) startRightDrag(index, !!data.shift, at.x, at.y);
    } else if (data.kind === 'rcup') {
      // 실드가 깔리기 전에 손을 뗐을 때를 위한 보강. 실드가 먼저 받았으면 여기서는 아무 일도 없다.
      const at = docPoint(index, data);
      if (at) finishRightDrag(at.x, at.y);
    }
  });

  // 채팅 칸 안에서 Shift+우클릭하면 그 칸을 닫는다. 그냥 우클릭은 채팅에 넘긴다.
  chats.onMessage((index, data) => {
    if (data.kind !== 'close') return;
    const held = leafOfStream(index);
    if (!held) return;
    const box = paneBoxes.get(held.id);
    const done = closePane(held.id);
    if (done && box) showToast(done, box.x + box.w / 2, box.y + box.h / 2);
    schedule();
  });

  window.addEventListener('resize', schedule);
  settings.onChange(schedule);
  // 프레임이 로드되면 자리 표시자를 걷는다.
  chats.onFrameLoad(schedule);

  render();
  return { schedule, render, resetOrder, swapHint: dnd.hint };
}
