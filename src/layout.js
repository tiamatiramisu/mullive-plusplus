import { setStyle } from './style.js';
import * as settings from './settings.js';
import { columnLayout, sideLayout } from './geometry.js';

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
const DEFAULT_CHAT_WIDTH = 350;

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
#streams iframe {
  position: absolute !important;
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
  border: 0 !important;
  background-color: #141517 !important;
  pointer-events: auto !important;
}
#chat-select {
  position: absolute !important;
  z-index: 5 !important;
  margin: 0 !important;
  pointer-events: auto !important;
}
#mlpp-resizer {
  position: absolute !important;
  z-index: 4 !important;
  background-color: #222 !important;
  border-left: 1px solid #3a3a3a !important;
  cursor: col-resize !important;
  pointer-events: auto !important;
  transition: background-color 120ms ease-in-out !important;
}
#mlpp-resizer:hover, #mlpp-resizer.mlpp-dragging { background-color: #555 !important; }
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
 */
export function startLayout(hooks, chatsRoot, chats) {
  // #chat-toggle 앞에 넣어야 토글 버튼이 채팅 위에 그려진다.
  hooks.chatToggle.before(chatsRoot);
  // select는 iframe이 아니라 옮겨도 리로드되지 않는다. 페이지 JS가 들고 있는 참조도 그대로 유효하다.
  chatsRoot.append(hooks.chatSelect);

  const resizer = document.createElement('div');
  resizer.id = 'mlpp-resizer';
  resizer.title = '채팅 폭 조절 (더블클릭: 기본값)';
  chatsRoot.append(resizer);

  /** @type {ReturnType<typeof setTimeout> | 0} */
  let timer = 0;
  let chatVisible = true;
  let active = chats.firstUsable();
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
    const gap = settings.get('tileGap');
    const mode = settings.layoutMode();
    const cw = chatWidth();

    let layout = null;
    if (chatVisible && mode !== 'side') {
      layout = columnLayout(n, W, H, gap, settings.get('minColumnWidth'), mode === 'columns');
    }
    if (!layout) layout = sideLayout(n, W, H, gap, cw, RESIZER_WIDTH, chatVisible);

    const columns = layout.mode === 'columns';
    // 안 보이는 채팅도 크기를 유지해야 뒤에서 계속 내려간다. 사이드 패널 자리를 빌려 쓴다.
    const parked = { x: W - cw, y: SELECT_HEIGHT, w: cw, h: Math.max(1, H - SELECT_HEIGHT) };

    const visible = columns ? chats.usable : chatVisible && active >= 0 ? [active] : [];
    const states = chats.sync(visible, settings.get('chatLimit'));

    const rules = [BASE_CSS];

    layout.videos.forEach((r, i) => rules.push(place(`#streams iframe:nth-child(${i + 1})`, r)));

    for (const { index, state } of states) {
      const selector = `#mlpp-chat-${index}`;
      if (state === 'suspended') {
        rules.push(`${selector} { display: none !important; }`);
        continue;
      }
      let slot = parked;
      if (state === 'visible') {
        const found = columns ? layout.chats[index] : layout.chats[0];
        if (!found) continue;
        slot = found;
      }
      const extra =
        state === 'visible'
          ? 'display: block !important; visibility: visible !important;'
          : 'display: block !important; visibility: hidden !important; pointer-events: none !important;';
      rules.push(place(selector, slot, extra));
    }

    if (columns || !chatVisible) {
      rules.push('#chat-select { display: none !important; }');
      rules.push('#mlpp-resizer { display: none !important; }');
    } else {
      const panel = layout.chats[0];
      rules.push('#chat-select { display: block !important; }');
      if (panel) {
        const w = Math.max(40, panel.w - 8);
        rules.push(`#chat-select { left: ${panel.x + 4}px !important; top: 4px !important; width: ${w}px !important; }`);
      }
      if (layout.resizer) rules.push(place('#mlpp-resizer', layout.resizer, 'display: block !important;'));
    }

    // 토글 아이콘은 페이지가 #chat의 src로 판단하지만 우리는 #chat을 비워두므로 직접 정한다.
    rules.push(`#chat-toggle .open { display: ${chatVisible ? 'none' : 'inline'} !important; }`);
    rules.push(`#chat-toggle .close { display: ${chatVisible ? 'inline' : 'none'} !important; }`);

    setStyle('layout', rules.join('\n'));
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
        if (active >= 0) hooks.chatSelect.selectedIndex = active;
      } else {
        active = hooks.chatSelect.selectedIndex;
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
    dragWidth = window.innerWidth - e.clientX - RESIZER_WIDTH / 2;
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

  window.addEventListener('resize', schedule);
  settings.onChange(schedule);

  render();
  return { schedule, render };
}
