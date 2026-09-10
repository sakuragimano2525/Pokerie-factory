'use strict';
/* =========================================================
   対人戦ネットワーク層（ホスト権威方式）
   - ホストが engine.js を実行し、battle events を Firebase へ push
   - ゲストは events を受信して順番に再生、自分の行動だけ送信
   ========================================================= */

const Net = {
  db: null,
  roomRef: null,
  isHost: false,
  roomId: null,
  playerName: '',
  opponentName: '',
  ready: false,
  _unsubs: [],

  init() {
    if (this.ready) return true;
    if (typeof firebase === 'undefined') {
      console.warn('[Net] Firebase SDK未読込');
      return false;
    }
    if (!FIREBASE_CONFIG || !FIREBASE_CONFIG.databaseURL ||
        FIREBASE_CONFIG.databaseURL.indexOf('YOUR_PROJECT') >= 0) {
      console.warn('[Net] firebase-config.js が未設定');
      return false;
    }
    try {
      if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
      this.db = firebase.database();
      this.ready = true;
      return true;
    } catch (e) {
      console.error('[Net] 初期化失敗', e);
      return false;
    }
  },

  reset() {
    this._unsubs.forEach((fn) => { try { fn(); } catch (e) {} });
    this._unsubs = [];
    this.roomRef = null;
    this.roomId = null;
    this.isHost = false;
    this.opponentName = '';
  },

  async createRoom(code, name) {
    if (!this.init()) return 'error';
    this.isHost = true;
    this.roomId = code;
    this.playerName = name;
    this.roomRef = this.db.ref('rooms/' + code);
    const snap = await this.roomRef.once('value');
    if (snap.exists()) return 'exists';
    await this.roomRef.set({
      meta: {
        hostName: name,
        guestName: null,
        status: 'waiting',
        createdAt: firebase.database.ServerValue.TIMESTAMP,
      },
      hostTeam: null,
      guestTeam: null,
    });
    return 'ok';
  },

  async joinRoom(code, name) {
    if (!this.init()) return 'error';
    this.isHost = false;
    this.roomId = code;
    this.playerName = name;
    this.roomRef = this.db.ref('rooms/' + code);
    const snap = await this.roomRef.once('value');
    if (!snap.exists()) return 'not-found';
    const data = snap.val();
    if (!data.meta) return 'not-found';
    if (data.meta.guestName) return 'full';
    if (data.meta.status !== 'waiting') return 'full';
    this.opponentName = data.meta.hostName || '';
    await this.roomRef.child('meta').update({
      guestName: name,
      status: 'both-in',
    });
    return 'ok';
  },

  onGuestJoined(cb) {
    if (!this.roomRef) return;
    const ref = this.roomRef.child('meta');
    const handler = (snap) => {
      const data = snap.val() || {};
      if (data.guestName) {
        this.opponentName = data.guestName;
        cb(data.guestName);
      }
    };
    ref.on('value', handler);
    this._unsubs.push(() => ref.off('value', handler));
  },

  onStatusChange(cb) {
    if (!this.roomRef) return;
    const ref = this.roomRef.child('meta/status');
    const handler = (snap) => cb(snap.val());
    ref.on('value', handler);
    this._unsubs.push(() => ref.off('value', handler));
  },

  async sendTeam(team) {
    if (!this.roomRef) return;
    const path = this.isHost ? 'hostTeam' : 'guestTeam';
    await this.roomRef.child(path).set(team.map(serializePokeForNet));
  },

  onOpponentTeam(cb) {
    if (!this.roomRef) return;
    const path = this.isHost ? 'guestTeam' : 'hostTeam';
    const ref = this.roomRef.child(path);
    let done = false;
    const handler = (snap) => {
      if (done) return;
      const data = snap.val();
      if (data && Array.isArray(data) && data.length > 0) {
        done = true;
        ref.off('value', handler);
        cb(data.map(deserializePokeFromNet));
      }
    };
    ref.on('value', handler);
    this._unsubs.push(() => ref.off('value', handler));
  },

  async sendAction(action) {
    if (!this.roomRef) return;
    const path = this.isHost ? 'battle/hostAction' : 'battle/guestAction';
    await this.roomRef.child(path).set(serializeAction(action));
  },

  waitForOpponentAction(cb) {
    if (!this.roomRef) return;
    const path = this.isHost ? 'battle/guestAction' : 'battle/hostAction';
    const ref = this.roomRef.child(path);
    const handler = (snap) => {
      const data = snap.val();
      if (data) {
        ref.off('value', handler);
        ref.set(null);
        cb(data);
      }
    };
    ref.on('value', handler);
    this._unsubs.push(() => ref.off('value', handler));
  },

  /* ---- ホスト → ゲストへのイベント送信 ---- */
  async pushEvents(events) {
    if (!this.roomRef || !this.isHost) return;
    for (const ev of events) {
      await this.roomRef.child('battle/events').push(ev);
    }
  },

  async pushEvent(ev) {
    if (!this.roomRef || !this.isHost) return;
    await this.roomRef.child('battle/events').push(ev);
  },

  onEvent(cb) {
    if (!this.roomRef || this.isHost) return;
    const ref = this.roomRef.child('battle/events');
    const handler = (snap) => {
      const ev = snap.val();
      if (ev) cb(ev);
    };
    ref.on('child_added', handler);
    this._unsubs.push(() => ref.off('child_added', handler));
  },

  async clearEvents() {
    if (!this.roomRef) return;
    await this.roomRef.child('battle/events').remove();
    await this.roomRef.child('battle/hostAction').remove();
    await this.roomRef.child('battle/guestAction').remove();
  },

  async leave() {
    if (this.roomRef) {
      try {
        if (this.isHost) {
          await this.roomRef.remove();
        } else {
          await this.roomRef.child('meta/guestName').remove();
          await this.roomRef.child('meta/status').set('waiting');
          await this.roomRef.child('guestTeam').remove();
          await this.roomRef.child('battle').remove();
        }
      } catch (e) {}
    }
    this.reset();
  },
};

