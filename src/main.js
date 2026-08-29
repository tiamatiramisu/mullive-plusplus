/* global GM_info */
import { waitForHooks, readChatOptions, log, warn } from './dom.js';
import { getStyleMode } from './style.js';
import * as settings from './settings.js';
import { createChatManager } from './chats.js';
import { startLayout } from './layout.js';
import { watchPlayers, isPlayerReady, onPlayerReady, timedOut } from './ready.js';

const VERSION = typeof GM_info !== 'undefined' ? GM_info.script.version : 'dev';

const SOOP_CHAT = /^https:\/\/play\.sooplive\.(com|co\.kr)\//;

// 플레이어 준비 신호는 훅을 찾기 전에도 올 수 있다. 가장 먼저 걸어둔다.
watchPlayers();

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

  const options = readChatOptions(hooks.chatSelect);
  /**
   * SOOP 채팅은 자기 플레이어가 방송 정보를 갖춘 뒤에야 방에 입장할 수 있다.
   * 다른 플랫폼의 채팅은 플레이어와 무관하므로 기다리지 않는다.
   * @param {number} index
   */
  const canCreate = (index) => {
    const url = options[index]?.url ?? '';
    if (!SOOP_CHAT.test(url)) return true;
    return isPlayerReady(hooks.players[index]);
  };

  const chatsRoot = document.createElement('div');
  chatsRoot.id = 'mlpp-chats';
  const chats = createChatManager(hooks, chatsRoot, canCreate);
  const layout = startLayout(hooks, chatsRoot, chats);

  // 플레이어가 준비될 때마다 다시 그린다. 그 시점에 해당 채팅이 만들어진다.
  onPlayerReady(() => {
    if (timedOut()) warn('플레이어 준비 신호를 받지 못해 채팅을 그대로 만듭니다.');
    layout.schedule();
  });

  log(`v${VERSION} booted`, {
    style: getStyleMode(),
    mode: settings.layoutMode(),
    players: hooks.players.length,
    chats: chats.usable.length,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
  });
}
