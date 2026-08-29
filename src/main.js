/* global GM_info */
import { waitForHooks, log, warn } from './dom.js';
import { getStyleMode } from './style.js';
import * as settings from './settings.js';
import { createChatManager } from './chats.js';
import { startLayout } from './layout.js';

const VERSION = typeof GM_info !== 'undefined' ? GM_info.script.version : 'dev';

// 우리 주입이 CSP에 걸리는지 관측한다. 반복되는 경로가 있어 몇 건만 남기고 멈춘다.
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

  settings.init();

  const chatsRoot = document.createElement('div');
  chatsRoot.id = 'mlpp-chats';
  const chats = createChatManager(hooks, chatsRoot);
  startLayout(hooks, chatsRoot, chats);

  log(`v${VERSION} booted`, {
    style: getStyleMode(),
    mode: settings.layoutMode(),
    players: hooks.players.length,
    chats: chats.usable.length,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
  });
}
