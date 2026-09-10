'use strict';
/* =========================================================
   Pokedrock Battle Factory - UI / Game Flow
   ========================================================= */

const TYPE_CLASS = (t) => 't-' + (t || 'normal');

const TYPE_ID = {
  bug: 1, dark: 2, dragon: 3, electric: 4, fairy: 5, fighting: 6, fire: 7,
  flying: 8, ghost: 9, grass: 10, ground: 11, ice: 12, normal: 13, poison: 14,
  psychic: 15, rock: 16, steel: 17, water: 18, sound: 19, shine: 20,
};
function typeIconHtml(type) {
  const id = TYPE_ID[type];
  if (id === undefined) return '';
  return `<img src="./type/${id}.png" alt="" class="move-row-type-icon" onerror="this.style.display='none'">`;
}

const state = {
  playerTeam: [],
  cpuTeam: [],
  playerActive: null,
  cpuActive: null,
  winStreak: 0,
  battleBusy: false,
  screen: 'title',
  // ---- マルチプレイ用 ----
  playerName: '',
  opponentName: '',
  roomId: null,
  isHost: false,
  multiplayer: false,
  mpHostEvents: [],
};

// ---- UIクリック効果音 ----
const clickSound = new Audio('./click.mp3');
clickSound.volume = 0.5;
document.addEventListener('click', (e) => {
  if (e.target.closest('button')) {
    try {
      clickSound.currentTime = 0;
      clickSound.play().catch(() => {});
    } catch (err) {}
  }
}, true);

function $(id) { return document.getElementById(id); }

/* ---------------- Fullscreen & orientation ---------------- */
const PC_MIN_WIDTH = 900;
function isPcDevice() {
  const hasTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
  const hasFinePointer = window.matchMedia && window.matchMedia('(pointer: fine)').matches;
  const pointerSaysPc = !hasTouch && hasFinePointer;
  const wideEnough = Math.max(window.innerWidth, window.innerHeight) >= PC_MIN_WIDTH;
  return pointerSaysPc || wideEnough;
}

function requestFullscreenAndLandscape() {
  const el = document.documentElement;
  const reqFs = el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen || el.msRequestFullscreen;
  try {
    if (reqFs) {
      const p = reqFs.call(el);
      if (p && p.then) p.catch(() => {});
    }
  } catch (e) {}
  try {
    if (screen.orientation && screen.orientation.lock) {
      screen.orientation.lock('landscape').catch(() => {});
    }
  } catch (e) {}
}

function checkOrientation() {
  if (isPcDevice()) { $('rotate-hint').classList.remove('show'); return; }
  if (state.screen === 'title') { $('rotate-hint').classList.remove('show'); return; }
  const isPortrait = window.innerHeight > window.innerWidth;
  $('rotate-hint').classList.toggle('show', isPortrait);
}
window.addEventListener('resize', checkOrientation);
window.addEventListener('orientationchange', checkOrientation);

/* ---------------- Screen switch ---------------- */
function showScreen(name) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
  $('screen-' + name).classList.add('active');
  state.screen = name;
  checkOrientation();
}

/* ---------------- Sprite helpers ---------------- */
function spriteImgTag(speciesId, cls) {
  return `<img src="./${speciesId}.png" class="${cls}" onerror="this.replaceWith(makeFallback(${speciesId}, this.className))">`;
}
function fallbackColor(speciesId) {
  const hue = (speciesId * 47) % 360;
  return `hsl(${hue},55%,58%)`;
}
window.makeFallback = function (speciesId, originalClass) {
  const div = document.createElement('div');
  div.className = 'sprite-fallback ' + originalClass;
  const isOpp = originalClass.includes('sprite-opp');
  div.style.width = isOpp ? '90px' : '116px';
  div.style.height = isOpp ? '90px' : '116px';
  div.style.background = fallbackColor(speciesId);
  div.style.fontSize = isOpp ? '30px' : '38px';
  div.textContent = '#' + speciesId;
  return div;
};

function renderTeamCard(poke, idx) {
  const t1 = poke.species.type1, t2 = poke.species.type2;
  return `
    <div class="trade-poke-card" data-idx="${idx}">
      <button class="tpc-info-btn" data-info-idx="${idx}" type="button"><span>!</span></button>
      <img src="./${poke.speciesId}.png" alt="${poke.species.name}" class="tpc-sprite"
           onerror="this.replaceWith(makeTeamCardFallback(${poke.speciesId}))">
      <div class="tpc-name">${poke.species.name}</div>
      <div class="tpc-types">
        <span class="type-chip ${TYPE_CLASS(t1)}">${typeJp(t1)}</span>
        ${t2 ? `<span class="type-chip ${TYPE_CLASS(t2)}">${typeJp(t2)}</span>` : ''}
      </div>
    </div>
  `;
}
window.makeTeamCardFallback = function (speciesId) {
  const div = document.createElement('div');
  div.className = 'tpc-noimg';
  div.textContent = '#' + speciesId;
  return div;
};

/* ---------------- Message queue ---------------- */
let msgQueue = [];
let msgResolve = null;
const MSG_AUTO_MS = 750;
const LOG_STACK_MAX = 5;
let logLines = [];

function queueMessage(text, after) {
  msgQueue.push({ text, after });
}
function hideMessageToast() {}
function pushLogLine(text) {
  const stack = $('battle-log-stack');
  const el = document.createElement('div');
  el.className = 'battle-log-line';
  el.textContent = text;
  stack.appendChild(el);
  logLines.push(el);
  while (logLines.length > LOG_STACK_MAX) {
    const old = logLines.shift();
    old.classList.add('leaving');
    old.addEventListener('animationend', () => old.remove(), { once: true });
    setTimeout(() => old.remove(), 200);
  }
}
function drainMessages() {
  return new Promise((resolve) => {
    async function showNext() {
      if (msgQueue.length === 0) { resolve(); return; }
      const item = msgQueue.shift();
      pushLogLine(item.text);
      if (item.after) { try { await item.after(); } catch (e) {} }
      let done = false;
      const advance = () => {
        if (done) return;
        done = true;
        msgResolve = null;
        clearTimeout(timer);
        showNext();
      };
      const timer = setTimeout(advance, MSG_AUTO_MS);
      msgResolve = advance;
    }
    showNext();
  });
}
$('battle-log-stack').addEventListener('click', () => { if (msgResolve) msgResolve(); });


/* ---------------- HUD update ---------------- */
function hpBarColor(ratio) {
  if (ratio > 0.5) return getComputedStyle(document.documentElement).getPropertyValue('--accent-hp');
  if (ratio > 0.2) return getComputedStyle(document.documentElement).getPropertyValue('--accent-hp-mid');
  return getComputedStyle(document.documentElement).getPropertyValue('--accent-hp-low');
}

function updateHud(poke, prefix, hpOverride) {
  $(prefix + '-name').textContent = poke.species.name;
  $(prefix + '-lv').textContent = 'Lv' + poke.level;
  const hp = hpOverride === undefined ? poke.currentHp : hpOverride;
  const ratio = Math.max(0, hp / poke.maxHp);
  const bar = $(prefix + '-hpbar');
  const committedWidth = getComputedStyle(bar).width;
  bar.style.width = committedWidth;
  void bar.offsetWidth;
  bar.style.width = (ratio * 100) + '%';
  bar.style.background = hpBarColor(ratio);
  const statusEl = $(prefix + '-status');
  if (poke.status && poke.status !== 0) {
    statusEl.innerHTML = `<span class="hud-status-chip status-${poke.status}">${STATUS_JP[poke.status] || ''}</span>`;
  } else {
    statusEl.innerHTML = '';
  }
  if (prefix === 'self') {
    $('self-hp-text').textContent = `${hp}/${poke.maxHp}`;
  } else {
    $('opp-hp-percent').textContent = `${Math.ceil(ratio * 100)}%`;
  }
}

function setSprite(poke, side) {
  const wrap = $(side === 'opp' ? 'sprite-opp-wrap' : 'sprite-self-wrap');
  const cls = side === 'opp' ? 'sprite sprite-opp enter-opp' : 'sprite sprite-self enter-self';
  wrap.innerHTML = spriteImgTag(poke.speciesId, cls);
  if (state.multiplayer && state.isHost) {
    const hostSide = side === 'opp' ? 'cpu' : 'player';
    const team = hostSide === 'player' ? state.playerTeam : state.cpuTeam;
    const idx = team.indexOf(poke);
    Net.pushEvent({
      k: 'sprite', s: hostSide, idx,
      sid: poke.speciesId, n: poke.species.name, lv: poke.level,
      hp: poke.currentHp, mhp: poke.maxHp, st: poke.status || 0,
    });
  }
}

function flashHit(side) {
  const wrap = $(side === 'opp' ? 'sprite-opp-wrap' : 'sprite-self-wrap');
  const img = wrap.querySelector('img, .sprite-fallback');
  if (!img) return Promise.resolve();
  img.classList.add('hit');
  return new Promise((res) => setTimeout(() => { img.classList.remove('hit'); res(); }, 160));
}
function playFaint(side) {
  const wrap = $(side === 'opp' ? 'sprite-opp-wrap' : 'sprite-self-wrap');
  const img = wrap.querySelector('img, .sprite-fallback');
  if (!img) return Promise.resolve();
  img.classList.add('faint');
  return new Promise((res) => setTimeout(res, 350));
}

