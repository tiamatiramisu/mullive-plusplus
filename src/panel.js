import { setStyle } from './style.js';
import * as settings from './settings.js';

/**
 * 직접 만든 설정 UI. 오른쪽 위 톱니 버튼을 누르면 패널이 열린다.
 *
 * GM_config를 쓰지 않는 이유는 유저스크립트 매니저 메뉴에 얹히는 구조라
 * Violentmonkey 팝업이 바뀐 값을 새로고침 전까지 보여주지 않기 때문이다.
 * 여기서는 값을 바꾸는 즉시 화면에 반영되고, 패널에도 그대로 남는다.
 */

const Z = 2147483000;

const BASE_CSS = `
#mlpp-gear {
  position: fixed !important;
  top: 0 !important;
  right: 34px !important;
  z-index: ${Z} !important;
  width: 28px !important;
  height: 28px !important;
  padding: 0 !important;
  border: 0 !important;
  border-radius: 0 0 8px 8px !important;
  background-color: rgba(34, 34, 34, 0.55) !important;
  color: #ccc !important;
  font-size: 15px !important;
  line-height: 28px !important;
  text-align: center !important;
  cursor: pointer !important;
  opacity: 0.35 !important;
  transition: opacity 120ms ease-in-out, background-color 120ms ease-in-out !important;
}
#mlpp-gear:hover, #mlpp-gear.mlpp-open { opacity: 1 !important; background-color: #444 !important; }
/* 처음 오는 사람에게만. 기본 규칙이 opacity를 !important로 잡고 있어 애니메이션으로는 못 이긴다.
   특정도가 한 단계 높은 이 규칙으로 고정해 두고, 애니메이션은 base에 없는 box-shadow만 건드린다. */
#mlpp-gear.mlpp-attract {
  opacity: 1 !important;
  animation: mlpp-attract 1.7s ease-in-out infinite !important;
}
@keyframes mlpp-attract {
  0%, 100% { box-shadow: 0 0 0 0 rgba(76, 141, 255, 0); }
  50% { box-shadow: 0 0 14px 3px rgba(76, 141, 255, 0.55); }
}
#mlpp-panel {
  position: fixed !important;
  top: 30px !important;
  right: 8px !important;
  z-index: ${Z} !important;
  display: none !important;
  box-sizing: border-box !important;
  width: 340px !important;
  max-height: calc(100vh - 44px) !important;
  overflow-y: auto !important;
  padding: 12px 14px 14px !important;
  border: 1px solid #3a3a3a !important;
  border-radius: 8px !important;
  background-color: #1b1c1f !important;
  color: #e6e6e6 !important;
  font-size: 13px !important;
  line-height: 1.45 !important;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.6) !important;
}
#mlpp-panel.mlpp-open { display: block !important; }
#mlpp-panel h2 {
  margin: 0 0 10px !important;
  font-size: 13px !important;
  font-weight: 700 !important;
  color: #fff !important;
}
#mlpp-panel .mlpp-tabs {
  display: flex !important;
  gap: 2px !important;
  margin: 0 0 12px !important;
  border-bottom: 1px solid #2c2d31 !important;
}
#mlpp-panel .mlpp-tabs button {
  padding: 6px 12px !important;
  border: 0 !important;
  border-bottom: 2px solid transparent !important;
  border-radius: 0 !important;
  background: transparent !important;
  color: #8a8f98 !important;
  font-size: 12px !important;
  cursor: pointer !important;
}
#mlpp-panel .mlpp-tabs button:hover { color: #d0d0d0 !important; }
#mlpp-panel .mlpp-tabs button.mlpp-active {
  color: #fff !important;
  border-bottom-color: #4c8dff !important;
}
#mlpp-panel .mlpp-tab-body { display: none !important; }
#mlpp-panel .mlpp-tab-body.mlpp-active { display: block !important; }
#mlpp-panel .mlpp-hint b { color: #dfe3ea !important; font-weight: 700 !important; }
#mlpp-panel .mlpp-hint-line + .mlpp-hint-line { margin-top: 5px !important; }
#mlpp-panel .mlpp-hint-line.mlpp-rule {
  margin-top: 9px !important;
  padding-top: 9px !important;
  border-top: 1px solid rgba(255, 255, 255, 0.12) !important;
}
#mlpp-panel .mlpp-hint {
  margin: 0 0 14px !important;
  padding: 8px 10px !important;
  border-radius: 4px !important;
  background-color: #23252a !important;
  color: #b9bec7 !important;
  font-size: 12px !important;
  line-height: 1.5 !important;
}
#mlpp-panel .mlpp-row { margin-bottom: 12px !important; }
/* 서로 붙는 항목들을 위아래 선으로 묶고 가로로 늘어놓는다. */
#mlpp-panel .mlpp-group {
  margin: 0 0 12px !important;
  padding: 10px 0 !important;
  border-top: 1px solid #2c2d31 !important;
  border-bottom: 1px solid #2c2d31 !important;
}
#mlpp-panel .mlpp-group-name { margin-bottom: 7px !important; color: #e6e6e6 !important; }
#mlpp-panel .mlpp-group-rows { display: flex !important; gap: 14px !important; }
#mlpp-panel .mlpp-group-rows .mlpp-row { flex: 1 1 0 !important; min-width: 0 !important; margin-bottom: 0 !important; }
#mlpp-panel .mlpp-group-rows .mlpp-label { margin-bottom: 0 !important; }
#mlpp-panel .mlpp-group-rows input[type="number"] { width: 64px !important; }
#mlpp-panel .mlpp-group > .mlpp-help { margin-top: 8px !important; }
/* 바로 위 항목에 딸린 하위 설정. 세로줄로 소속을 보인다. */
#mlpp-panel .mlpp-row.mlpp-sub {
  margin-top: -4px !important;
  padding-left: 12px !important;
  border-left: 2px solid #2c2d31 !important;
}
#mlpp-panel .mlpp-label {
  display: flex !important;
  align-items: center !important;
  justify-content: space-between !important;
  gap: 8px !important;
  margin-bottom: 4px !important;
}
#mlpp-panel .mlpp-name { color: #e6e6e6 !important; }
#mlpp-panel .mlpp-help {
  margin-top: 3px !important;
  color: #8a8f98 !important;
  font-size: 11px !important;
  line-height: 1.4 !important;
}
#mlpp-panel select, #mlpp-panel input[type="number"] {
  box-sizing: border-box !important;
  padding: 4px 6px !important;
  border: 1px solid #3a3a3a !important;
  border-radius: 4px !important;
  background-color: #101114 !important;
  color: #e6e6e6 !important;
  font-size: 13px !important;
  outline: none !important;
}
#mlpp-panel select { width: 100% !important; }
/* 이름 오른쪽에 붙는 enum. 줄 전체를 쓰지 않는다. */
#mlpp-panel .mlpp-label select { width: auto !important; max-width: 62% !important; }
#mlpp-panel input[type="number"] { width: 88px !important; text-align: right !important; }
#mlpp-panel input[type="checkbox"] {
  width: 15px !important;
  height: 15px !important;
  margin: 0 !important;
  accent-color: #4c8dff !important;
  cursor: pointer !important;
}
#mlpp-panel .mlpp-unit { color: #8a8f98 !important; font-size: 11px !important; }
/* 탭 안에 놓이는 버튼. 아래쪽 공용 버튼줄과 생김새를 맞춘다. */
#mlpp-panel .mlpp-tab-actions { display: flex !important; flex-wrap: wrap !important; gap: 6px !important; }
#mlpp-panel .mlpp-tab-actions button {
  flex: 1 1 auto !important;
  padding: 6px 8px !important;
  border: 1px solid #3a3a3a !important;
  border-radius: 4px !important;
  background-color: #26272b !important;
  color: #e6e6e6 !important;
  font-size: 12px !important;
  cursor: pointer !important;
}
#mlpp-panel .mlpp-tab-actions button:hover { background-color: #34363b !important; }
#mlpp-panel .mlpp-actions {
  display: flex !important;
  flex-wrap: wrap !important;
  gap: 6px !important;
  margin-top: 14px !important;
  padding-top: 12px !important;
  border-top: 1px solid #2c2d31 !important;
}
#mlpp-panel .mlpp-actions button {
  flex: 1 1 auto !important;
  padding: 6px 8px !important;
  border: 1px solid #3a3a3a !important;
  border-radius: 4px !important;
  background-color: #26272b !important;
  color: #e6e6e6 !important;
  font-size: 12px !important;
  cursor: pointer !important;
}
#mlpp-panel .mlpp-actions button:hover { background-color: #34363b !important; }
`;