/* ---- シリアライズ ---- */
function serializePokeForNet(p) {
  return {
    sid: p.speciesId,
    lv: p.level,
    nat: p.nature,
    ab: p.ability,
    evs: p.evs,
    iv: p.iv,
    stats: p.stats,
    mhp: p.maxHp,
    hp: p.currentHp,
    mids: p.moves.map((m) => m.id),
    st: p.status || 0,
    rk: p.ranks,
    es: p.energyStacks || 0,
  };
}

function deserializePokeFromNet(d) {
  const species = GAME_DATA.species[d.sid];
  const moves = d.mids.map((id) => {
    if (!id) return null;
    const m = GAME_DATA.moves[id];
    if (!m) return null;
    return {
      id, name: m.name, type: m.type, power: m.power, accuracy: m.accuracy,
      category: m.category, pp: m.pp, maxPp: m.pp, priority: m.priority || 0,
      selfRank: m.selfRank, oppRank: m.oppRank, selfStatus: m.selfStatus,
      oppStatus: m.oppStatus, flinchChance: m.flinchChance || 0,
      drainRatio: m.drainRatio || null, recoilRatio: m.recoilRatio || null,
      selfDestruct: !!m.selfDestruct, chargeTurn: !!m.chargeTurn,
      damageFormula: m.damageFormula || null, callRandomMove: !!m.callRandomMove,
      locked: false,
    };
  }).filter(Boolean);
  return {
    speciesId: d.sid, species, level: d.lv, nature: d.nat, ability: d.ab,
    evs: d.evs, iv: d.iv, stats: d.stats, maxHp: d.mhp, currentHp: d.hp,
    moves,
    status: d.st || 0, badlyPoisonCounter: 0, confuseTurns: 0, sleepTurns: 0,
    ranks: d.rk || { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, acc: 0, eva: 0 },
    flinch: false, fainted: false,
    fundoTriggered: false, moraibiActive: false, lazyTurns: false,
    firstTurn: true, gyakujouTriggered: false, energyStacks: d.es || 0,
    tauntTurns: 0, bindTurns: 0,
    removedTypes: [], changedType: null,
    typeLockTurns: 0, typeLockType: null,
    lastUsedMoveId: null, encoreMoveId: null, encoreTurns: 0,
    utsusemiTurns: 0, infernoUsed: false,
  };
}

function serializeAction(a) {
  if (!a) return { type: 'none' };
  if (a.type === 'move') return { type: 'move', moveId: a.move.id };
  if (a.type === 'switch') return { type: 'switch', idx: a.idx };
  return { type: 'none' };
}