/* ---------------- Command panel rendering ---------------- */
function renderActionMenu() {
  closeWatchOverlay();
  const dock = $('cmd-dock');
  dock.classList.remove('dock-wide');
  const panel = $('cmd-panel');
  panel.style.cssText = '';
  panel.className = 'cmd-panel action-menu';
  panel.innerHTML = `
    <button class="neu-btn cmd-btn" id="act-fight">たたかう</button>
    <button class="neu-btn cmd-btn" id="act-switch">ポケモン</button>
  `;
  $('act-watch').disabled = false;
  $('act-watch').onclick = () => openWatchOverlay();
  $('act-fight').addEventListener('click', () => renderMoveMenu());
  $('act-switch').addEventListener('click', () => {
    if (state.playerActive.bindTurns > 0) {
      queueMessage(`${state.playerActive.species.name}はバインドされていて交代できない！`);
      drainMessages().then(() => {});
      return;
    }
    renderSwitchMenu();
  });
}

function renderMoveMenu() {
  const dock = $('cmd-dock');
  dock.classList.add('dock-wide');
  const panel = $('cmd-panel');
  panel.style.cssText = '';
  panel.className = 'cmd-panel move-list';
  const poke = state.playerActive;
  const moveButtons = poke.moves.map((m, idx) => `
    <button class="neu-btn cmd-btn move-row ${TYPE_CLASS(m.type)}-edge" data-idx="${idx}" ${(m.pp <= 0 || m.locked) ? 'disabled' : ''}>
      ${typeIconHtml(m.type)}
      <span class="move-row-name">${m.name}</span>
      <span class="move-row-pp">PP ${m.pp}/${m.maxPp}</span>
      ${m.locked ? '<span style="color:#ff5d5d;font-size:10px;font-weight:900;">🔒</span>' : ''}
    </button>
  `).join('');
  panel.innerHTML = moveButtons + `
    <button class="neu-btn cmd-btn move-row-back" id="act-move-back">もどる</button>
  `;
  panel.querySelectorAll('button[data-idx]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.idx, 10);
      playerChooseMove(poke.moves[idx]);
    });
  });
  $('act-move-back').addEventListener('click', () => renderActionMenu());
  $('act-watch').disabled = false;
  $('act-watch').onclick = () => openWatchOverlay();
}

/* ---------------- Watch overlay ---------------- */
const RANK_JP = { atk: '攻撃', def: '防御', spa: '特攻', spd: '特防', spe: '素早さ', acc: '命中', eva: '回避' };
const RANK_ORDER = ['atk', 'def', 'spa', 'spd', 'spe', 'acc', 'eva'];
let watchSelectedSide = 'self';

function rankArrowsHtml(v) {
  const MAX = 6;
  const mag = Math.min(MAX, Math.abs(v || 0));
  if (v > 0) {
    const filled = '▲'.repeat(mag);
    const empty = '<span class="dim">' + '△'.repeat(MAX - mag) + '</span>';
    return `<span class="watch-rank-arrows up">${filled}${empty}</span>`;
  }
  if (v < 0) {
    const filled = '▼'.repeat(mag);
    const empty = '<span class="dim">' + '▽'.repeat(MAX - mag) + '</span>';
    return `<span class="watch-rank-arrows down">${filled}${empty}</span>`;
  }
  return `<span class="watch-rank-arrows"><span class="dim">${'△'.repeat(MAX)}</span></span>`;
}

function getEffectiveTypesForDisplay(poke) {
  if (!poke || !poke.species) return [];
  const t1 = poke.species.type1;
  const t2 = poke.species.type2;
  let types = [];
  if (poke.changedType) {
    types = [poke.changedType];
  } else {
    if (t1 && !poke.removedTypes.includes(t1)) types.push(t1);
    if (t2 && !poke.removedTypes.includes(t2)) types.push(t2);
  }
  return [...new Set(types)];
}

function typesHtml(poke) {
  if (!poke || !poke.species) return '';
  const types = getEffectiveTypesForDisplay(poke);
  return types.map((t) => `
    <span class="watch-type-chip">
      ${typeIconHtml(t)}
      <span class="watch-type-name">${GAME_DATA.typeKeyToJp[t] || t}</span>
    </span>
  `).join('');
}

function ranksHtml(poke) {
  const ranks = poke && poke.ranks;
  if (!ranks) return `<div class="watch-empty">変化なし</div>`;
  const rows = RANK_ORDER.map((k) => {
    const v = ranks[k] || 0;
    return `<div class="watch-rank-row"><span class="watch-rank-name">${RANK_JP[k]}</span>${rankArrowsHtml(v)}</div>`;
  });
  return rows.join('');
}

function statusBadgeLabel(poke) {
  if (poke && poke.status) return STATUS_JP[poke.status] || poke.status;
  return null;
}

function typeChangeLabel(poke) {
  if (!poke) return null;
  const parts = [];
  if (poke.changedType) {
    parts.push(`タイプ: ${typeJp(poke.changedType)}（変化）`);
  }
  if (poke.removedTypes && poke.removedTypes.length > 0) {
    parts.push(`タイプ消失: ${poke.removedTypes.map(t => typeJp(t)).join('、')}`);
  }
  if (poke.typeLockTurns > 0 && poke.typeLockType) {
    parts.push(`タイプロック: ${typeJp(poke.typeLockType)} ${poke.typeLockTurns}ターン`);
  }
  return parts.length > 0 ? parts.join('、') : null;
}

function watchSideItemHtml(poke, side, isSelected) {
  const label = side === 'self' ? 'じぶん' : 'あいて';
  const ratio = poke ? Math.max(0, poke.currentHp / poke.maxHp) : 0;
  const iconHtml = poke
    ? `<img src="./${poke.speciesId}.png" alt="" class="wsi-icon" onerror="this.replaceWith(makeTeamCardFallback(${poke.speciesId}))">`
    : `<div class="wsi-icon">-</div>`;
  const typeLabel = poke ? getEffectiveTypesForDisplay(poke).map(t => typeJp(t)).join('/') : '-';
  return `
    <button class="watch-side-item ${isSelected ? 'active' : ''}" data-side="${side}">
      ${iconHtml}
      <div class="wsi-info">
        <div class="wsi-tag">${label}</div>
        <div class="wsi-name">${poke ? poke.species.name : '-'} <span style="font-size:10px;color:var(--ink-soft);">${typeLabel}</span></div>
        <div class="wsi-hpbar-outer"><div class="wsi-hpbar-inner" style="width:${ratio * 100}%; background:${hpBarColor(ratio)}"></div></div>
      </div>
    </button>
  `;
}

function renderWatchSideList() {
  const self = state.playerActive;
  const opp = state.cpuActive;
  $('watch-side-list').innerHTML = [
    watchSideItemHtml(self, 'self', watchSelectedSide === 'self'),
    watchSideItemHtml(opp, 'opp', watchSelectedSide === 'opp'),
  ].join('');
  $('watch-side-list').querySelectorAll('.watch-side-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      watchSelectedSide = btn.dataset.side;
      renderWatchOverlay();
    });
  });
}

function renderWatchDetail() {
  const poke = watchSelectedSide === 'self' ? state.playerActive : state.cpuActive;
  $('watch-detail-name').textContent = poke ? poke.species.name : '-';
  $('watch-detail-lv').textContent = poke ? `Lv${poke.level}` : '';
  const ratio = poke ? Math.max(0, poke.currentHp / poke.maxHp) : 0;
  $('watch-detail-hpbar').style.width = `${ratio * 100}%`;
  $('watch-detail-hpbar').style.background = hpBarColor(ratio);
  if (!poke) {
    $('watch-detail-hp-text').textContent = '0/0';
  } else if (watchSelectedSide === 'self') {
    $('watch-detail-hp-text').textContent = `${poke.currentHp}/${poke.maxHp}`;
  } else {
    $('watch-detail-hp-text').textContent = `HP ${Math.ceil(ratio * 100)}%`;
  }
  $('watch-detail-types').innerHTML = poke ? typesHtml(poke) : '';
  $('watch-detail-ranks').innerHTML = ranksHtml(poke);

  const badgeEl = $('watch-detail-status-badge');
  const badgeLabel = statusBadgeLabel(poke);
  if (badgeLabel) {
    badgeEl.textContent = badgeLabel;
    badgeEl.style.display = '';
  } else {
    badgeEl.textContent = '';
    badgeEl.style.display = 'none';
  }

  const typeChangeLabelEl = document.getElementById('watch-detail-type-change');
  if (!typeChangeLabelEl) {
    const el = document.createElement('div');
    el.id = 'watch-detail-type-change';
    el.style.cssText = 'font-size:11px;font-weight:700;color:var(--accent-b);margin-top:4px;';
    $('watch-detail-hp-text').after(el);
  }
  const label = typeChangeLabel(poke);
  document.getElementById('watch-detail-type-change').textContent = label || '';
}

