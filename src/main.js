/* global GM_info */
import { waitForHooks, readChatOptions, log, warn } from './dom.js';
import { setStyle, getStyleMode } from './style.js';

const VERSION = typeof GM_info !== 'undefined' ? GM_info.script.version : 'dev';

// 우리 주입이 CSP에 걸리는지 관측한다. 페이지 자신도 이 이벤트를 쓰므로(네이버 로그인) 겹치지 않게 로그만 남긴다.
document.addEventListener('securitypolicyviolation', (e) => {
  warn('CSP violation:', e.violatedDirective, '<-', e.blockedURI);
});

main();

async function main() {
  const hooks = await waitForHooks();
  if (!hooks) {
    // 스트림 없는 랜딩 페이지이거나 사이트 DOM이 변경된 경우
    warn('페이지 훅을 찾지 못해 아무것도 하지 않습니다.');
    return;
  }

  // Stage 0 스모크 테스트: CSP를 뚫고 스타일이 실제로 적용되는지 육안 확인용.
  // Stage 2에서 실제 기능 스타일로 교체된다.
  setStyle('smoke', '#chat-container { outline: 3px solid #0f0 !important; }');

  const chats = readChatOptions(hooks.chatSelect);
  log(`v${VERSION} booted`, {
    style: getStyleMode(),
    players: hooks.players.map((f) => f.name),
    chats: chats.map((c) => `${c.label}${c.disabled ? ' [disabled]' : ''}`),
    chatWidth: hooks.chatContainer.getBoundingClientRect().width,
  });
}
