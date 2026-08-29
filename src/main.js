/* global GM_info */
import { waitForHooks, readChatOptions, log, warn } from './dom.js';
import { getStyleMode } from './style.js';
import { setupChatResizer } from './chat.js';
import { startLayout } from './layout.js';

const VERSION = typeof GM_info !== 'undefined' ? GM_info.script.version : 'dev';

// 우리 주입이 CSP에 걸리는지 관측한다. 페이지 자신도 이 이벤트를 쓰므로(네이버 로그인) 로그만 남긴다.
// 위반이 반복되는 경로가 있어 몇 건만 남기고 멈춘다.
let cspReports = 0;
document.addEventListener('securitypolicyviolation', (e) => {
  if (++cspReports > 3) return;
  warn(`CSP violation (${cspReports}/3):`, e.violatedDirective, '<-', e.blockedURI);
});

main();

async function main() {
  const hooks = await waitForHooks();
  if (!hooks) {
    // 스트림 없는 랜딩 페이지이거나 사이트 DOM이 변경된 경우
    warn('페이지 훅을 찾지 못해 아무것도 하지 않습니다.');
    return;
  }

  const chat = setupChatResizer(hooks);
  const layout = startLayout(hooks, chat.reservedWidth);
  chat.schedule(layout.schedule);

  log(`v${VERSION} booted`, {
    style: getStyleMode(),
    players: hooks.players.map((f) => f.name),
    chats: readChatOptions(hooks.chatSelect).map((c) => `${c.label}${c.disabled ? ' [disabled]' : ''}`),
  });
}