function renderWatchField() {
  const poke = watchSelectedSide === 'self' ? state.playerActive : state.cpuActive;
  const chips = [];

  if (battleField.weather && battleField.weather !== 'none') {
    chips.push(`${WEATHER_JP[battleField.weather] || battleField.weather} ${battleField.weatherTurns}ターン`);
  }
  if (battleField.terrain && battleField.terrain !== 'none') {
    chips.push(`${TERRAIN_JP[battleField.terrain] || battleField.terrain} ${battleField.terrainTurns}ターン`);
  }

  if (battleField.tailwindPlayer > 0 && watchSelectedSide === 'self') {
    chips.push(`おいかぜ ${battleField.tailwindPlayer}ターン`);
  } else if (battleField.tailwindCpu > 0 && watchSelectedSide === 'opp') {
    chips.push(`おいかぜ ${battleField.tailwindCpu}ターン`);
  }

  if (battleField.trickRoom) {
    chips.push(`トリックルーム ${battleField.trickRoomTurns}ターン`);
  }

  const tauntTurns = poke ? poke.tauntTurns || 0 : 0;
  if (tauntTurns > 0) chips.push(`ちょうはつ ${tauntTurns}ターン`);

  const reflectTurns = watchSelectedSide === 'self' ? battleField.playerReflect : battleField.cpuReflect;
  const lightScreenTurns = watchSelectedSide === 'self' ? battleField.playerLightScreen : battleField.cpuLightScreen;
  if (reflectTurns > 0) chips.push(`リフレクター ${reflectTurns}ターン`);
  if (lightScreenTurns > 0) chips.push(`ひかりのかべ ${lightScreenTurns}ターン`);

  if (poke && poke.bindTurns > 0) {
    chips.push(`バインド ${poke.bindTurns}ターン`);
  }

  if (poke && poke.utsusemiTurns > 0) {
    chips.push(`うつせみ ${poke.utsusemiTurns}ターン後に発動`);
  }

  if (poke && poke.encoreTurns > 0 && poke.encoreMoveId !== null) {
    const move = poke.moves.find(m => m.id === poke.encoreMoveId);
    chips.push(`アンコール ${move ? move.name : ''} ${poke.encoreTurns}ターン`);
  }

  if (poke && poke.typeLockTurns > 0 && poke.typeLockType) {
    chips.push(`タイプロック: ${typeJp(poke.typeLockType)} ${poke.typeLockTurns}ターン`);
  }

  if (poke && poke.removedTypes && poke.removedTypes.length > 0) {
    chips.push(`タイプ消失: ${poke.removedTypes.map(t => typeJp(t)).join('、')}`);
  }

  if (poke && poke.changedType) {
    chips.push(`タイプ変化: ${typeJp(poke.changedType)}`);
  }

  const hazardSideKey = watchSelectedSide === 'self' ? 'player' : 'cpu';
  const hz = (typeof hazardState !== 'undefined') ? hazardState[hazardSideKey] : null;
  if (hz && hz.stealthRock) chips.push('ステルスロック');
  if (hz && hz.replugTrap) chips.push('リプループラグ');

  const row = $('watch-status-row');
  row.innerHTML = chips.length
    ? chips.map((c) => `<span class="watch-status-chip">${c}</span>`).join('')
    : `<span class="watch-empty">なし</span>`;
}

function renderWatchOverlay() {
  renderWatchSideList();
  renderWatchDetail();
  renderWatchField();
}

function openWatchOverlay() {
  watchSelectedSide = 'self';
  renderWatchOverlay();
  $('watch-overlay').classList.add('show');
}
function closeWatchOverlay() {
  $('watch-overlay').classList.remove('show');
}
$('watch-close').addEventListener('click', () => closeWatchOverlay());

function renderSwitchMenu() {
  openPartyOverlay('switch');
}

/* ---------------- Party (Pokémon select) overlay ---------------- */
const JA_STAT_NAME = { hp: 'HP', atk: '攻撃', def: '防御', spa: '特攻', spd: '特防', spe: '素早さ' };

function abilityNameById(id) {
  if (id == null) return null;
  const names = (typeof GAME_DATA !== 'undefined' && GAME_DATA.abilityNames) || {};
  return names[id] != null ? names[id] : null;
}
const ABILITY_DESC_BY_ID = {
3: '毎ターン すばやさが あがる',
16: '登場時に相手の攻撃を1段階下げる',
32: '相手のPPを余計に消費させる',
33: 'ほのお・こおりタイプのダメージを半減する',
36: '連続行動できなくなる',
51: '技の命中率が1.3倍になる',
53: '威力60以下の技の威力が1.5倍になる',
56: '技の追加効果が出やすくなる（確率2倍）',
62: 'ノーマルの技がフェアリーになる（威力1.2倍）',
64: 'HP満タン時に受けるダメージが半減する',
65: '能力ランクの変化が逆転する',
66: '技の威力が1.3倍になるが追加効果がなくなる',
67: '相手から能力を下げられない',
68: '自分と同じタイプの技の威力が1.5倍になる',
69: 'お互いの技が必中する',
70: '接触する技（物理技）の威力が1.3倍になる',
71: '変化技を優先的に出せる（優先度+1）',
74: '急所に当たりやすくなる',
75: '相手の特性の効果を無視する',
76: '登場時に相手の特性をコピーする',
77: '効果抜群のダメージを0.75倍に軽減する',
78: '急所ダメージが2.25倍になる',
79: '攻撃が1.5倍になるが命中率が0.8倍になる',
84: 'HP満タン時、飛行技の優先度が+1される',
90: 'ひるみ状態にならない',
91: 'すべての状態異常にならない',
92: '命中ランクが下がらない',
93: '砂嵐時、岩・地面・鋼技の威力が1.3倍になる',
94: '草技を無効化し攻撃が1段階上がる',
95: '毎ターン、ランダムな能力+2、別の能力-1',
97: '技の追加効果を受けない',
98: '能力が下がると攻撃が+2される',
99: '能力が下がると特攻が+2される',
102: '攻撃を受けると防御が+1される',
103: 'ダメージを受けると防御-1、素早さ+2',
104: '瀕死時に相手に最大HPの1/4ダメージ',
19: 'じめんタイプのわざをうけない',
72: 'サウンドタイプの技の威力が1.2倍になる',
73: 'シャインタイプの技の威力が1.2倍になる',
80: 'ノーマルの技がこおりになる（威力1.2倍）',
81: 'ノーマルの技がでんきになる（威力1.2倍）',
82: 'ノーマルの技がドラゴンになる（威力1.2倍）',
83: 'ノーマルの技がエスパーになる（威力1.2倍）',
112: '相手を倒すたびに攻撃が上がる',
113: '相手を倒すたびに特攻が上がる',
133: 'HPが減るとACSが+1、BDが-1',
86: 'きるタイプの技の威力が1.5倍になる',
87: 'かむタイプの技の威力が1.5倍になる',
88: 'はどうタイプの技の威力が1.5倍になる',
89: 'こぶしタイプの技の威力が1.5倍になる',
105: '物理技を受けると30%で相手の技を1つ封じる',
106: '場に出ている間、全員の特性が無効になる',
107: '控えに戻るとHPが最大の1/3回復する',
108: '相手の能力上昇をトレース',
109: 'HP半分で特攻+1',
110: '相手の特性がわかる',
111: '相手の危険な技を2つログ表示',
126: '相手の優先度+1以上の技を無効化',
127: '物理技のダメージが半減する',
128: '特殊技のダメージが半減する',
129: '初ターンの技威力が1.5倍になる',
132: '自分にかかる能力変化が2倍になる',
134: '毎ターン、エナジースタックを1つ獲得する',
135: '電気技を使う時、全スタック消費して威力上昇（×30）',
136: 'スタック2で素早さ+1、3で防御・特防+2',
137: 'スタック数×0.2倍、技威力が上昇する',
115: '連続技が必ず最大回数当たる',
122: '相手の危険な技を2つログ表示（111と同じ）',
123: '相手の壁（リフレクター・ひかりのかべ）を貫通する',
125: '変化技を跳ね返す',
  41: 'ピンチに くさのいりょくが あがる',
  42: 'ピンチに ほのおのいりょくが あがる',
  43: 'ピンチに みずのいりょくが あがる',
  44: 'ピンチに むしのいりょくが あがる',
  5: 'HPが 満タンのとき 技を 受けても 一撃で 倒されることが ない',
  45: 'わざの はんどうダメージ をうけない',
  9: 'でんきを うけない',
  10: 'みずを うけない',
  14: 'ほのおを うけない',
  101: 'むしを うけない',
  4: 'わざを きゅうしょに うけない',
  17: 'さわった あいてを キズつける',
  25: 'こうげきが 2ばいになる',
  46: 'とうじょう したときに 5ターンのあいだ てんきを ひでりに する',
  31: 'とうじょう したときに 5ターンのあいだ てんきを すなあらしに する',
  2: 'とうじょう したときに 5ターンのあいだ てんきを あめに する',
  57: 'とうじょう したときに 5ターンのあいだ てんきを ゆきに する',
  138: 'とうじょう したときに 5ターンのあいだ てんきを ほしぞらに する',
  116: 'とうじょう したときに 5ターンのあいだ フィールドを グラスフィールドにする',
  117: 'とうじょう したときに 5ターンのあいだ フィールドを エレキフィールドにする',
  118: 'とうじょう したときに 5ターンのあいだ フィールドを サイコフィールドにする',
  119: 'とうじょう したときに 5ターンのあいだ フィールドを ミストフィールドにする',
  120: 'とうじょう したときに 5ターンのあいだ フィールドを メロディフィールドにする',
  23: 'あめの とき すばやさが 2ばいになる',
  24: 'ひでりの とき すばやさが 2ばいになる',
  59: 'ゆきの とき すばやさが 2ばいになる',
  60: 'すなあらしの とき すばやさが 2ばいになる',
  30: 'あめの とき ターン終了時に すこしずつ HPが かいふくする',
  100: 'ゆきの とき こうげき と とくこうが 1.5ばいに あがるが、こうげき したあと じぶんも ダメージを うける',
  96: 'ひでりの とき とくこうが 1.5ばいに あがるが、こうげき したあと じぶんも ダメージを うける',
  6: 'まひ状態に ならない',
  8: 'さわった あいてを 30%の かくりつで まひ状態に する',
  11: 'ねむり状態に ならない',
  39: 'やけど状態の とき こうげきが 1.5ばいに あがる',
  40: 'じょうたいいじょうの とき ぼうぎょが 1.5ばいに あがる',
  54: 'はがねタイプや どくタイプの あいてにも どく状態の わざを あてられる',
  63: 'じょうたいいじょうの とき すばやさが 1.5ばいに あがる',
  131: 'さわった あいてを 50%の かくりつで もうどく状態に する',
  34: 'さわった あいてを 30%の かくりつで やけど状態に する',
};
function abilityDescById(id) {
  if (id == null) return '';
  return ABILITY_DESC_BY_ID[id] || '';
}
function getAbilityInfo(poke) {
  const a = poke.ability;
  if (a && typeof a === 'object') {
    const id = a.id;
    return { name: a.name || abilityNameById(id) || '', desc: a.desc || a.description || abilityDescById(id) };
  }
  if (a != null) {
    const nm = abilityNameById(a);
    if (nm) return { name: nm, desc: abilityDescById(a) };
  }
  if (poke.abilityId != null) {
    const nm = abilityNameById(poke.abilityId);
    if (nm) return { name: nm, desc: abilityDescById(poke.abilityId) };
  }
  const speciesAbilities = poke.species && poke.species.abilities;
  if (Array.isArray(speciesAbilities) && speciesAbilities.length > 0) {
    const nm = abilityNameById(speciesAbilities[0]);
    if (nm) return { name: nm, desc: abilityDescById(speciesAbilities[0]) };
  }
  return null;
}
function getStatBlock(poke) {
  const stats = poke.stats || (poke.species && poke.species.baseStats);
  const evsRaw = poke.evs || {};
  const order = ['hp', 'spe', 'atk', 'def', 'spa', 'spd'];
  const evs = Array.isArray(evsRaw)
    ? { hp: evsRaw[0], atk: evsRaw[1], def: evsRaw[2], spa: evsRaw[3], spd: evsRaw[4], spe: evsRaw[5] }
    : evsRaw;
  return order.map((key) => ({
    key,
    label: JA_STAT_NAME[key],
    value: stats && stats[key] != null ? stats[key] : null,
    ev: evs && evs[key] != null ? evs[key] : null,
  }));
}

