import { setStyle } from './style.js';

/**
 * 클릭 한 자리에 잠깐 뜨는 알림.
 *
 * 조작은 iframe 안에서 일어나고 바뀌는 것은 바깥이라, 눌렀는데 뭐가 달라졌는지
 * 시선이 닿는 곳에 표시가 없다. 커서 바로 위에 무슨 일이 일어났는지만 찍고 사라진다.
 */

const Z = 2147483000;
const LIFE_MS = 900;
/** 커서와 알림 사이 여백 */
const OFFSET = 6;

// opacity/transform 에 !important 를 걸지 않는다. 걸면 Web Animations 가 이긴다.
// (important 선언은 애니메이션보다 세다 — audio.js 의 파동에서 같은 함정을 밟았다.)
const BASE_CSS = `
.mlpp-toast {
  position: fixed !important;
  z-index: ${Z} !important;
  padding: 3px 8px !important;
  border-radius: 6px !important;
  border: 1px solid rgba(255, 255, 255, 0.14) !important;
  background-color: rgba(20, 21, 23, 0.9) !important;
  color: #f2f4f8 !important;
  font-size: 15px !important;
  line-height: 1.25 !important;
  white-space: nowrap !important;
  pointer-events: none !important;
  opacity: 0;
}
`;

/**
 * @param {string} text 무슨 일이 일어났는지 나타내는 짧은 기호
 * @param {number} x 문서 좌표
 * @param {number} y 문서 좌표
 */
export function showToast(text, x, y) {
  setStyle('toast', BASE_CSS);

  const el = document.createElement('div');
  el.className = 'mlpp-toast';
  el.textContent = text;
  document.body.append(el);

  // 좌상단에 붙이려면 자기 크기를 알아야 한다. transform 으로 밀면 애니메이션과 부딪힌다.
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  el.style.left = `${Math.max(4, Math.min(window.innerWidth - w - 4, x - w - OFFSET))}px`;
  el.style.top = `${Math.max(4, Math.min(window.innerHeight - h - 4, y - h - OFFSET))}px`;

  el.animate(
    [
      { opacity: 0, transform: 'translateY(5px)' },
      { opacity: 1, transform: 'translateY(0)', offset: 0.15 },
      { opacity: 1, transform: 'translateY(0)', offset: 0.6 },
      { opacity: 0, transform: 'translateY(-5px)' },
    ],
    { duration: LIFE_MS, easing: 'ease-out' },
  );
  // 애니메이션의 finished 로 지우지 않는다. 배경 탭에서는 애니메이션이 진행되지 않아
  // 그 약속이 영영 안 풀리고 노드만 쌓인다. layout.js 가 rAF 를 안 쓰는 것과 같은 이유다.
  setTimeout(() => el.remove(), LIFE_MS + 100);
}