/**
 * @param {{ label: string, run: () => void, tab?: string }[]} actions
 *   버튼들. `tab` 이 있으면 그 탭 안에, 없으면 패널 아래쪽 공용 줄에 놓는다.
 */
export function createSettingsPanel(actions) {
  setStyle('panel', BASE_CSS);

  const gear = document.createElement('button');
  gear.id = 'mlpp-gear';
  gear.type = 'button';
  gear.textContent = '⚙';
  gear.title = 'Mul.Live++ 관리 패널';
  // 한 번이라도 열어 봤으면 조용히 있는다.
  if (settings.get('panelSeen') === 0) gear.classList.add('mlpp-attract');

  const panel = document.createElement('div');
  panel.id = 'mlpp-panel';

  const title = document.createElement('h2');
  title.textContent = 'Mul.Live++ 관리 패널';
  panel.append(title);

  /** @type {Map<string, HTMLSelectElement | HTMLInputElement>} */
  const controls = new Map();

  // 스키마에 적힌 탭 순서 그대로 만든다. 설정을 추가하면 UI가 알아서 따라온다.
  const tabNames = [...new Set(settings.SCHEMA.map((f) => f.tab))];
  const tabBar = document.createElement('div');
  tabBar.className = 'mlpp-tabs';
  /** @type {Map<string, HTMLElement>} */
  const bodies = new Map();
  /** @type {Map<string, HTMLButtonElement>} */
  const tabButtons = new Map();

  /** @param {string} name */
  function showTab(name) {
    for (const [tab, body] of bodies) body.classList.toggle('mlpp-active', tab === name);
    for (const [tab, button] of tabButtons) button.classList.toggle('mlpp-active', tab === name);
  }

  for (const name of tabNames) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = name;
    button.addEventListener('click', () => showTab(name));
    tabBar.append(button);
    tabButtons.set(name, button);

    const body = document.createElement('div');
    body.className = 'mlpp-tab-body';
    const hints = settings.TAB_HINTS[name] ?? [];
    if (hints.length > 0) {
      const box = document.createElement('div');
      box.className = 'mlpp-hint';
      for (const hint of hints) {
        const line = document.createElement('div');
        line.className = hint.rule ? 'mlpp-hint-line mlpp-rule' : 'mlpp-hint-line';
        const label = document.createElement('b');
        label.textContent = `${hint.label}: `;
        line.append(label, hint.text);
        box.append(line);
      }
      body.append(box);
    }
    bodies.set(name, body);
  }
  panel.append(tabBar, ...bodies.values());

  /** @type {Map<string, HTMLElement>} 묶음 이름 → 항목이 들어갈 가로 줄 */
  const groupRows = new Map();

  /**
   * 항목이 들어갈 자리. 묶음이 지정돼 있으면 상자를 처음 만날 때 만들어 탭에 붙인다.
   * @param {import('./settings.js').Field} field
   * @returns {HTMLElement | undefined}
   */
  function slotFor(field) {
    const body = bodies.get(field.tab);
    if (!field.group) return body;
    const key = `${field.tab}/${field.group}`;
    let rows = groupRows.get(key);
    if (!rows) {
      const box = document.createElement('div');
      box.className = 'mlpp-group';
      const legend = document.createElement('div');
      legend.className = 'mlpp-group-name';
      legend.textContent = field.group;
      rows = document.createElement('div');
      rows.className = 'mlpp-group-rows';
      box.append(legend, rows);
      const help = settings.GROUP_HELP[field.group];
      if (help) {
        const line = document.createElement('div');
        line.className = 'mlpp-help';
        line.textContent = help;
        box.append(line);
      }
      body?.append(box);
      groupRows.set(key, rows);
    }
    return rows;
  }

  for (const field of settings.SCHEMA) {
    const row = document.createElement('div');
    row.className = field.indent ? 'mlpp-row mlpp-sub' : 'mlpp-row';

    const label = document.createElement('div');
    label.className = 'mlpp-label';
    const name = document.createElement('span');
    name.className = 'mlpp-name';
    name.textContent = field.name;
    label.append(name);

    /** @type {HTMLSelectElement | HTMLInputElement} */
    let control;
    if (field.type === 'bool') {
      const input = document.createElement('input');
      input.type = 'checkbox';
      control = input;
      label.append(input);
    } else if (field.type === 'enum') {
      const select = document.createElement('select');
      (field.options ?? []).forEach((text, i) => {
        const option = document.createElement('option');
        option.value = String(i);
        option.textContent = text;
        select.append(option);
      });
      control = select;
      if (field.inline) label.append(select);
    } else {
      const input = document.createElement('input');
      input.type = 'number';
      if (field.min !== undefined) input.min = String(field.min);
      if (field.max !== undefined) input.max = String(field.max);
      input.step = '1';
      control = input;
      // 이름 다음에 입력칸, 그 다음에 단위 순서로 붙인다.
      label.append(input);
      if (field.unit) {
        const unit = document.createElement('span');
        unit.className = 'mlpp-unit';
        unit.textContent = field.unit;
        label.append(unit);
      }
    }

    function commit() {
      if (field.type === 'bool') {
        settings.set(field.key, /** @type {HTMLInputElement} */ (control).checked ? 1 : 0);
        return;
      }
      const raw = Number(control.value);
      if (!Number.isFinite(raw)) return;
      const min = field.min ?? (field.type === 'enum' ? 0 : -Infinity);
      const max = field.max ?? (field.type === 'enum' ? (field.options?.length ?? 1) - 1 : Infinity);
      settings.set(field.key, Math.min(max, Math.max(min, Math.round(raw))));
    }
    // 체크박스는 브라우저에 따라 change로만 오는 경우가 있어 둘 다 받는다. 같은 값이면 중복 호출은 무해하다.
    control.addEventListener('input', commit);
    control.addEventListener('change', commit);

    controls.set(field.key, control);
    row.append(label);
    // enum은 폭을 다 쓰므로 라벨 아래 줄에 둔다. inline과 숫자는 위에서 이미 라벨 안에 붙였다.
    if (field.type === 'enum' && !field.inline) row.append(control);

    if (field.help) {
      const help = document.createElement('div');
      help.className = 'mlpp-help';
      help.textContent = field.help;
      row.append(help);
    }
    slotFor(field)?.append(row);
  }

  // 탭에 매인 버튼은 그 탭 맨 아래에 붙인다.
  for (const name of tabNames) {
    const mine = actions.filter((a) => a.tab === name);
    if (mine.length === 0) continue;
    const row = document.createElement('div');
    row.className = 'mlpp-tab-actions';
    for (const action of mine) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = action.label;
      button.addEventListener('click', () => action.run());
      row.append(button);
    }
    bodies.get(name)?.append(row);
  }

  showTab(tabNames[0]);

  const bar = document.createElement('div');
  bar.className = 'mlpp-actions';
  for (const action of [...actions.filter((a) => !a.tab), { label: '설정 초기화', run: () => settings.resetAll() }]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = action.label;
    button.addEventListener('click', () => action.run());
    bar.append(button);
  }
  panel.append(bar);

  /** 저장된 값을 컨트롤에 채운다. 다른 곳(리사이저 드래그 등)에서 바뀌어도 열 때마다 맞춘다. */
  function sync() {
    for (const field of settings.SCHEMA) {
      const control = controls.get(field.key);
      if (!control) continue;
      const value = settings.get(field.key);
      if (field.type === 'bool') /** @type {HTMLInputElement} */ (control).checked = value !== 0;
      else control.value = String(value);
    }
  }

  function open() {
    sync();
    panel.classList.add('mlpp-open');
    gear.classList.add('mlpp-open');
    gear.classList.remove('mlpp-attract');
    if (settings.get('panelSeen') === 0) settings.set('panelSeen', 1);
  }

  function close() {
    panel.classList.remove('mlpp-open');
    gear.classList.remove('mlpp-open');
  }

  gear.addEventListener('click', (e) => {
    e.stopPropagation();
    if (panel.classList.contains('mlpp-open')) close();
    else open();
  });
  panel.addEventListener('click', (e) => e.stopPropagation());
  document.addEventListener('click', close);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });
  // 값이 다른 경로로 바뀌면(리사이저 드래그 등) 열려 있는 패널도 따라가야 한다.
  settings.onChange(() => {
    if (panel.classList.contains('mlpp-open')) sync();
  });

  document.body.append(gear, panel);
  sync();
}