function partyListItemHtml(p, idx) {
  const isActive = p === state.playerActive;
  const ratio = Math.max(0, p.currentHp / p.maxHp);
  const statusTag = (p.status && p.status !== 0) ? `<span class="pli-status-tag status-${p.status}">${STATUS_JP[p.status] || ''}</span>` : '';
  let typeChangeText = '';
  if (p.changedType) {
    typeChangeText = `→${typeJp(p.changedType)}`;
  } else if (p.removedTypes && p.removedTypes.length > 0) {
    typeChangeText = `(${p.removedTypes.map(t => typeJp(t)).join('')}消失)`;
  }
  return `
    <button class="party-list-item ${isActive ? 'active' : ''} ${p.fainted ? 'fainted' : ''}" data-idx="${idx}" ${p.fainted ? 'disabled' : ''}>
      <img src="./${p.speciesId}.png" alt="" class="pli-icon" onerror="this.replaceWith(makeTeamCardFallback(${p.speciesId}))">
      <div class="pli-info">
        <div class="pli-name">${p.species.name} <span style="font-size:10px;color:var(--accent-b);">${typeChangeText}</span></div>
        <div class="pli-hpbar-outer"><div class="pli-hpbar-inner" style="width:${ratio * 100}%; background:${hpBarColor(ratio)};"></div></div>
        <div class="pli-hp-text">${p.currentHp}/${p.maxHp}</div>
        ${isActive ? '<div class="pli-active-tag">たたかっている</div>' : statusTag}
        <div class="pli-hp-text" style="font-size:8.5px;color:var(--accent-b);">スタック: ${p.energyStacks || 0}</div>
      </div>
    </button>
  `;
}

function partyDetailHtml(p) {
  const effectiveTypes = getEffectiveTypesForDisplay(p);
  const typeDisplay = effectiveTypes.map(t => `
    <span class="type-chip ${TYPE_CLASS(t)}">${typeJp(t)}</span>
  `).join('');
  const movesHtml = p.moves.map((m) => `
    <div class="pd-move-row ${TYPE_CLASS(m.type)}-edge ${m.locked ? 'pd-move-locked' : ''}" style="${m.locked ? 'opacity:0.4;border-left-color:#ff5d5d;' : ''}">
      <span class="pd-move-name">${m.name}${m.locked ? ' 🔒' : ''}</span>
      <span class="pd-move-pp">PP ${m.pp}/${m.maxPp}</span>
    </div>
  `).join('');
  const ability = getAbilityInfo(p);
  const statBlock = getStatBlock(p);
  const statsHtml = statBlock.map((s) => `
    <div class="pd-stat-row">
      <span class="pd-stat-name">${s.label}</span>
      <span class="pd-stat-values">
        <span class="pd-stat-value">${s.value != null ? s.value : '—'}</span>${s.ev != null ? `<span class="pd-stat-ev">${s.ev}</span>` : ''}
      </span>
    </div>
  `).join('');

  let typeChangeInfo = '';
  if (p.changedType) {
    typeChangeInfo = `<div style="font-size:11px;font-weight:700;color:var(--accent-b);">タイプ: ${typeJp(p.changedType)}（変化）</div>`;
  }
  if (p.removedTypes && p.removedTypes.length > 0) {
    typeChangeInfo += `<div style="font-size:11px;font-weight:700;color:#ff5d5d;">タイプ消失: ${p.removedTypes.map(t => typeJp(t)).join('、')}</div>`;
  }

  return `
    <div class="pd-header">
      <span class="pd-name">${p.species.name}</span>
      <span class="pd-lv">Lv${p.level}</span>
      <div class="pd-types">
        ${typeDisplay}
      </div>
    </div>
    ${typeChangeInfo}
    <div class="pd-section-title">わざ</div>
    <div class="pd-moves">${movesHtml}</div>
    <div class="pd-lower">
      <div class="pd-ability-box">
        <div class="pd-ability-label">特性</div>
        <div class="pd-ability-name">${ability ? ability.name : '—'}</div>
        ${ability && ability.desc ? `<div class="pd-ability-desc">${ability.desc}</div>` : ''}
      </div>
      <div class="pd-stats">${statsHtml}</div>
    </div>
  `;
}

let partySelectedIdx = null;
let partyArmedIdx = null;
let partyMode = 'switch';
let forcedSwitchResolve = null;

function openPartyOverlay(mode) {
  partyMode = mode || 'switch';
  partyArmedIdx = null;
  if (partyMode === 'forced') {
    const firstAlive = state.playerTeam.findIndex((p) => !p.fainted);
    partySelectedIdx = firstAlive >= 0 ? firstAlive : 0;
  } else {
    partySelectedIdx = state.playerTeam.indexOf(state.playerActive);
  }
  renderPartyOverlay();
  $('party-overlay').classList.add('show');
  $('party-close').style.display = partyMode === 'forced' ? 'none' : '';
}
function closePartyOverlay() {
  $('party-overlay').classList.remove('show');
}

function renderPartyOverlay() {
  const list = $('party-list');
  list.innerHTML = state.playerTeam.map((p, idx) => partyListItemHtml(p, idx)).join('');
  renderPartyDetail();
}

function renderPartyDetail() {
  const idx = partySelectedIdx != null ? partySelectedIdx : 0;
  const p = state.playerTeam[idx];
  $('party-detail').innerHTML = partyDetailHtml(p);
}

$('party-close').addEventListener('click', () => closePartyOverlay());

/* ---- Switch confirmation dialog ---- */
function askConfirm(text) {
  return new Promise((resolve) => {
    $('confirm-text').textContent = text;
    $('confirm-overlay').classList.add('show');
    const yesBtn = $('confirm-yes');
    const noBtn = $('confirm-no');
    const cleanup = () => {
      $('confirm-overlay').classList.remove('show');
      yesBtn.onclick = null;
      noBtn.onclick = null;
    };
    yesBtn.onclick = () => { cleanup(); resolve(true); };
    noBtn.onclick = () => { cleanup(); resolve(false); };
  });
}

function attachPartySwitchHandler() {
  $('party-list').addEventListener('click', async (e) => {
    const btn = e.target.closest('.party-list-item');
    if (!btn || btn.disabled) return;
    const idx = parseInt(btn.dataset.idx, 10);

    if (partyMode !== 'switch' && partyMode !== 'forced') {
      partySelectedIdx = idx;
      renderPartyDetail();
      return;
    }

    if (partyMode === 'switch' && state.playerTeam[idx] === state.playerActive) {
      partySelectedIdx = idx;
      partyArmedIdx = null;
      renderPartyDetail();
      return;
    }

    const alreadyArmed = partyArmedIdx === idx;
    partySelectedIdx = idx;
    renderPartyDetail();

    if (!alreadyArmed) {
      partyArmedIdx = idx;
      return;
    }

    const target = state.playerTeam[idx];
    const ok = await askConfirm(`${target.species.name}と交代しますか？`);
    if (ok) {
      closePartyOverlay();
      if (partyMode === 'forced') {
        if (forcedSwitchResolve) { const r = forcedSwitchResolve; forcedSwitchResolve = null; r(idx); }
      } else {
        playerChooseSwitch(idx);
      }
    }
  });
}
attachPartySwitchHandler();

/* ---------------- Battle flow ---------------- */
let turnResolve = null;

