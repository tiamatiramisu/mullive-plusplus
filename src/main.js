/* global GM_info, GM_registerMenuCommand */
import { waitForHooks, readChatOptions, log, warn } from './dom.js';
import { getStyleMode } from './style.js';
import * as settings from './settings.js';
import { createChatManager } from './chats.js';
import { createAudioMixer } from './audio.js';
import { startLayout } from './layout.js';
import { startPlayerAgent } from './player-agent.js';
import { watchPlayers, isPlayerReady, onPlayerReady, timedOut } from './ready.js';

const VERSION = typeof GM_info !== 'undefined' ? GM_info.script.version : 'dev';

const SOOP_HOST = /^play\.sooplive\.(com|co\.kr)$/;
const SOOP_CHAT = /^https:\/\/play\.sooplive\.(com|co\.kr)\//;

// 이 스크립트는 mul.live 와 그 안의 SOOP 플레이어 프레임 양쪽에서 돈다. 역할을 먼저 가른다.
if (SOOP_HOST.test(location.hostname)) {
  startPlayerAgent();
} else {
  // 플레이어 준비 신호는 훅을 찾기 전에도 올 수 있다. 가장 먼저 걸어둔다.
  watchPlayers();

  // 우리 주입이 CSP에 걸리는지 관측한다. 반복되는 경로가 있어 몇 건만 남기고 멈춘다.
  let cspReports = 0;
  document.addEventListener('securitypolicyviolation', (e) => {
    if (++cspReports > 3) return;
    warn(`CSP violation (${cspReports}/3):`, e.violatedDirective, '<-', e.blockedURI);
  });

  main();
}

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

  // 하이라이트는 #streams 보다 앞에 놓아 영상 iframe 뒤에 그려지게 한다.
  // 그래야 바깥으로 번지는 빛이 이웃 화면을 가리지 않는다.
  const glowRoot = document.createElement('div');
  glowRoot.id = 'mlpp-glow';
  hooks.streams.before(glowRoot);
  const audio = createAudioMixer({ players: hooks.players, root: glowRoot });
  const layout = startLayout(hooks, chatsRoot, chats, audio);

  // 플레이어가 준비될 때마다 다시 그리고, 그 프레임의 에이전트에 인사한다.
  onPlayerReady(() => {
    if (timedOut()) warn('플레이어 준비 신호를 받지 못해 채팅을 그대로 만듭니다.');
    hooks.players.forEach((_, i) => audio.greet(i));
    layout.schedule();
  });

  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('영상 순서 초기화', () => layout.resetOrder());
    GM_registerMenuCommand('솔로/음소거 해제', () => audio.reset());
  }

  log(`v${VERSION} booted`, {
    swap: layout.swapHint,
    style: getStyleMode(),
    mode: settings.layoutMode(),
    players: hooks.players.length,
    chats: chats.usable.length,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
  });
}