function playerChooseMove(move) {
  const action = { type: 'move', move };
  $('cmd-panel').innerHTML = '';
  $('cmd-dock').classList.remove('dock-wide');
  $('act-watch').disabled = true;
  if (turnResolve) { const r = turnResolve; turnResolve = null; r(action); }
}
function playerChooseSwitch(idx) {
  const action = { type: 'switch', idx };
  $('cmd-panel').innerHTML = '';
  $('cmd-dock').classList.remove('dock-wide');
  $('act-watch').disabled = true;
  if (turnResolve) { const r = turnResolve; turnResolve = null; r(action); }
}

function waitForPlayerAction() {
  renderActionMenu();
  return new Promise((resolve) => { turnResolve = resolve; });
}

function updateFieldDisplay() {
  state.weather = battleField.weather !== 'none'
    ? { label: `${WEATHER_JP[battleField.weather]}（残り${battleField.weatherTurns}ターン）` }
    : null;
  state.terrain = battleField.terrain !== 'none'
    ? { label: `${TERRAIN_JP[battleField.terrain]}（残り${battleField.terrainTurns}ターン）` }
    : null;
}

function makeLogFn() {
  return (text, meta) => {
    let uiSide = null;
    let hpSnapshot = null;
    if (meta && meta.hit) {
      uiSide = meta.hit === 'player' ? 'self' : 'opp';
      const poke = meta.hit === 'player' ? state.playerActive : state.cpuActive;
      hpSnapshot = poke ? poke.currentHp : 0;
    }
    queueMessage(text, async () => {
      if (uiSide) {
        await flashHit(uiSide);
        const poke = meta.hit === 'player' ? state.playerActive : state.cpuActive;
        updateHud(poke, uiSide, hpSnapshot);
      }
    });
    // ホスト → ゲストへのイベント収集
    if (state.multiplayer && state.isHost) {
      state.mpHostEvents.push({
        k: 'msg', t: text,
        h: meta && meta.hit ? meta.hit : null,
        hp: hpSnapshot,
        f: meta && meta.faint ? meta.faint : null,
      });
    }
  };
}

async function doSwitch(newActive, side) {
  newActive.side = side;
  if (side === 'player') {
    state.playerActive = newActive;
    setSprite(newActive, 'self');
    updateHud(newActive, 'self');
  } else {
    state.cpuActive = newActive;
    setSprite(newActive, 'opp');
    updateHud(newActive, 'opp');
  }
  applyHazardsOnSwitchIn(newActive, side, makeLogFn());
  await drainMessages();
  const opponent = side === 'player' ? state.cpuActive : state.playerActive;
  applyWeatherTerrainAbilityOnSwitchIn(newActive, makeLogFn(), opponent);
  await drainMessages();
  updateHud(newActive, side === 'player' ? 'self' : 'opp');
  updateFieldDisplay();
}

async function pickNextAlive(team) {
  return team.find((p) => !p.fainted) || null;
}

function hasAliveBackup(team, active) {
  return team.some((p) => p !== active && !p.fainted);
}

async function resolvePendingSwitchOuts() {
  if (state.cpuActive.pendingSwitchOut && !state.cpuActive.fainted) {
    state.cpuActive.pendingSwitchOut = false;
    if (state.cpuActive.bindTurns > 0) {
      queueMessage(`${state.cpuActive.species.name}はバインドされていて交代できない！`);
      await drainMessages();
    } else if (hasAliveBackup(state.cpuTeam, state.cpuActive)) {
      const outgoing = state.cpuActive;
      const next = state.cpuTeam.find((p) => p !== outgoing && !p.fainted);
      if (next) {
        applyBatonPass(outgoing, next);
        queueMessage(`相手は${outgoing.species.name}をひっこめた！`);
        await drainMessages();
        queueMessage(`相手は${next.species.name}をくり出した！`);
        await drainMessages();
        await doSwitch(next, 'cpu');
      }
    }
  }
  if (state.playerActive.pendingSwitchOut && !state.playerActive.fainted) {
    state.playerActive.pendingSwitchOut = false;
    if (state.playerActive.bindTurns > 0) {
      queueMessage(`${state.playerActive.species.name}はバインドされていて交代できない！`);
      await drainMessages();
    } else if (hasAliveBackup(state.playerTeam, state.playerActive)) {
      const outgoing = state.playerActive;
      queueMessage(`${outgoing.species.name}、もどれ！`);
      await drainMessages();
      const idx = await waitForForcedSwitch();
      const next = state.playerTeam[idx];
      applyBatonPass(outgoing, next);
      await doSwitch(next, 'player');
      queueMessage(`ゆけっ！${next.species.name}！`);
      await drainMessages();
    }
  }
}

function applyBatonPass(outgoing, incoming) {
  if (!outgoing.batonPass) return;
  incoming.ranks = { ...outgoing.batonPass.ranks };
  incoming.confuseTurns = outgoing.batonPass.confuseTurns || 0;
  outgoing.batonPass = null;
}

async function resolveImmediateSwitch(side) {
  if (side === 'cpu') {
    const outgoing = state.cpuActive;
    if (outgoing.bindTurns > 0) {
      queueMessage(`${outgoing.species.name}はバインドされていて交代できない！`);
      await drainMessages();
      return null;
    }
    if (!hasAliveBackup(state.cpuTeam, outgoing)) return null;
    const next = state.cpuTeam.find((p) => p !== outgoing && !p.fainted);
    if (!next) return null;
    applyBatonPass(outgoing, next);
    queueMessage(`相手は${outgoing.species.name}をひっこめた！`);
    await drainMessages();
    queueMessage(`相手は${next.species.name}をくり出した！`);
    await drainMessages();
    await doSwitch(next, 'cpu');
    return next;
  } else {
    const outgoing = state.playerActive;
    if (outgoing.bindTurns > 0) {
      queueMessage(`${outgoing.species.name}はバインドされていて交代できない！`);
      await drainMessages();
      return null;
    }
    if (!hasAliveBackup(state.playerTeam, outgoing)) return null;
    queueMessage(`${outgoing.species.name}、もどれ！`);
    await drainMessages();
    const idx = await waitForForcedSwitch();
    const next = state.playerTeam[idx];
    applyBatonPass(outgoing, next);
    await doSwitch(next, 'player');
    queueMessage(`ゆけっ！${next.species.name}！`);
    await drainMessages();
    return next;
  }
}

async function runBattleLoop() {
  state.battleBusy = true;
  state.playerActive.side = 'player';
  state.cpuActive.side = 'cpu';
  updateHud(state.playerActive, 'self');
  updateHud(state.cpuActive, 'opp');
  setSprite(state.cpuActive, 'opp');
  setSprite(state.playerActive, 'self');

  queueMessage(`${state.cpuActive.species.name}が現れた！`);
  queueMessage(`ゆけっ！${state.playerActive.species.name}！`);
  await drainMessages();
  resetHazards();
  resetField();
  updateFieldDisplay();
  applyWeatherTerrainAbilityOnSwitchIn(state.cpuActive, makeLogFn(), state.playerActive);
  await drainMessages();
  applyWeatherTerrainAbilityOnSwitchIn(state.playerActive, makeLogFn(), state.cpuActive);
  await drainMessages();
  updateFieldDisplay();

  while (true) {
    if (state.playerTeam.every((p) => p.fainted)) { await endBattle(false); return; }
    if (state.cpuTeam.every((p) => p.fainted)) { await endBattle(true); return; }

    const playerAction = await waitForPlayerAction();

    if (playerAction.type === 'switch') {
      const newP = state.playerTeam[playerAction.idx];
      queueMessage(`${state.playerActive.species.name}、もどれ！`);
      await drainMessages();
      await doSwitch(newP, 'player');
      queueMessage(`ゆけっ！${newP.species.name}！`);
      await drainMessages();
      if (!state.playerActive.fainted) {
        const cpuAction = chooseCpuAction(state.cpuActive, state.playerActive);
        await runTurn({ type: 'none' }, cpuAction, state.playerActive, state.cpuActive, makeLogFn(), resolveImmediateSwitch);
        await drainMessages();
      }
      await postTurnCleanupAndRender();
      continue;
    }

    const cpuAction = chooseCpuAction(state.cpuActive, state.playerActive);
    await runTurn(playerAction, cpuAction, state.playerActive, state.cpuActive, makeLogFn(), resolveImmediateSwitch);
    await drainMessages();
    await postTurnCleanupAndRender();
  }
}

async function postTurnCleanupAndRender() {
  await resolvePendingSwitchOuts();

  while (state.cpuActive.fainted) {
    await playFaint('opp');
    if (state.cpuTeam.every((p) => p.fainted)) break;
    const next = await pickNextAlive(state.cpuTeam);
    if (!next) break;
    queueMessage(`相手は${next.species.name}をくり出した！`);
    await drainMessages();
    await doSwitch(next, 'cpu');
  }
  while (state.playerActive.fainted) {
    await playFaint('self');
    const alive = state.playerTeam.filter((p) => !p.fainted);
    if (alive.length === 0) break;
    queueMessage(`つぎのポケモンをえらんでください`);
    await drainMessages();
    const idx = await waitForForcedSwitch();
    await doSwitch(state.playerTeam[idx], 'player');
  }
  updateHud(state.playerActive, 'self');
  updateHud(state.cpuActive, 'opp');
  updateFieldDisplay();
}

function waitForForcedSwitch() {
  $('cmd-dock').classList.remove('dock-wide');
  $('act-watch').disabled = true;
  $('cmd-panel').innerHTML = '';
  return new Promise((resolve) => {
    forcedSwitchResolve = resolve;
    openPartyOverlay('forced');
  });
}

async function endBattle(playerWon) {
  state.battleBusy = false;
  if (playerWon) state.winStreak++;
  const overlay = $('result-overlay');
  $('result-title').textContent = playerWon ? 'WIN' : 'LOSE';
  $('result-title').className = 'result-title ' + (playerWon ? 'win' : 'lose');
  $('result-desc').textContent = playerWon
    ? `${state.winStreak}連勝中！つぎの相手が待っている。`
    : `連勝は${state.winStreak}でストップ。またチャレンジしよう！`;
  overlay.classList.add('show');

  $('btn-result-next').onclick = async () => {
    overlay.classList.remove('show');
    if (playerWon) {
      await runTradeSequence();
      renderReorderScreen();
    } else {
      state.winStreak = 0;
      showScreen('title');
    }
  };
}

/* ---------------- Post-win trade sequence ---------------- */
function tradeCardHtml(p, idx, disabled) {
  const effectiveTypes = getEffectiveTypesForDisplay(p);
  const typeDisplay = effectiveTypes.map(t => `
    <span class="type-chip ${TYPE_CLASS(t)}">${typeJp(t)}</span>
  `).join('');
  return `
    <div class="trade-poke-card ${disabled ? 'disabled' : ''}" data-idx="${idx}">
      <button class="tpc-info-btn" data-info-idx="${idx}" type="button"><span>!</span></button>
      <img src="./${p.speciesId}.png" alt="${p.species.name}" class="tpc-sprite"
           onerror="this.replaceWith(makeTeamCardFallback(${p.speciesId}))">
      <div class="tpc-name">${p.species.name}</div>
      <div class="tpc-types">
        ${typeDisplay}
      </div>
      <div class="tpc-hp">HP ${p.currentHp}/${p.maxHp}</div>
    </div>
  `;
}

function showTradeDetail(poke) {
  $('trade-detail-card').innerHTML = partyDetailHtml(poke);
  $('trade-detail-overlay').classList.add('show');
}
$('trade-detail-close').addEventListener('click', () => {
  $('trade-detail-overlay').classList.remove('show');
});

function runTradeSequence() {
  return new Promise((resolve) => {
    const offerOverlay = $('trade-overlay');
    const offerRow = $('trade-offer-row');
    offerRow.innerHTML = state.cpuTeam.map((p, idx) => tradeCardHtml(p, idx, false)).join('');
    offerOverlay.classList.add('show');

    const onOfferClick = async (e) => {
      const infoBtn = e.target.closest('.tpc-info-btn');
      if (infoBtn) {
        const idx = parseInt(infoBtn.dataset.infoIdx, 10);
        showTradeDetail(state.cpuTeam[idx]);
        return;
      }
      const card = e.target.closest('.trade-poke-card');
      if (!card) return;
      const offerIdx = parseInt(card.dataset.idx, 10);
      const chosen = state.cpuTeam[offerIdx];
      const ok = await askConfirm(`${chosen.species.name}をもらいますか？`);
      if (!ok) return;
      offerRow.removeEventListener('click', onOfferClick);
      offerOverlay.classList.remove('show');
      runReplaceStep(chosen, resolve);
    };
    offerRow.addEventListener('click', onOfferClick);
  });
}

function runReplaceStep(incoming, doneResolve) {
  const replaceOverlay = $('trade-replace-overlay');
  const replaceRow = $('trade-replace-row');
  $('trade-replace-title').textContent = `${incoming.species.name}と交換するポケモンをえらんでください`;
  replaceRow.innerHTML = state.playerTeam.map((p, idx) => tradeCardHtml(p, idx, false)).join('');
  replaceOverlay.classList.add('show');

  const onReplaceClick = async (e) => {
    const infoBtn = e.target.closest('.tpc-info-btn');
    if (infoBtn) {
      const idx = parseInt(infoBtn.dataset.infoIdx, 10);
      showTradeDetail(state.playerTeam[idx]);
      return;
    }
    const card = e.target.closest('.trade-poke-card');
    if (!card) return;
    const replaceIdx = parseInt(card.dataset.idx, 10);
    const outgoing = state.playerTeam[replaceIdx];
    const ok = await askConfirm(`${outgoing.species.name}と${incoming.species.name}を交換しますか？`);
    if (!ok) return;
    replaceRow.removeEventListener('click', onReplaceClick);
    replaceOverlay.classList.remove('show');

    const incomingCopy = Object.assign({}, incoming);
    incomingCopy.moves = incoming.moves.map((m) => Object.assign({}, m));
    resetPokeForBattle(incomingCopy);
    state.playerTeam[replaceIdx] = incomingCopy;

    doneResolve();
  };
  replaceRow.addEventListener('click', onReplaceClick);
}

/* ---------------- Battle setup ---------------- */
function resetPokeForBattle(poke) {
  poke.currentHp = poke.maxHp;
  poke.status = 0;
  poke.badlyPoisonCounter = 0;
  poke.confuseTurns = 0;
  poke.sleepTurns = 0;
  poke.flinch = false;
  poke.fainted = false;
  poke.ranks = { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, acc: 0, eva: 0 };
  poke.moves.forEach((m) => { m.pp = m.maxPp; m.locked = false; });
  poke.energyStacks = 0;
  poke.fundoTriggered = false;
  poke.moraibiActive = false;
  poke.lazyTurns = false;
  poke.firstTurn = true;
  poke.gyakujouTriggered = false;
  poke.tauntTurns = 0;
  poke.bindTurns = 0;
  poke.removedTypes = [];
  poke.changedType = null;
  poke.typeLockTurns = 0;
  poke.typeLockType = null;
  poke.lastUsedMoveId = null;
  poke.encoreMoveId = null;
  poke.encoreTurns = 0;
  poke.utsusemiTurns = 0;
  poke.infernoUsed = false;
}

function startNextCpuBattle() {
  state.cpuTeam = drawRandomTeam(3);
  state.cpuTeam.forEach(resetPokeForBattle);
  state.playerTeam.forEach(resetPokeForBattle);
  state.playerActive = state.playerTeam.find((p) => !p.fainted) || state.playerTeam[0];
  state.cpuActive = state.cpuTeam[0];
  showScreen('battle');
  msgQueue = [];
  runBattleLoop();
}

/* ---------------- Initial pick ---------------- */
let pickPool = [];
let pickedIds = [];

function pickCardHtml(poke, idx) {
  const t1 = poke.species.type1, t2 = poke.species.type2;
  const orderPos = pickedIds.indexOf(idx);
  const orderLabel = orderPos >= 0 ? `${orderPos + 1}` : '';
  return `
    <div class="trade-poke-card ${orderPos >= 0 ? 'selected' : ''}" data-idx="${idx}">
      <button class="tpc-info-btn" data-info-idx="${idx}" type="button"><span>!</span></button>
      ${orderPos >= 0 ? `<span class="pick-order-badge">${orderLabel}</span>` : ''}
      <img src="./${poke.speciesId}.png" alt="${poke.species.name}" class="tpc-sprite"
           onerror="this.replaceWith(makeTeamCardFallback(${poke.speciesId}))">
      <div class="tpc-name">${poke.species.name}</div>
      <div class="tpc-types">
        <span class="type-chip ${TYPE_CLASS(t1)}">${typeJp(t1)}</span>
        ${t2 ? `<span class="type-chip ${TYPE_CLASS(t2)}">${typeJp(t2)}</span>` : ''}
      </div>
    </div>
  `;
}

function renderPickRow() {
  $('pick-row').innerHTML = pickPool.map((p, idx) => pickCardHtml(p, idx)).join('');
  $('pick-count').textContent = `${pickedIds.length} / 3 選択中`;
  $('btn-pick-confirm').disabled = pickedIds.length !== 3;
}

function showInitialPickOverlay() {
  const ids = [...getFinalSpeciesIds()].sort(() => Math.random() - 0.5).slice(0, 6);
  pickPool = ids.map((id) => createRandomPokemon(id, 100));
  pickedIds = [];
  renderPickRow();
  $('pick-overlay').classList.add('show');
}

$('pick-row').addEventListener('click', (e) => {
  const infoBtn = e.target.closest('.tpc-info-btn');
  if (infoBtn) {
    const idx = parseInt(infoBtn.dataset.infoIdx, 10);
    showTradeDetail(pickPool[idx]);
    return;
  }
  const card = e.target.closest('.trade-poke-card');
  if (!card) return;
  const idx = parseInt(card.dataset.idx, 10);
  const already = pickedIds.indexOf(idx);
  if (already >= 0) {
    pickedIds.splice(already, 1);
  } else if (pickedIds.length < 3) {
    pickedIds.push(idx);
  }
  renderPickRow();
});

$('btn-pick-confirm').addEventListener('click', () => {
  if (pickedIds.length !== 3) return;
  state.playerTeam = pickedIds.map((idx) => pickPool[idx]);
  $('pick-overlay').classList.remove('show');
  if (state.multiplayer) {
    onMultiplayerPickConfirm();
  } else {
    renderReorderScreen();
  }
});

/* ---------------- Team reorder screen ---------------- */
let reorderMode = false;
let reorderArmedIdx = null;

function renderReorderScreen() {
  reorderMode = false;
  reorderArmedIdx = null;
  $('btn-reorder-toggle').textContent = '並び替えをする';
  $('team-cards').classList.remove('reorder-mode');
  renderReorderCards();
  showScreen('team');
}

function renderReorderCards() {
  const cardsHtml = state.playerTeam.map((poke, idx) => {
    const armed = reorderMode && reorderArmedIdx === idx;
    const base = renderTeamCard(poke, idx);
    return base.replace(
      'class="trade-poke-card"',
      `class="trade-poke-card reorder-poke-card ${armed ? 'swap-armed' : ''}"`
    );
  }).join('');
  $('team-cards').innerHTML = cardsHtml;
}

$('btn-reorder-toggle').addEventListener('click', () => {
  reorderMode = !reorderMode;
  reorderArmedIdx = null;
  $('btn-reorder-toggle').textContent = reorderMode ? '並び替えをやめる' : '並び替えをする';
  $('team-cards').classList.toggle('reorder-mode', reorderMode);
  renderReorderCards();
});

$('team-cards').addEventListener('click', (e) => {
  const infoBtn = e.target.closest('.tpc-info-btn');
  if (infoBtn) {
    const idx = parseInt(infoBtn.dataset.infoIdx, 10);
    showTradeDetail(state.playerTeam[idx]);
    return;
  }
  if (!reorderMode) return;
  const card = e.target.closest('.reorder-poke-card');
  if (!card) return;
  const idx = parseInt(card.dataset.idx, 10);
  if (reorderArmedIdx === null) {
    reorderArmedIdx = idx;
  } else if (reorderArmedIdx === idx) {
    reorderArmedIdx = null;
  } else {
    const tmp = state.playerTeam[reorderArmedIdx];
    state.playerTeam[reorderArmedIdx] = state.playerTeam[idx];
    state.playerTeam[idx] = tmp;
    reorderArmedIdx = null;
  }
  renderReorderCards();
});

function startNewRun() {
  state.multiplayer = false;
  state.winStreak = 0;
  showInitialPickOverlay();
}

/* =========================================================
   マルチプレイ用UI
   ========================================================= */

function generateRoomId() {
  return String(Math.floor(Math.random() * 9000) + 1000);
}

function showMultiplayerMenu() {
  showScreen('multiplayer');
}

let nameModalMode = 'create';

function updateNameCharCount() {
  const nameLen = ($('input-player-name').value || '').length;
  $('name-char-count').textContent = nameLen;
  const codeLen = ($('input-room-code').value || '').length;
  $('code-char-count').textContent = codeLen;
}

function openNameModal(mode) {
  nameModalMode = mode;
  $('name-modal-title').textContent = mode === 'create' ? 'ルームを作成' : 'あいことばで入室';
  $('join-code-field').style.display = mode === 'join' ? '' : 'none';
  $('input-player-name').value = state.playerName || '';
  $('input-room-code').value = '';
  updateNameCharCount();
  $('name-modal').classList.add('show');
  setTimeout(() => {
    try { $('input-player-name').focus(); } catch (e) {}
  }, 60);
}

function closeNameModal() {
  $('name-modal').classList.remove('show');
}

function onNameModalConfirm() {
  const name = ($('input-player-name').value || '').trim();
  if (!name) { $('input-player-name').focus(); return; }
  state.playerName = name;

  if (nameModalMode === 'create') {
    closeNameModal();
    startHostRoom();
  } else {
    const code = ($('input-room-code').value || '').trim();
    if (!/^\d{4}$/.test(code)) { $('input-room-code').focus(); return; }
    closeNameModal();
    joinRoom(code);
  }
}

async function startHostRoom() {
  state.isHost = true;
  let code = null;
  for (let i = 0; i < 8; i++) {
    const candidate = generateRoomId();
    const r = await Net.createRoom(candidate, state.playerName);
    if (r === 'ok') { code = candidate; break; }
  }
  if (!code) {
    alert('ルーム作成に失敗しました。firebase-config.js と通信環境を確認してください。');
    showMultiplayerMenu();
    return;
  }
  state.roomId = code;
  $('host-wait-title').textContent = 'ルームを作成しました';
  $('host-wait-player-name').textContent = `${state.playerName} さん`;
  $('host-room-id').textContent = code;
  $('host-wait-hint').textContent = '友達にこの4ケタの番号を伝えてください';
  $('host-wait-cancel').textContent = 'キャンセル';
  showScreen('host-waiting');

  Net.onGuestJoined((guestName) => {
    state.opponentName = guestName;
    $('host-wait-hint').textContent = `${guestName} さんが入室しました！`;
    setTimeout(() => { startMultiplayerPick(); }, 700);
  });
}

async function joinRoom(code) {
  state.isHost = false;
  const r = await Net.joinRoom(code, state.playerName);
  if (r === 'not-found') { alert('そのルームは見つかりませんでした。'); return; }
  if (r === 'full') { alert('そのルームは満員、またはすでに対戦中です。'); return; }
  if (r === 'error') { alert('接続に失敗しました。'); return; }
  state.roomId = code;
  $('host-wait-title').textContent = 'ルームに参加しました';
  $('host-wait-player-name').textContent = `${state.playerName} さん`;
  $('host-room-id').textContent = code;
  $('host-wait-hint').textContent = `ホスト（${Net.opponentName} さん）の準備を待っています…`;
  $('host-wait-cancel').textContent = 'もどる';
  showScreen('host-waiting');

  Net.onStatusChange((status) => {
    if (status === 'both-in') { startMultiplayerPick(); }
  });
}

function cancelHostRoom() {
  Net.leave();
  state.roomId = null;
  state.isHost = false;
  showMultiplayerMenu();
}

/* ---- 選出 ---- */
function startMultiplayerPick() {
  state.multiplayer = true;
  state.winStreak = 0;
  state.opponentName = Net.opponentName || '';
  const ids = [...getFinalSpeciesIds()].sort(() => Math.random() - 0.5).slice(0, 6);
  pickPool = ids.map((id) => createRandomPokemon(id, 100));
  pickedIds = [];
  renderPickRow();
  $('pick-overlay').classList.add('show');
}

async function onMultiplayerPickConfirm() {
  if (pickedIds.length !== 3) return;
  state.playerTeam = pickedIds.map((idx) => pickPool[idx]);
  state.playerTeam.forEach(resetPokeForBattle);
  await Net.sendTeam(state.playerTeam);

  // バトル画面へ移動して待機
  showScreen('battle');
  $('battle-log-stack').innerHTML = '';
  logLines = [];
  msgQueue = [];
  pushLogLine('相手の選出を待っています…');

  Net.onOpponentTeam(async (oppTeam) => {
    state.cpuTeam = oppTeam;
    state.cpuTeam.forEach(resetPokeForBattle);
    state.playerActive = state.playerTeam[0];
    state.cpuActive = state.cpuTeam[0];
    state.playerActive.side = 'player';
    state.cpuActive.side = 'cpu';

    // 初期描画
    updateHud(state.playerActive, 'self');
    updateHud(state.cpuActive, 'opp');
    setSprite(state.playerActive, 'self');
    setSprite(state.cpuActive, 'opp');

    $('battle-log-stack').innerHTML = '';
    logLines = [];

    if (state.isHost) {
      await runMultiplayerBattleHost();
    } else {
      await runMultiplayerBattleGuest();
    }
  });
}

/* =========================================================
   ホスト側バトルループ
   ========================================================= */
async function runMultiplayerBattleHost() {
  await Net.clearEvents();
  state.battleBusy = true;

  resetHazards();
  resetField();
  updateFieldDisplay();

  state.mpHostEvents = [];
  queueMessage(`${state.cpuActive.species.name}が現れた！`);
  queueMessage(`ゆけっ！${state.playerActive.species.name}！`);
  await drainMessages();
  await Net.pushEvents(state.mpHostEvents);

  state.mpHostEvents = [];
  applyWeatherTerrainAbilityOnSwitchIn(state.cpuActive, makeLogFn(), state.playerActive);
  await drainMessages();
  applyWeatherTerrainAbilityOnSwitchIn(state.playerActive, makeLogFn(), state.cpuActive);
  await drainMessages();
  await Net.pushEvents(state.mpHostEvents);

  await Net.pushEvent({ k: 'turn-end' });

  while (true) {
    if (state.playerTeam.every((p) => p.fainted)) { await endMultiplayerBattleHost(true); return; }
    if (state.cpuTeam.every((p) => p.fainted)) { await endMultiplayerBattleHost(false); return; }

    const myAction = await waitForPlayerAction();
    await Net.sendAction(myAction);

    const guestRaw = await new Promise((resolve) => {
      Net.waitForOpponentAction(resolve);
    });
    const guestAction = resolveRemoteAction(guestRaw, state.cpuActive);

    state.mpHostEvents = [];
    msgQueue = [];

    if (myAction.type === 'switch') {
      const newP = state.playerTeam[myAction.idx];
      queueMessage(`${state.playerActive.species.name}、もどれ！`);
      await drainMessages();
      await doSwitch(newP, 'player');
      queueMessage(`ゆけっ！${newP.species.name}！`);
      await drainMessages();
    }

    if (state.playerActive && !state.playerActive.fainted &&
        state.cpuActive && !state.cpuActive.fainted) {
      const playerAct = myAction.type === 'switch' ? { type: 'none' } : myAction;
      await runTurn(playerAct, guestAction, state.playerActive, state.cpuActive,
                    makeLogFn(), resolveImmediateSwitchMultiplayer);
      await drainMessages();
    }

    await postTurnCleanupMultiplayerHost();

    await Net.pushEvents(state.mpHostEvents);
    await Net.pushEvent({ k: 'turn-end' });
  }
}

async function resolveImmediateSwitchMultiplayer(side) {
  if (side === 'cpu') {
    const outgoing = state.cpuActive;
    if (outgoing.bindTurns > 0) {
      queueMessage(`${outgoing.species.name}はバインドされていて交代できない！`);
      await drainMessages();
      return null;
    }
    if (!hasAliveBackup(state.cpuTeam, outgoing)) return null;
    Net.pushEvent({ k: 'force-switch', s: 'cpu' });
    const raw = await new Promise((resolve) => {
      Net.waitForOpponentAction(resolve);
    });
    const idx = raw && typeof raw.idx === 'number' ? raw.idx : 0;
    const next = state.cpuTeam[idx] || state.cpuTeam.find((p) => p !== outgoing && !p.fainted);
    if (!next) return null;
    applyBatonPass(outgoing, next);
    queueMessage(`相手は${outgoing.species.name}をひっこめた！`);
    await drainMessages();
    queueMessage(`相手は${next.species.name}をくり出した！`);
    await drainMessages();
    await doSwitch(next, 'cpu');
    return next;
  } else {
    const outgoing = state.playerActive;
    if (outgoing.bindTurns > 0) {
      queueMessage(`${outgoing.species.name}はバインドされていて交代できない！`);
      await drainMessages();
      return null;
    }
    if (!hasAliveBackup(state.playerTeam, outgoing)) return null;
    queueMessage(`${outgoing.species.name}、もどれ！`);
    await drainMessages();
    const idx = await waitForForcedSwitch();
    const next = state.playerTeam[idx];
    applyBatonPass(outgoing, next);
    await doSwitch(next, 'player');
    queueMessage(`ゆけっ！${next.species.name}！`);
    await drainMessages();
    return next;
  }
}

async function postTurnCleanupMultiplayerHost() {
  while (state.cpuActive.fainted) {
    await playFaint('opp');
    if (state.cpuTeam.every((p) => p.fainted)) break;
    Net.pushEvent({ k: 'force-switch', s: 'cpu' });
    const raw = await new Promise((resolve) => {
      Net.waitForOpponentAction(resolve);
    });
    const idx = raw && typeof raw.idx === 'number' ? raw.idx : 0;
    const next = state.cpuTeam[idx] || state.cpuTeam.find((p) => !p.fainted);
    if (!next) break;
    queueMessage(`相手は${next.species.name}をくり出した！`);
    await drainMessages();
    await doSwitch(next, 'cpu');
  }
  while (state.playerActive.fainted) {
    await playFaint('self');
    const alive = state.playerTeam.filter((p) => !p.fainted);
    if (alive.length === 0) break;
    queueMessage(`つぎのポケモンをえらんでください`);
    await drainMessages();
    const idx = await waitForForcedSwitch();
    await doSwitch(state.playerTeam[idx], 'player');
  }
  updateHud(state.playerActive, 'self');
  updateHud(state.cpuActive, 'opp');
  updateFieldDisplay();
}

async function endMultiplayerBattleHost(hostWon) {
  state.battleBusy = false;
  const overlay = $('result-overlay');
  $('result-title').textContent = hostWon ? 'WIN' : 'LOSE';
  $('result-title').className = 'result-title ' + (hostWon ? 'win' : 'lose');
  $('result-desc').textContent = hostWon ? '勝利！' : '敗北…';
  overlay.classList.add('show');
  Net.pushEvent({ k: 'end', win: hostWon });
  $('btn-result-next').onclick = async () => {
    overlay.classList.remove('show');
    await Net.leave();
    state.multiplayer = false;
    showScreen('title');
  };
}

/* =========================================================
   ゲスト側バトルループ
   ========================================================= */
let guestEventQueue = [];
let guestProcessing = false;
let guestTurnEndResolve = null;

function waitForGuestTurnEnd() {
  return new Promise((resolve) => { guestTurnEndResolve = resolve; });
}

function enqueueGuestEvent(ev) {
  guestEventQueue.push(ev);
  if (!guestProcessing) processGuestEvents();
}

async function processGuestEvents() {
  if (guestEventQueue.length === 0) { guestProcessing = false; return; }
  guestProcessing = true;
  const ev = guestEventQueue.shift();
  await handleGuestEvent(ev);
  processGuestEvents();
}

async function handleGuestEvent(ev) {
  if (!ev) return;

  if (ev.k === 'msg') {
    const uiSide = ev.h === 'player' ? 'opp' : ev.h === 'cpu' ? 'self' : null;
    const poke = ev.h === 'player' ? state.cpuActive : ev.h === 'cpu' ? state.playerActive : null;
    const hpSnapshot = ev.hp;

    msgQueue.push({
      text: ev.t,
      after: async () => {
        if (uiSide && poke) {
          await flashHit(uiSide);
          updateHud(poke, uiSide, hpSnapshot);
        }
        if (ev.f) {
          const fUiSide = ev.f === 'player' ? 'opp' : 'self';
          await playFaint(fUiSide);
        }
      },
    });
    await playGuestMessages();
    return;
  }

  if (ev.k === 'sprite') {
    const uiSide = ev.s === 'player' ? 'opp' : 'self';
    const team = uiSide === 'self' ? state.playerTeam : state.cpuTeam;
    const poke = team.find((p) => p.speciesId === ev.sid && !p.fainted) || team[0];
    if (!poke) return;
    poke.currentHp = ev.hp !== undefined ? ev.hp : poke.currentHp;
    poke.maxHp = ev.mhp !== undefined ? ev.mhp : poke.maxHp;
    poke.status = ev.st !== undefined ? ev.st : poke.status;
    if (uiSide === 'self') state.playerActive = poke; else state.cpuActive = poke;
    setSprite(poke, uiSide);
    updateHud(poke, uiSide);
    return;
  }

  if (ev.k === 'force-switch') {
    const mySide = ev.s === 'cpu' ? 'self' : 'opp';
    if (mySide === 'self') {
      const idx = await waitGuestForcedSwitch();
      await Net.sendAction({ type: 'switch', idx });
    }
    return;
  }

  if (ev.k === 'turn-end') {
    if (guestTurnEndResolve) {
      const r = guestTurnEndResolve;
      guestTurnEndResolve = null;
      r();
    }
    return;
  }

  if (ev.k === 'end') {
    state.battleBusy = false;
    const guestWon = !ev.win;
    const overlay = $('result-overlay');
    $('result-title').textContent = guestWon ? 'WIN' : 'LOSE';
    $('result-title').className = 'result-title ' + (guestWon ? 'win' : 'lose');
    $('result-desc').textContent = guestWon ? '勝利！' : '敗北…';
    overlay.classList.add('show');
    $('btn-result-next').onclick = async () => {
      overlay.classList.remove('show');
      await Net.leave();
      state.multiplayer = false;
      showScreen('title');
    };
    return;
  }
}

async function playGuestMessages() {
  return new Promise((resolve) => {
    function showNext() {
      if (msgQueue.length === 0) { resolve(); return; }
      const item = msgQueue.shift();
      pushLogLine(item.text);
      const afterPromise = item.after ? item.after() : Promise.resolve();
      afterPromise.then(() => {
        setTimeout(() => { showNext(); }, MSG_AUTO_MS);
      });
    }
    showNext();
  });
}

function waitGuestForcedSwitch() {
  $('cmd-dock').classList.remove('dock-wide');
  $('act-watch').disabled = true;
  $('cmd-panel').innerHTML = '';
  return new Promise((resolve) => {
    forcedSwitchResolve = (idx) => {
      forcedSwitchResolve = null;
      closePartyOverlay();
      resolve(idx);
    };
    openPartyOverlay('forced');
  });
}

async function runMultiplayerBattleGuest() {
  state.battleBusy = true;
  guestEventQueue = [];
  guestProcessing = false;
  guestTurnEndResolve = null;

  Net.onEvent((ev) => enqueueGuestEvent(ev));

  while (true) {
    if (state.playerTeam.every((p) => p.fainted)) return;
    if (state.cpuTeam.every((p) => p.fainted)) return;

    const myAction = await waitForPlayerAction();
    await Net.sendAction(myAction);
    await waitForGuestTurnEnd();
  }
}

/* ---- 共通ヘルパー ---- */
function resolveRemoteAction(raw, remotePoke) {
  if (!raw) return { type: 'none' };
  if (raw.type === 'move') {
    const move = remotePoke.moves.find((m) => m.id === raw.moveId);
    if (move) return { type: 'move', move };
    return { type: 'none' };
  }
  if (raw.type === 'switch') return { type: 'switch', idx: raw.idx };
  return { type: 'none' };
}

/* ---------------- Wiring ---------------- */
$('btn-npc-battle').addEventListener('click', () => { startNewRun(); });
$('btn-player-battle').addEventListener('click', () => { showMultiplayerMenu(); });
$('btn-to-battle').addEventListener('click', () => { startNextCpuBattle(); });

$('btn-create-room').addEventListener('click', () => openNameModal('create'));
$('btn-join-room').addEventListener('click', () => openNameModal('join'));
$('multi-back-to-title').addEventListener('click', () => showScreen('title'));

$('name-modal-cancel').addEventListener('click', () => closeNameModal());
$('name-modal-confirm').addEventListener('click', () => onNameModalConfirm());
$('input-player-name').addEventListener('input', updateNameCharCount);

$('input-room-code').addEventListener('input', (e) => {
  e.target.value = (e.target.value || '').replace(/\D/g, '').slice(0, 4);
  updateNameCharCount();
});

$('input-player-name').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    if (nameModalMode === 'create') onNameModalConfirm();
    else $('input-room-code').focus();
  }
});
$('input-room-code').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); onNameModalConfirm(); }
});

$('host-wait-cancel').addEventListener('click', () => cancelHostRoom());

$('screen-title').addEventListener('click', (e) => {
  if (!isPcDevice()) requestFullscreenAndLandscape();
});

checkOrientation();
showScreen('title');