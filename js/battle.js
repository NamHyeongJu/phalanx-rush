'use strict';
// Side-view runner battle: the phalanx marches right, orc waves come from the right.

const Battle = (() => {
  const VW = 400;            // virtual width; height follows the canvas aspect
  const LANE_SP = 24;
  const RANK_SP = 42;
  const FRONT_X = 212;       // screen x of the front rank
  const CHAR_S = 0.155;      // virtual px per native sprite px
  const MARCH = 36;
  const CONTACT = 28;        // gap an orc keeps in front of the soldier it fights

  let cv, g, dpr = 1, k = 1, VH = 400;
  let laneY0 = 200, groundTop = 180;
  let nextId = 1;

  const B = {
    time: 0, px: 0, camX: 0, marching: false, charging: false, engaged: false, marchT: 0, dustT: 0,
    lanes: Array.from({ length: LANES }, () => []), dying: [],
    enemies: [], projs: [], fx: [], texts: [], coins: [],
    stage: 0, wave: 0, waveActive: false, pending: false, pendT: 0,
    state: 'run', stateT: 0, boss: null, banner: null, flash: null,
    shake: 0, cd: {}, castGap: 0, aspdT: 0, aspdV: 0, themeIdx: -1, themeFade: 0,
    goldAnchor: { x: 60, y: -20 }, dmgStat: [0, 0],
  };

  const rnd = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const laneY = (l) => laneY0 + l * LANE_SP;
  const depth = (y) => 0.84 + 0.16 * clamp((y - laneY0) / ((LANES - 1) * LANE_SP), 0, 1);
  const sfx = (n, v, r) => Engine.Sfx.play(n, v, r);
  const IMG = (p) => Engine.img(p);
  const FONT = FONT_STACK;

  // ---------- setup ----------
  function init(canvas) {
    cv = canvas;
    g = cv.getContext('2d');
    resize();
  }

  function resize() {
    const r = cv.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    cv.width = Math.max(1, Math.round(r.width * dpr));
    cv.height = Math.max(1, Math.round(r.height * dpr));
    k = r.width / VW;
    VH = r.height / k;
    laneY0 = VH - 26 - (LANES - 1) * LANE_SP;
    groundTop = laneY0 - 34;
    for (let l = 0; l < LANES; l++) for (const s of B.lanes[l]) s.y = laneY(l);
  }

  function toVirtual(cssX, cssY) { return { x: cssX / k, y: cssY / k }; }

  // ---------- soldiers ----------
  const rolePri = (s) => Math.min(s.C.role, 2);
  const soldierMaxHp = (s) => s.C.hp * GRADES[s.grade].mult * Game.mods.hp;
  const soldierAtk = (s) => s.C.atk * GRADES[s.grade].mult * Game.mods.atk;

  // Spearmen fill a file from the front; archers always stand in the last ranks.
  function sortLane(l) {
    const lane = B.lanes[l];
    lane.sort((a, b) => (rolePri(a) - rolePri(b)) || (b.grade - a.grade) || (a.id - b.id));
    const archers = lane.filter((s) => s.C.role >= 2).length;
    let front = 0, back = RANKS - archers;
    lane.forEach((s, i) => { s.idx = i; s.rank = s.C.role >= 2 ? back++ : front++; });
  }

  const slotX = (l, i) => -i * RANK_SP + ((l & 1) ? 5 : 0);
  const aliveCount = () => B.lanes.reduce((a, l) => a + l.length, 0);

  function addSoldier(cls, grade, opt = {}) {
    const C = CLASSES[cls];
    // Prefer the open file with the fewest soldiers of this kind (about one archer per file).
    let best = -1, bestScore = Infinity;
    const order = [...Array(LANES).keys()].sort(() => Math.random() - 0.5);
    for (const l of order) {
      const lane = B.lanes[l];
      if (lane.length >= RANKS) continue;
      const score = lane.filter((o) => (o.C.role >= 2) === (C.role >= 2)).length * 4 + lane.length;
      if (score < bestScore) { bestScore = score; best = l; }
    }
    if (opt.lane != null && B.lanes[opt.lane].length < RANKS) best = opt.lane;
    if (best < 0) return null;
    const sets = GRADE_SETS[grade];
    const set = opt.set && sets.includes(opt.set) ? opt.set : sets[Math.floor(Math.random() * sets.length)];
    const s = {
      id: nextId++, cls, C, grade, set, lane: best, idx: 0, rank: 0, ox: 0, y: laneY(best),
      look: Engine.look({ set, face: 0, weapon: C.weapons[grade], shield: !!C.shield }),
      hp: 1, maxHp: 1, cd: Math.random() * C.spd, anim: null, hitT: 0, dead: false, deathT: 0,
      spawnT: 0, shield: 0, shieldT: 0, phase: Math.random() * 6.28,
    };
    s.maxHp = soldierMaxHp(s);
    s.hp = s.maxHp * (opt.hp != null ? opt.hp : 1);
    B.lanes[best].push(s);
    sortLane(best);
    s.ox = slotX(best, s.rank);
    if (opt.drop) {
      s.spawnT = 0.5;
      B.fx.push({ kind: 'beam', x: B.px + s.ox, y: s.y, t: 0, dur: 0.85, color: GRADES[grade].color, grade });
    }
    return s;
  }

  // Three soldiers of one grade become one soldier of the next grade.
  function mergeGroups() {
    const groups = GRADES.map(() => []);
    for (const lane of B.lanes) for (const s of lane) if (s.grade < GRADES.length - 1) groups[s.grade].push(s);
    return groups;
  }

  function mergeCount() {
    return mergeGroups().reduce((a, grp) => a + Math.floor(grp.length / 3), 0);
  }

  // One step per press: soldiers made by this merge wait for the next press.
  function mergeAll() {
    const made = [];
    const groups = mergeGroups();
    for (let gIdx = 0; gIdx < GRADES.length - 1; gIdx++) {
      const grp = groups[gIdx].sort((a, b) => a.idx - b.idx);
      while (grp.length >= 3) {
        const trio = grp.splice(grp.length - 3, 3);
        const tally = {};
        for (const s of trio) tally[s.cls] = (tally[s.cls] || 0) + 1;
        const cls = Object.keys(tally).sort((a, b) => tally[b] - tally[a])[0];
        for (const s of trio) {
          const lane = B.lanes[s.lane];
          lane.splice(lane.indexOf(s), 1);
          B.fx.push({ kind: 'spark', x: B.px + s.ox, y: s.y - 20, t: 0, dur: 0.35, crit: true });
        }
        trio.forEach((s) => sortLane(s.lane));
        made.push(addSoldier(cls, gIdx + 1, { drop: true, lane: trio[0].lane }));
      }
    }
    return made;
  }

  function refreshSoldierStats() {
    for (const lane of B.lanes) for (const s of lane) {
      const r = s.hp / s.maxHp;
      s.maxHp = soldierMaxHp(s);
      s.hp = s.maxHp * r;
    }
  }

  function hurtSoldier(s, dmg) {
    if (s.dead || B.state === 'wipe') return;
    dmg *= 1 - Game.mods.armor;
    if (s.shield > 0) {
      const a = Math.min(s.shield, dmg);
      s.shield -= a; dmg -= a;
    }
    s.hp -= dmg;
    s.hitT = 0.15;
    if (s.hp <= 0) killSoldier(s);
  }

  function killSoldier(s) {
    s.dead = true; s.deathT = 0; s.hp = 0; s.anim = null;
    const lane = B.lanes[s.lane];
    const i = lane.indexOf(s);
    if (i >= 0) lane.splice(i, 1);
    sortLane(s.lane);
    s.wx = B.px + s.ox;
    B.dying.push(s);
    B.fx.push({ kind: 'poof', x: s.wx, y: s.y - 10, t: 0, dur: 0.55, s: 0.7 });
    sfx('CombatGrave1', 0.3, rnd(0.95, 1.15));
    Game.onSoldierDied(s);
    if (aliveCount() === 0) {
      B.state = 'wipe'; B.stateT = 2.8; B.boss = null;
      setBanner('부대 전멸!', '전열을 정비하고 다시 돌격합니다', '#ff6b5e', 2.6);
      sfx('UiDeny', 0.8);
    }
  }

  // ---------- enemies ----------
  function makeEnemy(type, x, lane) {
    const T = ENEMY_TYPES[type];
    const wpn = T.weapons[Math.floor(Math.random() * T.weapons.length)];
    const hp = F.enemyHp(B.stage) * T.hp;
    return {
      id: nextId++, type, T, look: Engine.look({ ...T.look, weapon: wpn }),
      x, y: laneY(lane), lane, hp, maxHp: hp, atk: F.enemyAtk(B.stage) * T.atk,
      cd: rnd(0.3, T.aspd), anim: null, hitT: 0, dead: false, deathT: 0, slowT: 0, stunT: 0,
      scale: T.scale || 1, phase: rnd(0, 6.28), rand: Math.random(), moving: true, kb: 0,
    };
  }

  function spawnWave() {
    const list = waveEnemies(B.stage, B.wave);
    const x0 = B.camX + VW + 40;
    const lanes = [...Array(LANES).keys()].sort(() => Math.random() - 0.5);
    let col = 0, li = 0;
    list.forEach((type) => {
      const T = ENEMY_TYPES[type];
      let lane = lanes[li % LANES];
      if (T.boss) lane = Math.floor(LANES / 2) - 1 + Math.floor(Math.random() * 2);
      const x = x0 + col * 34 + rnd(0, 14) + (T.range ? 40 : 0) + (T.boss ? 30 : 0);
      const e = makeEnemy(type, x, lane);
      B.enemies.push(e);
      if (T.boss) B.boss = e;
      li++;
      if (li % LANES === 0) col++;
    });
    B.waveActive = true;
    const label = F.stageLabel(B.stage);
    if (B.wave === WAVES_PER_STAGE - 1) {
      const T = ENEMY_TYPES[(B.stage % STAGES_PER_CHAPTER) === STAGES_PER_CHAPTER - 1 ? 'warlord' : 'boss'];
      setBanner('BOSS', T.name + ' 출현!', '#ff5a55', 1.8);
      sfx('UiOpen', 0.8, 0.8);
    } else if (B.wave === 0) {
      setBanner('STAGE ' + label, F.theme(B.stage).name, '#ffe9a8', 1.8);
    }
  }

  function hurtEnemy(e, dmg, opt = {}) {
    if (e.dead) return;
    B.dmgStat[opt.skill ? 1 : 0] += Math.min(dmg, e.hp);
    e.hp -= dmg;
    e.hitT = 0.12;
    addText(e.x + rnd(-6, 6), e.y - 46 * e.scale * depth(e.y), fmt(dmg), opt.crit ? 'crit' : opt.skill ? 'skill' : 'n');
    if (opt.kb && !e.T.boss) e.kb = Math.max(e.kb, opt.kb);
    if (opt.stun) e.stunT = Math.max(e.stunT, opt.stun * (e.T.boss ? 0.3 : 1));
    if (opt.slow) e.slowT = Math.max(e.slowT, opt.slow);
    if (e.hp <= 0) killEnemy(e);
  }

  function killEnemy(e) {
    e.dead = true; e.deathT = 0; e.anim = null;
    if (B.boss === e) B.boss = null;
    B.fx.push({ kind: 'poof', x: e.x, y: e.y - 12, t: 0, dur: 0.6, s: e.scale });
    const n = e.T.boss ? 8 : 1 + (Math.random() < 0.5 ? 1 : 0);
    const sx = e.x - B.camX, sy = e.y - 20;
    for (let i = 0; i < n; i++) B.coins.push({ x: sx, y: sy, vx: rnd(-50, 50), vy: rnd(-140, -70), t: 0 });
    if (e.T.boss) { B.shake = 7; sfx('CombatExplosion1', 0.6); }
    Game.onEnemyKilled(e);
  }

  // ---------- combat helpers ----------
  function rollDmg(base) {
    const M = Game.mods;
    const crit = Math.random() < M.crit;
    return { dmg: base * rnd(0.9, 1.1) * (crit ? M.critDmg : 1), crit };
  }

  function findTarget(s) {
    const C = s.C;
    const sx = B.px + s.ox;
    if (C.role === 0 && s.idx > 0) return null;
    // Long spears reach past the men in front, so every spearman in a file fights.
    const reach = C.reach + (C.role === 1 ? s.rank * RANK_SP : 0);
    let best = null, bd = Infinity;
    if (C.role <= 1) {
      for (const e of B.enemies) {
        if (e.dead) continue;
        const dy = Math.abs(e.y - s.y);
        if (dy > LANE_SP * 1.1) continue;
        const dx = e.x - sx;
        if (dx < -12 || dx > reach + 16 * e.scale) continue;
        const score = dx + dy * 2;
        if (score < bd) { bd = score; best = e; }
      }
      return best;
    }
    const cands = [];
    for (const e of B.enemies) {
      if (e.dead || e.x - B.camX > VW + 4) continue;
      if (e.x - sx <= C.range) cands.push(e);
    }
    if (!cands.length) return null;
    cands.sort((a, b) => a.x - b.x);
    return cands[Math.floor(Math.random() * Math.min(3, cands.length))];
  }

  function soldierStrike(s, e) {
    if (!e || e.dead) e = findTarget(s);
    if (!e) return;
    const C = s.C;
    const sx = B.px + s.ox;
    const d = depth(s.y);
    if (C.role >= 2) {
      const sp = C.proj === 'bullet' ? 700 : C.proj === 'orb' ? 280 : 400;
      const x0 = sx + 16 * d, y0 = s.y - 26 * d;
      const dist = Math.hypot(e.x - x0, e.y - y0);
      B.projs.push({ kind: C.proj, from: 's', x0, y0, x: x0, y: y0, tx: e.x, ty: e.y - 20, target: e, t: 0,
        dur: Math.max(0.08, dist / sp), arc: C.proj === 'arrow' ? 26 : 0, base: soldierAtk(s), splash: C.splash || 0, grade: s.grade });
      if (C.proj === 'bullet') {
        sfx(Math.random() < 0.5 ? 'CombatGun1' : 'CombatGun2', 0.18);
        B.fx.push({ kind: 'muzzle', x: x0 + 14 * d, y: y0 + 2, t: 0, dur: 0.1 });
      } else if (C.proj === 'arrow') sfx(s.grade >= 4 ? 'CombatCrossbow1' : (Math.random() < 0.5 ? 'CombatBow1' : 'CombatBow2'), 0.16);
      else sfx('CombatLaser1', 0.12, 1.4);
      return;
    }
    const { dmg, crit } = rollDmg(soldierAtk(s));
    hurtEnemy(e, dmg, { crit, kb: 7, stun: C.stun });
    if (C.splash) {
      for (const o of B.enemies) {
        if (o === e || o.dead) continue;
        if (Math.abs(o.x - e.x) < C.splash && Math.abs(o.y - e.y) < LANE_SP * 1.4) hurtEnemy(o, dmg * 0.5, { kb: 5 });
      }
    }
    B.fx.push({ kind: 'spark', x: e.x - 8, y: e.y - 24 * depth(e.y), t: 0, dur: 0.18, crit });
    sfx('CombatHit' + (1 + Math.floor(Math.random() * 4)), crit ? 0.35 : 0.22, rnd(0.9, 1.1));
  }

  // The front rank crashes into the orc line at the end of a charge.
  function chargeImpact() {
    let hit = false;
    for (const lane of B.lanes) {
      const s = lane[0];
      if (!s || s.C.role > 1) continue;
      const sx = B.px + s.ox;
      for (const e of B.enemies) {
        if (e.dead || Math.abs(e.y - s.y) > LANE_SP * 0.8 || e.x - sx > CONTACT * e.scale + 30) continue;
        hurtEnemy(e, soldierAtk(s) * 0.8, { kb: 16 });
        hit = true;
      }
    }
    if (!hit) return;
    B.shake = Math.max(B.shake, 4);
    addText(B.px - 20, laneY0 - 22, '돌격!', 'skillName', '#ffe08a');
    for (let l = 0; l < LANES; l += 2) B.fx.push({ kind: 'spark', x: B.px + 22, y: laneY(l) - 20, t: 0, dur: 0.22, crit: true });
    sfx('CombatHit4', 0.5, 0.75);
    sfx('CombatSwing3', 0.4, 0.8);
  }

  function enemyStrike(e) {
    const T = e.T;
    if (T.proj) {
      const pool = [];
      for (const lane of B.lanes) for (const s of lane) pool.push(s);
      if (!pool.length) return;
      // Volleys fall anywhere in the formation, so the back ranks bleed too.
      const s = pool[Math.floor(Math.random() * pool.length)];
      const x0 = e.x - 14, y0 = e.y - 26 * e.scale;
      const tx = B.px + s.ox, ty = s.y - 20;
      const sp = T.proj === 'orb' ? 240 : 360;
      B.projs.push({ kind: T.proj === 'orb' ? 'eorb' : 'earrow', from: 'e', x0, y0, x: x0, y: y0, tx, ty, target: s, t: 0,
        dur: Math.max(0.1, Math.hypot(tx - x0, ty - y0) / sp), arc: T.proj === 'arrow' ? 22 : 0, base: e.atk, splash: T.splash || 0 });
      if (T.proj === 'arrow') sfx('CombatBow2', 0.1, 0.85);
      return;
    }
    const lane = B.lanes[e.lane];
    const s = lane[0];
    if (!s) return;
    if (e.x - (B.px + s.ox) > CONTACT * e.scale + T.reach) return;
    hurtSoldier(s, e.atk * rnd(0.9, 1.1));
    B.fx.push({ kind: 'spark', x: B.px + s.ox + 10, y: s.y - 22, t: 0, dur: 0.15, enemy: true });
    if (T.cleave) {
      for (const dl of [-1, 1]) {
        const o = B.lanes[e.lane + dl] && B.lanes[e.lane + dl][0];
        if (o) hurtSoldier(o, e.atk * 0.6);
      }
      B.shake = Math.max(B.shake, 3);
      sfx('CombatHit4', 0.4, 0.7);
    } else sfx('CombatSwing' + (1 + Math.floor(Math.random() * 3)), 0.14, 0.85);
  }

  // ---------- update ----------
  function update(dt) {
    B.time += dt;
    if (B.shake > 0) B.shake = Math.max(0, B.shake - dt * 25);
    if (B.aspdT > 0) B.aspdT -= dt;
    const theme = Math.floor(B.stage / STAGES_PER_CHAPTER) % THEMES.length;
    if (theme !== B.themeIdx) { if (B.themeIdx >= 0) B.themeFade = 1; B.themeIdx = theme; }
    if (B.themeFade > 0) B.themeFade = Math.max(0, B.themeFade - dt * 1.2);

    let nearest = Infinity;
    for (const e of B.enemies) if (!e.dead) nearest = Math.min(nearest, e.x - B.px);
    B.engaged = nearest < 120;
    const wasMarching = B.marching;
    B.marching = B.state === 'run' && aliveCount() > 0 && nearest > CONTACT + 18;
    // Close the last stretch at a run, then slam into the orc line.
    B.charging = B.marching && nearest < 170;
    if (B.marching) {
      B.px += MARCH * Game.mods.march * (B.charging ? 2 : 1) * dt;
      B.marchT += dt;
      B.dustT -= dt;
      if (B.dustT <= 0) {
        B.dustT = B.charging ? 0.05 : 0.13;
        const l = Math.floor(Math.random() * LANES);
        const back = slotX(l, RANKS - 1);
        B.fx.push({ kind: 'dust', x: B.px + back - 10 + rnd(-6, 6), y: laneY(l) - 2, t: 0, dur: 0.45 });
      }
    } else {
      if (wasMarching && B.marchT > 0.6 && nearest < CONTACT + 40) chargeImpact();
      B.marchT = 0;
    }
    B.camX = B.px - FRONT_X;

    updateSoldiers(dt);
    updateEnemies(dt);
    updateProjs(dt);
    updateFx(dt);
    updateSkills(dt);
    updateWaves(dt);
    updateTexts(dt);
    updateCoins(dt);
    if (B.banner) { B.banner.t += dt; if (B.banner.t > B.banner.dur) B.banner = null; }
    if (B.flash) { B.flash.t += dt; if (B.flash.t > B.flash.dur) B.flash = null; }
  }

  function updateSoldiers(dt) {
    const aspd = Game.mods.aspd * (B.aspdT > 0 ? 1 + B.aspdV : 1);
    const fighting = B.state === 'run';
    for (let l = 0; l < LANES; l++) {
      const lane = B.lanes[l];
      for (let i = 0; i < lane.length; i++) {
        const s = lane[i];
        s.ox += (slotX(l, s.rank) - s.ox) * Math.min(1, dt * 5);
        s.y = laneY(l);
        if (s.spawnT > 0) s.spawnT -= dt;
        if (s.hitT > 0) s.hitT -= dt;
        if (s.shieldT > 0) { s.shieldT -= dt; if (s.shieldT <= 0) s.shield = 0; }
        if (B.marching && s.hp < s.maxHp) s.hp = Math.min(s.maxHp, s.hp + s.maxHp * 0.01 * dt);
        s.cd -= dt * aspd;
        if (s.anim) {
          s.anim.t += dt;
          if (!s.anim.hit && s.anim.t >= s.anim.dur * s.anim.at) { s.anim.hit = true; if (fighting) soldierStrike(s, s.anim.target); }
          if (s.anim.t >= s.anim.dur) s.anim = null;
        } else if (s.cd <= 0 && s.spawnT <= 0 && fighting) {
          const tgt = findTarget(s);
          if (tgt) {
            const dur = Math.min(0.45, (s.C.spd / aspd) * 0.85);
            const at = s.C.anim === 'thrust' ? 0.45 : s.C.role >= 2 ? 0.35 : 0.55;
            s.anim = { kind: s.C.anim, t: 0, dur, at, target: tgt, hit: false };
            s.cd = s.C.spd;
            if (s.C.role < 2 && Math.random() < 0.35) sfx('CombatSwing' + (1 + Math.floor(Math.random() * 3)), 0.12);
          } else s.cd = 0.1;
        }
      }
    }
    for (const s of B.dying) s.deathT += dt;
    B.dying = B.dying.filter((s) => s.deathT < 0.9);
  }

  function updateEnemies(dt) {
    const fighting = B.state === 'run';
    for (const e of B.enemies) {
      if (e.dead) { e.deathT += dt; continue; }
      const T = e.T;
      if (e.hitT > 0) e.hitT -= dt;
      if (e.slowT > 0) e.slowT -= dt;
      if (e.kb > 0) { e.x += e.kb * 9 * dt; e.kb = Math.max(0, e.kb - dt * 60); }
      e.moving = false;
      if (e.stunT > 0) { e.stunT -= dt; e.anim = null; continue; }
      if (e.anim) {
        e.anim.t += dt;
        if (!e.anim.hit && e.anim.t >= e.anim.dur * 0.55) { e.anim.hit = true; if (fighting) enemyStrike(e); }
        if (e.anim.t >= e.anim.dur) e.anim = null;
      }
      if (!fighting) continue;
      const spd = T.spd * (e.slowT > 0 ? 0.5 : 1);
      e.cd -= dt;
      if (T.range) {
        const want = B.px + T.range * (0.7 + 0.3 * e.rand);
        if (e.x > want) { e.x -= spd * dt; e.moving = true; }
        else if (e.cd <= 0 && !e.anim && aliveCount()) {
          e.anim = { kind: T.proj === 'orb' ? 'cast' : 'shoot', t: 0, dur: 0.5, hit: false };
          e.cd = T.aspd;
        }
        continue;
      }
      // Melee orcs keep to a lane and queue behind each other.
      if (!B.lanes[e.lane].length) {
        let bl = -1, bd = 99;
        for (let l = 0; l < LANES; l++) if (B.lanes[l].length && Math.abs(l - e.lane) < bd) { bd = Math.abs(l - e.lane); bl = l; }
        if (bl >= 0) e.lane = bl;
      }
      const ty = laneY(e.lane);
      if (Math.abs(e.y - ty) > 0.5) { e.y += Math.sign(ty - e.y) * Math.min(Math.abs(ty - e.y), 45 * dt); e.moving = true; }
      const blocker = B.lanes[e.lane][0];
      const stopX = blocker ? B.px + blocker.ox + CONTACT * e.scale : -Infinity;
      let ahead = -Infinity;
      for (const o of B.enemies) {
        if (o === e || o.dead || o.lane !== e.lane || o.T.range || o.x >= e.x) continue;
        if (o.x > ahead) ahead = o.x;
      }
      const minX = Math.max(stopX, ahead + 21 * Math.max(e.scale, 1));
      if (e.x > minX + 0.5) { e.x = Math.max(minX, e.x - spd * dt); e.moving = true; }
      // An orc that slipped past while switching lanes steps back out to the front.
      else if (blocker && e.x < stopX - 1) { e.x = Math.min(stopX, e.x + spd * dt); e.moving = true; }
      if (blocker && e.x - stopX < 6 && e.cd <= 0 && !e.anim) {
        e.anim = { kind: 'chop', t: 0, dur: T.boss ? 0.7 : 0.45, hit: false };
        e.cd = T.aspd;
      }
    }
    B.enemies = B.enemies.filter((e) => !e.dead || e.deathT < 0.8);
  }

  function updateProjs(dt) {
    for (const p of B.projs) {
      p.t += dt;
      if (p.target && !p.target.dead && !p.fixed) {
        if (p.from === 'e') { p.tx = B.px + p.target.ox; p.ty = p.target.y - 20; }
        else { p.tx = p.target.x; p.ty = p.target.y - (p.from === 's' ? 20 : 14) * p.target.scale; }
      }
      const q = Math.min(1, p.t / p.dur);
      const nx = lerp(p.x0, p.tx, q);
      const ny = lerp(p.y0, p.ty, q) - Math.sin(q * Math.PI) * p.arc;
      p.ang = Math.atan2(ny - p.y, nx - p.x);
      p.x = nx; p.y = ny;
      if (q >= 1) { p.done = true; projHit(p); }
    }
    B.projs = B.projs.filter((p) => !p.done);
  }

  function projHit(p) {
    if (p.onHit) { p.onHit(p); return; }
    if (p.from === 's') {
      let e = p.target && !p.target.dead ? p.target : null;
      if (!e) {
        for (const o of B.enemies) if (!o.dead && Math.abs(o.x - p.tx) < 16 && Math.abs(o.y - 20 - p.ty) < 18) { e = o; break; }
      }
      if (p.splash) {
        B.fx.push({ kind: 'burst', x: p.tx, y: p.ty, t: 0, dur: 0.3, color: '#b98bff' });
        const { dmg, crit } = rollDmg(p.base);
        for (const o of B.enemies) {
          if (o.dead) continue;
          if (Math.abs(o.x - p.tx) < p.splash && Math.abs(o.y - 20 - p.ty) < p.splash * 0.8) hurtEnemy(o, o === e ? dmg : dmg * 0.6, { crit: crit && o === e });
        }
        return;
      }
      if (!e) return;
      const { dmg, crit } = rollDmg(p.base);
      hurtEnemy(e, dmg, { crit, kb: p.kind === 'bullet' ? 4 : 2 });
      if (p.kind === 'bullet') B.fx.push({ kind: 'spark', x: p.tx, y: p.ty, t: 0, dur: 0.12, crit });
      return;
    }
    // enemy projectiles
    if (p.splash) {
      B.fx.push({ kind: 'burst', x: p.tx, y: p.ty, t: 0, dur: 0.3, color: '#7cff6a' });
      for (const lane of B.lanes) for (const s of [...lane]) {
        if (Math.abs(B.px + s.ox - p.tx) < p.splash && Math.abs(s.y - 20 - p.ty) < p.splash) hurtSoldier(s, p.base * (s === p.target ? 1 : 0.5));
      }
      return;
    }
    if (p.target && !p.target.dead) hurtSoldier(p.target, p.base * rnd(0.9, 1.1));
  }

  function updateWaves(dt) {
    if (B.state === 'wipe') {
      B.stateT -= dt;
      if (B.stateT <= 0) {
        for (const e of B.enemies) if (!e.dead) B.fx.push({ kind: 'poof', x: e.x, y: e.y - 12, t: 0, dur: 0.6, s: e.scale });
        B.enemies = []; B.projs = []; B.boss = null;
        B.wave = 0; B.waveActive = false; B.pending = true; B.pendT = 1.6;
        B.state = 'run';
        Game.onWipe();
      }
      return;
    }
    if (B.enemies.some((e) => !e.dead)) return;
    if (B.pending) {
      B.pendT -= dt;
      if (B.pendT <= 0) { B.pending = false; spawnWave(); }
      return;
    }
    if (B.waveActive) {
      B.waveActive = false;
      if (B.wave >= WAVES_PER_STAGE - 1) {
        const gems = Game.onStageCleared(B.stage);
        if (!Game.S.farm) B.stage++;
        B.wave = 0;
        setBanner('STAGE CLEAR!', (Game.S.farm ? '반복 사냥 · ' : '') + '+' + gems + ' 보석', '#7dff8a', 1.6);
        sfx('UiReward', 0.7);
        B.pending = true; B.pendT = 2.0;
      } else { B.wave++; B.pending = true; B.pendT = 0.5; }
    } else { B.pending = true; B.pendT = 0.8; }
  }

  // ---------- skills ----------
  // Skills grow with the army: a better-graded phalanx casts stronger spells.
  function heroAtk() {
    let n = 0, m = 0;
    for (const lane of B.lanes) for (const s of lane) { m += GRADES[s.grade].mult; n++; }
    return 10 * Game.mods.atk * Game.mods.skill * (n ? m / n : 1);
  }

  function onScreenEnemies() {
    return B.enemies.filter((e) => !e.dead && e.x - B.camX < VW - 4 && e.x - B.camX > FRONT_X - 30);
  }

  function clusterTarget(r = 50) {
    const vis = onScreenEnemies();
    let best = null, bn = -1;
    for (const a of vis) {
      let n = a.T.boss ? 2 : 0;
      for (const b of vis) if (Math.abs(b.x - a.x) < r && Math.abs(b.y - a.y) < r * 0.8) n++;
      if (n > bn) { bn = n; best = a; }
    }
    return best ? { x: best.x, y: best.y - 14, e: best } : null;
  }

  function aoe(x, y, r, dmg, opt = {}) {
    let hit = 0;
    for (const e of B.enemies) {
      if (e.dead) continue;
      const dx = e.x - x, dy = (e.y - 14 - y) * 1.3;
      if (dx * dx + dy * dy <= r * r) { hurtEnemy(e, dmg * rnd(0.92, 1.08), { skill: true, ...opt }); hit++; }
    }
    return hit;
  }

  function armyCenter() {
    let n = 0, x = 0;
    for (const lane of B.lanes) for (const s of lane) { x += B.px + s.ox; n++; }
    return { x: n ? x / n : B.px - 60, y: laneY0 + 3.5 * LANE_SP };
  }

  function skillProj(icon, from, to, dur, rot, onHit, arc = 0, size = 30) {
    B.projs.push({ kind: 'skill', icon, from: 'x', x0: from.x, y0: from.y, x: from.x, y: from.y, tx: to.x, ty: to.y,
      target: to.e || null, fixed: !to.e, t: 0, dur, arc, rot, size, onHit, ang: 0 });
  }

  const SKILL_FN = {
    'fireball'(v) {
      const t = clusterTarget();
      if (!t) return false;
      const c = armyCenter();
      skillProj('assets/skills/fireball.png', { x: c.x, y: laneY0 - 70 }, t, 0.5, Math.PI * 0.75, (p) => {
        aoe(p.tx, p.ty, 58, heroAtk() * v / 100);
        boom(p.tx, p.ty, 1.3); B.shake = Math.max(B.shake, 4);
        sfx('CombatExplosion1', 0.5);
      }, 40, 34);
      sfx('CombatFlame1', 0.35);
      return true;
    },
    'arrow-rain'(v) {
      const t = clusterTarget(70);
      if (!t) return false;
      for (let i = 0; i < 16; i++) {
        const tx = t.x + rnd(-55, 55), ty = laneY(Math.floor(rnd(0, LANES))) - 14;
        const from = { x: tx - 90, y: -20 };
        setTimeoutFx(i * 0.05, () => {
          skillProj('assets/vfx/arrow.png', from, { x: tx, y: ty }, 0.45, 0, (p) => {
            aoe(p.tx, p.ty, 20, heroAtk() * v / 100);
            B.fx.push({ kind: 'dust', x: p.tx, y: p.ty + 10, t: 0, dur: 0.3 });
          }, 0, 26);
          if (i % 4 === 0) sfx('CombatBow1', 0.2);
        });
      }
      return true;
    },
    'ice-lance'(v) {
      const vis = onScreenEnemies();
      if (!vis.length) return false;
      const counts = new Array(LANES).fill(0);
      for (const e of vis) counts[e.lane]++;
      const lane = counts.indexOf(Math.max(...counts));
      const y = laneY(lane) - 18;
      const hitSet = new Set();
      B.fx.push({ kind: 'lance', x: B.px + 10, y, t: 0, dur: 1.1, speed: 420, update(f) {
        for (const e of B.enemies) {
          if (e.dead || hitSet.has(e)) continue;
          if (Math.abs(e.y - 18 - y) < 26 && f.x >= e.x - 10) {
            hitSet.add(e);
            hurtEnemy(e, heroAtk() * v / 100, { skill: true, slow: 3 });
            B.fx.push({ kind: 'frost', x: e.x, y: e.y - 18, t: 0, dur: 0.4 });
          }
        }
      } });
      sfx('CombatLaser1', 0.4, 0.7);
      return true;
    },
    'lightning'(v) {
      const vis = onScreenEnemies();
      if (!vis.length) return false;
      const targets = vis.sort(() => Math.random() - 0.5).slice(0, 5);
      const cx = targets.reduce((a, e) => a + e.x, 0) / targets.length;
      B.fx.push({ kind: 'cloud', x: cx, y: Math.max(16, groundTop - 90), t: 0, dur: 1.3 });
      targets.forEach((e, i) => setTimeoutFx(0.15 + i * 0.12, () => {
        if (e.dead) return;
        B.fx.push({ kind: 'bolt', x: e.x, y: e.y - 16, top: Math.max(16, groundTop - 80), t: 0, dur: 0.28, seed: Math.random() * 1000 });
        hurtEnemy(e, heroAtk() * v / 100, { skill: true, stun: 0.8 });
        sfx('CombatLaser1', 0.3, 1.3);
      }));
      return true;
    },
    'poison-bomb'(v) {
      const t = clusterTarget(60);
      if (!t) return false;
      const c = armyCenter();
      skillProj('assets/skills/poison-bomb.png', { x: c.x, y: laneY0 - 40 }, { x: t.x, y: t.y }, 0.6, 0, (p) => {
        sfx('CombatExplosion1', 0.3, 1.4);
        B.fx.push({ kind: 'field', field: 'poison', x: p.tx, y: p.ty + 14, r: 62, t: 0, dur: 5, tick: 0, update(f, dt) {
          f.tick -= dt;
          if (f.tick <= 0) { f.tick = 0.5; aoe(f.x, f.y - 14, f.r, heroAtk() * v / 100); }
        } });
      }, 70, 30);
      return true;
    },
    'beast-claw'(v) {
      if (!B.engaged) return false;
      B.aspdT = 7; B.aspdV = v / 100;
      const c = armyCenter();
      B.fx.push({ kind: 'icon', icon: 'assets/skills/beast-claw.png', x: c.x, y: laneY0 - 40, t: 0, dur: 1.0, size: 54 });
      B.flash = { color: 'rgba(255,60,40,', t: 0, dur: 0.35 };
      sfx('UiLevelUp', 0.45, 1.2);
      return true;
    },
    'crystal'(v) {
      if (!B.engaged) return false;
      for (const lane of B.lanes) for (const s of lane) { s.shield = s.maxHp * v / 100; s.shieldT = 8; }
      const c = armyCenter();
      B.fx.push({ kind: 'icon', icon: 'assets/skills/crystal.png', x: c.x, y: laneY0 - 40, t: 0, dur: 1.0, size: 54 });
      sfx('UiReveal', 0.4, 1.3);
      return true;
    },
    'hellfire'(v) {
      const t = clusterTarget(70);
      if (!t) return false;
      B.fx.push({ kind: 'field', field: 'hell', x: t.x, y: t.y + 14, r: 72, t: 0, dur: 5, tick: 0, update(f, dt) {
        f.tick -= dt;
        if (f.tick <= 0) { f.tick = 0.5; aoe(f.x, f.y - 14, f.r, heroAtk() * v / 100); }
      } });
      sfx('CombatFlame1', 0.5, 0.8);
      return true;
    },
    'fire-wave'(v) {
      if (!onScreenEnemies().length) return false;
      const hitSet = new Set();
      B.fx.push({ kind: 'wave', x: B.px + 6, y: laneY0 + 3.5 * LANE_SP, t: 0, dur: 1.6, speed: 260, update(f) {
        for (const e of B.enemies) {
          if (e.dead || hitSet.has(e) || f.x < e.x - 8) continue;
          hitSet.add(e);
          hurtEnemy(e, heroAtk() * v / 100, { skill: true, kb: 30 });
        }
      } });
      sfx('CombatFlame1', 0.6, 0.9);
      return true;
    },
    'sun-blessing'(v) {
      let need = false;
      for (const lane of B.lanes) for (const s of lane) if (s.hp < s.maxHp * 0.75) need = true;
      if (!need) return false;
      const c = armyCenter();
      B.fx.push({ kind: 'sun', x: c.x, y: laneY0 - 50, t: 0, dur: 1.4 });
      for (const lane of B.lanes) for (const s of lane) {
        const h = s.maxHp * v / 100;
        s.hp = Math.min(s.maxHp, s.hp + h);
        B.fx.push({ kind: 'heal', x: B.px + s.ox, y: s.y - 20, t: -Math.random() * 0.4, dur: 0.9 });
      }
      sfx('UiReward', 0.45, 1.2);
      return true;
    },
    'star-nova'(v) {
      const vis = onScreenEnemies();
      if (!vis.length) return false;
      const cx = vis.reduce((a, e) => a + e.x, 0) / vis.length;
      B.fx.push({ kind: 'nova', x: cx, y: laneY0 + 2 * LANE_SP, t: 0, dur: 0.9 });
      setTimeoutFx(0.35, () => {
        for (const e of onScreenEnemies()) hurtEnemy(e, heroAtk() * v / 100 * rnd(0.92, 1.08), { skill: true });
        B.flash = { color: 'rgba(255,255,230,', t: 0, dur: 0.4 };
        B.shake = Math.max(B.shake, 6);
      });
      sfx('UiReveal', 0.5, 0.8);
      return true;
    },
    'meteor'(v) {
      const t = clusterTarget(80);
      if (!t) return false;
      skillProj('assets/skills/meteor.png', { x: t.x + 160, y: -60 }, { x: t.x, y: t.y }, 0.75, Math.PI, (p) => {
        aoe(p.tx, p.ty, 95, heroAtk() * v / 100, { stun: 1.2, kb: 14 });
        B.fx.push({ kind: 'crater', x: p.tx, y: p.ty + 18, t: 0, dur: 3.5 });
        B.fx.push({ kind: 'ring', x: p.tx, y: p.ty + 14, t: 0, dur: 0.8 });
        boom(p.tx, p.ty, 2.4);
        B.flash = { color: 'rgba(255,200,120,', t: 0, dur: 0.45 };
        B.shake = Math.max(B.shake, 11);
        sfx('CombatExplosion1', 0.9, 0.7);
      }, 0, 70);
      sfx('CombatFlame1', 0.5, 0.6);
      return true;
    },
  };

  function boom(x, y, s) {
    B.fx.push({ kind: 'boom', x, y, t: 0, dur: 0.5, s });
    B.fx.push({ kind: 'smoke', x, y: y + 6, t: 0, dur: 0.9, s });
  }

  function setTimeoutFx(delay, fn) { B.fx.push({ kind: 'timer', t: -delay, dur: 0, fn }); }

  function castSkill(id) {
    const sk = SKILL_BY_ID[id];
    if (!sk || (B.cd[id] || 0) > 0 || B.state !== 'run') return false;
    const lv = (Game.S.skills[id] && Game.S.skills[id].lv) || 1;
    if (!SKILL_FN[id](F.skillValue(sk, lv))) return false;
    B.cd[id] = sk.cd;
    const c = armyCenter();
    addText(c.x, laneY0 - 26, sk.name + '!', 'skillName', GRADES[sk.grade].color);
    return true;
  }

  function updateSkills(dt) {
    for (const id in B.cd) if (B.cd[id] > 0) B.cd[id] -= dt;
    B.castGap -= dt;
    if (!Game.S.auto || B.state !== 'run' || B.castGap > 0 || !aliveCount()) return;
    for (const id of Game.S.equip) {
      if (id && (B.cd[id] || 0) <= 0 && castSkill(id)) { B.castGap = 0.4; break; }
    }
  }

  // ---------- fx / text / coins ----------
  function updateFx(dt) {
    for (const f of B.fx) {
      f.t += dt;
      if (f.kind === 'timer') { if (f.t >= 0) { f.fired = true; f.fn(); } continue; }
      if (f.t < 0) continue;
      if (f.speed) f.x += f.speed * dt;
      if (f.update) f.update(f, dt);
    }
    B.fx = B.fx.filter((f) => (f.kind === 'timer' ? !f.fired : f.t < f.dur));
  }

  function addText(x, y, text, kind, color) {
    if (B.texts.length > 70) B.texts.shift();
    B.texts.push({ x, y, text, kind, color, t: 0, dur: kind === 'skillName' ? 1.1 : 0.75 });
  }
  function updateTexts(dt) {
    for (const t of B.texts) t.t += dt;
    B.texts = B.texts.filter((t) => t.t < t.dur);
  }

  function updateCoins(dt) {
    const a = B.goldAnchor;
    for (const c of B.coins) {
      c.t += dt;
      if (c.t < 0.45) { c.vy += 420 * dt; c.x += c.vx * dt; c.y += c.vy * dt; }
      else {
        const dx = a.x - c.x, dy = a.y - c.y, d = Math.hypot(dx, dy) || 1;
        const sp = 300 + (c.t - 0.45) * 1600;
        c.x += dx / d * sp * dt; c.y += dy / d * sp * dt;
        if (d < 14) c.done = true;
      }
    }
    if (B.coins.some((c) => c.done)) Game.coinArrived && Game.coinArrived();
    B.coins = B.coins.filter((c) => !c.done && c.t < 3);
  }

  function setBanner(text, sub, color, dur) { B.banner = { text, sub, color, t: 0, dur }; }

  // ---------- drawing ----------
  function hash(n) {
    n = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
    n ^= n >>> 13; n = Math.imul(n, 0xc2b2ae35); n ^= n >>> 16;
    return (n >>> 0) / 4294967296;
  }

  function drawBackground() {
    const th = THEMES[Math.max(0, B.themeIdx)];
    const im = IMG(th.bg);
    g.fillStyle = '#8fd0ff';
    g.fillRect(0, 0, VW, groundTop + 10);
    if (im) {
      const sy = th.crop[0] * im.naturalHeight, sh = (th.crop[1] - th.crop[0]) * im.naturalHeight;
      const dh = (groundTop + 8) / th.horizon;
      const dw = im.naturalWidth / sh * dh;
      const off = ((B.camX * 0.25) % (dw * 2) + dw * 2) % (dw * 2);
      for (let x = -off, i = 0; x < VW; x += dw, i++) {
        if (x + dw < 0) continue;
        g.save();
        if (i % 2) { g.translate(x + dw, 0); g.scale(-1, 1); g.drawImage(im, 0, sy, im.naturalWidth, sh, 0, 0, dw, dh); }
        else g.drawImage(im, 0, sy, im.naturalWidth, sh, x, 0, dw, dh);
        g.restore();
      }
    }
    // ground band
    const gr = g.createLinearGradient(0, groundTop - 10, 0, VH);
    gr.addColorStop(0, th.ground[0] + '00');
    gr.addColorStop(0.08, th.ground[0]);
    gr.addColorStop(1, th.ground[1]);
    g.fillStyle = gr;
    g.fillRect(0, groundTop - 10, VW, VH - groundTop + 10);
    // scrolling ground details
    const TILE = 46;
    const t0 = Math.floor(B.camX / TILE) - 1, t1 = Math.floor((B.camX + VW) / TILE) + 1;
    for (let i = t0; i <= t1; i++) {
      const bx = i * TILE - B.camX;
      const h1 = hash(i * 3 + 1), h2 = hash(i * 3 + 2), h3 = hash(i * 3 + 3);
      const band = VH - groundTop;
      if (h1 < 0.55) {
        g.fillStyle = th.spot;
        g.globalAlpha = 0.45;
        g.beginPath();
        g.ellipse(bx + h2 * TILE, groundTop + 8 + h3 * (band - 12), 10 + h1 * 22, 3 + h1 * 5, 0, 0, Math.PI * 2);
        g.fill();
        g.globalAlpha = 1;
      }
      if (h2 < 0.6) {
        const x = bx + h3 * TILE, y = groundTop + 6 + hash(i * 7 + 5) * (band - 6);
        g.fillStyle = th.tuft;
        g.beginPath();
        g.moveTo(x - 5, y); g.lineTo(x - 3, y - 6); g.lineTo(x - 1, y - 1); g.lineTo(x + 1, y - 8);
        g.lineTo(x + 3, y - 1); g.lineTo(x + 5, y - 5); g.lineTo(x + 6, y);
        g.closePath(); g.fill();
      }
      if (h3 < 0.35) {
        const x = bx + h1 * TILE, y = groundTop + 10 + hash(i * 11 + 9) * (band - 14);
        g.fillStyle = 'rgba(90,70,50,0.35)';
        g.beginPath(); g.ellipse(x, y + 1, 4, 2, 0, 0, Math.PI * 2); g.fill();
        g.fillStyle = 'rgba(235,225,205,0.9)';
        g.beginPath(); g.ellipse(x, y, 3.5, 2.2, 0, 0, Math.PI * 2); g.fill();
      }
    }
  }

  function poseSoldier(s) {
    const C = s.C;
    const p = { wpn: C.idle || 0, arm: 0, bob: 0, tilt: 0, lunge: 0, thrust: 0 };
    const t = B.time;
    if (C.role === 2) { p.arm = -1.15; p.wpn = 1.15; }
    else if (C.role === 3) { p.arm = -0.55; p.wpn = -0.75; }
    if (B.marching && !s.anim) {
      const ph = t * (B.charging ? 16 : 10) + s.phase * 0.25;
      p.bob = Math.abs(Math.sin(ph)) * (B.charging ? 9 : 7);
      p.tilt = Math.sin(ph) * 0.05 + (B.charging ? 0.12 : 0);
      if (B.charging && C.role <= 1) { p.arm = -0.5; p.wpn = (C.idle || 0) + 0.25; }
    } else p.bob = Math.sin(t * 3 + s.phase) * 1.2;
    if (s.anim) animPose(p, s.anim, C.idle || 0);
    if (s.hitT > 0) p.tilt -= 0.14 * (s.hitT / 0.15);
    return p;
  }

  function animPose(p, a, idle) {
    const q = Math.min(1, a.t / a.dur);
    const ease = (x) => 1 - (1 - x) * (1 - x);
    if (a.kind === 'slash' || a.kind === 'chop') {
      if (q < 0.45) { const u = ease(q / 0.45); p.arm = lerp(0, -2.4, u); p.wpn = lerp(idle, -0.3, u); }
      else if (q < 0.65) { const u = (q - 0.45) / 0.2; p.arm = lerp(-2.4, -0.4, u); p.wpn = lerp(-0.3, 0.5, u); p.lunge = 12 * u; }
      else { const u = ease((q - 0.65) / 0.35); p.arm = lerp(-0.4, 0, u); p.wpn = lerp(0.5, idle, u); p.lunge = 12 * (1 - u); }
    } else if (a.kind === 'thrust') {
      const u = Math.sin(q * Math.PI);
      p.thrust = (q < 0.45 ? -8 * Math.sin(q / 0.45 * Math.PI) : 0) + u * 36;
      p.lunge = u * 8;
    } else if (a.kind === 'shoot') {
      p.thrust = -Math.sin(q * Math.PI) * 9;
      p.tilt -= Math.sin(q * Math.PI) * 0.04;
    } else if (a.kind === 'cast') {
      p.arm += -Math.sin(q * Math.PI) * 0.9;
      p.lunge = Math.sin(q * Math.PI) * 5;
    }
  }

  function poseEnemy(e) {
    const p = { wpn: -0.4, arm: 0, bob: 0, tilt: 0, lunge: 0, thrust: 0 };
    if (e.T.proj === 'arrow') { p.arm = -1.15; p.wpn = 1.15; }
    else if (e.T.proj === 'orb') { p.arm = -0.55; p.wpn = -0.75; }
    if (e.moving && !e.anim) {
      const ph = B.time * 9 + e.phase;
      p.bob = Math.abs(Math.sin(ph)) * 6;
      p.tilt = Math.sin(ph) * 0.06;
    } else p.bob = Math.sin(B.time * 3 + e.phase) * 1.2;
    if (e.anim) animPose(p, e.anim, -0.4);
    if (e.stunT > 0) p.tilt = Math.sin(B.time * 20) * 0.08;
    if (e.hitT > 0) p.tilt -= 0.12;
    return p;
  }

  const drawList = [];
  function drawUnits() {
    drawList.length = 0;
    for (const lane of B.lanes) for (const s of lane) drawList.push({ y: s.y, x: B.px + s.ox, s });
    for (const s of B.dying) drawList.push({ y: s.y, x: s.wx, s, dying: true });
    for (const e of B.enemies) drawList.push({ y: e.y, x: e.x, e });
    drawList.sort((a, b) => a.y - b.y || a.x - b.x);

    // shadows + grade auras first
    for (const it of drawList) {
      const u = it.s || it.e;
      const d = depth(u.y);
      const x = it.s ? (it.dying ? u.wx : B.px + u.ox) - B.camX : u.x - B.camX;
      const sc = (u.scale || 1) * d;
      g.globalAlpha = it.dying ? Math.max(0, 1 - u.deathT / 0.9) : u.dead ? Math.max(0, 1 - u.deathT / 0.8) : 1;
      if (it.s && !it.dying && u.grade >= 1) {
        const col = GRADES[u.grade].color;
        const pulse = u.grade >= 4 ? 0.15 * Math.sin(B.time * 4 + u.phase) : 0;
        g.fillStyle = col;
        g.globalAlpha = 0.35 + pulse;
        g.beginPath(); g.ellipse(x, u.y, 16 * sc, 5.5 * sc, 0, 0, Math.PI * 2); g.fill();
        g.globalAlpha = 1;
      }
      g.fillStyle = 'rgba(40,25,10,0.28)';
      g.beginPath(); g.ellipse(x, u.y, 13 * sc, 4 * sc, 0, 0, Math.PI * 2); g.fill();
    }
    g.globalAlpha = 1;

    for (const it of drawList) {
      if (it.s) {
        const s = it.s;
        const d = depth(s.y);
        let x = (it.dying ? s.wx : B.px + s.ox) - B.camX;
        let y = s.y;
        let pose;
        if (it.dying) {
          const q = Math.min(1, s.deathT / 0.3);
          pose = { tilt: -1.35 * q, bob: 0, arm: 0.4, wpn: 0.6 };
          x -= 8 * q;
          g.globalAlpha = Math.max(0, 1 - Math.max(0, s.deathT - 0.3) / 0.6);
        } else {
          pose = poseSoldier(s);
          if (s.spawnT > 0) {
            const q = 1 - s.spawnT / 0.5;
            y -= (1 - q * q) * 110;
            g.globalAlpha = Math.min(1, q * 2);
          }
        }
        Engine.drawLook(g, s.look, x, y, CHAR_S / Engine.PS * d, false, pose, s.hitT > 0.07);
        g.globalAlpha = 1;
        if (!it.dying && s.shield > 0) {
          g.globalAlpha = 0.28 + 0.08 * Math.sin(B.time * 6 + s.phase);
          g.fillStyle = '#9fe6ff';
          g.beginPath(); g.ellipse(x, y - 22 * d, 20 * d, 28 * d, 0, 0, Math.PI * 2); g.fill();
          g.globalAlpha = 1;
        }
      } else {
        const e = it.e;
        const d = depth(e.y) * e.scale;
        const x = e.x - B.camX;
        if (x < -60 || x > VW + 80) continue;
        let pose;
        if (e.dead) {
          const q = Math.min(1, e.deathT / 0.3);
          pose = { tilt: -1.3 * q, bob: 0, arm: 0.3, wpn: 0.4 };
          g.globalAlpha = Math.max(0, 1 - Math.max(0, e.deathT - 0.25) / 0.55);
        } else pose = poseEnemy(e);
        Engine.drawLook(g, e.look, x + (e.dead ? 8 * Math.min(1, e.deathT / 0.3) : 0), e.y, CHAR_S / Engine.PS * d, true, pose, e.hitT > 0.07 && !e.T.boss);
        g.globalAlpha = 1;
        if (e.slowT > 0 && !e.dead) {
          g.globalAlpha = 0.3; g.fillStyle = '#8fd8ff';
          g.beginPath(); g.ellipse(x, e.y - 20 * d, 16 * d, 24 * d, 0, 0, Math.PI * 2); g.fill();
          g.globalAlpha = 1;
        }
        if (e.stunT > 0 && !e.dead) {
          for (let i = 0; i < 3; i++) {
            const a = B.time * 5 + i * 2.1;
            drawIcon('assets/vfx/sparkle.png', x + Math.cos(a) * 10 * d, e.y - 52 * d + Math.sin(a) * 3, 8);
          }
        }
      }
    }

    // health bars on top
    for (const it of drawList) {
      if (it.dying) continue;
      const u = it.s || it.e;
      if (!u.look || u.dead || u.hp >= u.maxHp - 0.01 || (it.e && it.e.T.boss)) continue;
      const d = depth(u.y) * (u.scale || 1);
      const x = (it.s ? B.px + u.ox : u.x) - B.camX;
      const y = u.y + u.look.A.y * (CHAR_S / Engine.PS) * d - 3;
      const w = 18 * d;
      g.fillStyle = 'rgba(20,10,10,0.75)';
      g.fillRect(x - w / 2 - 1, y - 1, w + 2, 4);
      g.fillStyle = it.s ? '#5ee05a' : '#ff5148';
      g.fillRect(x - w / 2, y, w * clamp(u.hp / u.maxHp, 0, 1), 2);
    }
  }

  function drawIcon(src, x, y, size, rot, alpha) {
    const im = IMG(src);
    if (!im) return;
    const w = size, h = size * im.naturalHeight / im.naturalWidth;
    if (rot || alpha != null) {
      g.save();
      if (alpha != null) g.globalAlpha *= alpha;
      g.translate(x, y); if (rot) g.rotate(rot);
      g.drawImage(im, -w / 2, -h / 2, w, h);
      g.restore();
    } else g.drawImage(im, x - w / 2, y - h / 2, w, h);
  }

  function drawProjs() {
    for (const p of B.projs) {
      const x = p.x - B.camX, y = p.y;
      if (p.kind === 'skill') {
        drawIcon(p.icon, x, y, p.size, p.ang + p.rot);
        if (p.icon.includes('fireball') || p.icon.includes('meteor')) {
          g.globalCompositeOperation = 'lighter';
          const r = p.size * 0.7;
          const gr = g.createRadialGradient(x, y, 0, x, y, r);
          gr.addColorStop(0, 'rgba(255,200,80,0.6)'); gr.addColorStop(1, 'rgba(255,80,0,0)');
          g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
          g.globalCompositeOperation = 'source-over';
        }
      } else if (p.kind === 'arrow' || p.kind === 'earrow') {
        drawIcon('assets/vfx/arrow.png', x, y, p.kind === 'arrow' ? 20 : 18, p.ang);
      } else if (p.kind === 'bullet') {
        g.strokeStyle = '#fff3b0'; g.lineWidth = 2;
        g.beginPath(); g.moveTo(x - Math.cos(p.ang) * 10, y - Math.sin(p.ang) * 10); g.lineTo(x, y); g.stroke();
      } else if (p.kind === 'orb' || p.kind === 'eorb') {
        const col = p.kind === 'orb' ? '120,170,255' : '150,255,90';
        g.globalCompositeOperation = 'lighter';
        const gr = g.createRadialGradient(x, y, 0, x, y, 9);
        gr.addColorStop(0, `rgba(255,255,255,0.95)`); gr.addColorStop(0.4, `rgba(${col},0.8)`); gr.addColorStop(1, `rgba(${col},0)`);
        g.fillStyle = gr; g.beginPath(); g.arc(x, y, 9, 0, Math.PI * 2); g.fill();
        g.globalCompositeOperation = 'source-over';
      }
    }
  }

  function drawGroundFx() {
    for (const f of B.fx) {
      if (f.t < 0) continue;
      const x = f.x - B.camX, q = f.t / f.dur;
      if (f.kind === 'field') {
        const a = Math.min(1, f.t * 4) * Math.min(1, (f.dur - f.t) * 2);
        const col = f.field === 'poison' ? '120,220,60' : '170,70,255';
        g.globalAlpha = 0.45 * a;
        const gr = g.createRadialGradient(x, f.y, 0, x, f.y, f.r);
        gr.addColorStop(0, `rgba(${col},0.9)`); gr.addColorStop(1, `rgba(${col},0)`);
        g.fillStyle = gr;
        g.beginPath(); g.ellipse(x, f.y, f.r, f.r * 0.45, 0, 0, Math.PI * 2); g.fill();
        g.globalAlpha = a;
        const icon = f.field === 'poison' ? 'assets/vfx/dust.png' : 'assets/skills/hellfire.png';
        for (let i = 0; i < 7; i++) {
          const ang = i * 0.9 + f.t * (f.field === 'poison' ? 0.6 : 1.4);
          const fx = x + Math.cos(ang) * f.r * 0.6 * ((i % 3 + 1) / 3);
          const fy = f.y + Math.sin(ang) * f.r * 0.22 - 6;
          const fl = 0.8 + 0.25 * Math.sin(f.t * 12 + i);
          if (f.field === 'poison') {
            g.globalAlpha = a * 0.6;
            g.fillStyle = '#9dff5c';
            g.beginPath(); g.arc(fx, fy - ((f.t * 30 + i * 9) % 22), 3 * fl, 0, Math.PI * 2); g.fill();
          } else drawIcon(icon, fx, fy - 6, 18 * fl, 0, a);
        }
        g.globalAlpha = 1;
      } else if (f.kind === 'crater') {
        drawIcon('assets/vfx/ImpactCrater.png', x, f.y, 110, 0, Math.min(1, (f.dur - f.t) / 1.0));
      } else if (f.kind === 'beam') {
        const a = Math.sin(Math.min(1, q) * Math.PI);
        g.globalCompositeOperation = 'lighter';
        drawIcon('assets/vfx/ring.png', x, f.y, 34 + q * 24, 0, a);
        g.globalCompositeOperation = 'source-over';
      }
    }
  }

  function drawFx() {
    for (const f of B.fx) {
      if (f.t < 0 || f.kind === 'timer' || f.kind === 'field' || f.kind === 'crater') continue;
      const x = f.x - B.camX, q = Math.min(1, f.t / f.dur);
      switch (f.kind) {
        case 'beam': {
          const a = Math.sin(q * Math.PI);
          const w = (f.grade >= 4 ? 30 : 20) * (1 - q * 0.5);
          g.globalCompositeOperation = 'lighter';
          const gr = g.createLinearGradient(0, f.y - 170, 0, f.y);
          gr.addColorStop(0, 'rgba(255,255,255,0)');
          gr.addColorStop(1, f.color);
          g.globalAlpha = a * (0.3 + 0.12 * f.grade);
          g.fillStyle = gr;
          g.fillRect(x - w / 2, f.y - 170, w, 170);
          g.globalAlpha = a;
          drawIcon('assets/vfx/sparkle.png', x, f.y - 30 - q * 30, 18 + 10 * a);
          if (f.grade >= 4) drawIcon('assets/ui/rank-flare.png', x, f.y - 28, 70 * a, B.time * 2, a * 0.8);
          g.globalCompositeOperation = 'source-over';
          g.globalAlpha = 1;
          break;
        }
        case 'poof':
          drawIcon('assets/vfx/dust.png', x, f.y - q * 10, (22 + q * 18) * f.s, 0, 1 - q);
          break;
        case 'dust':
          drawIcon('assets/vfx/dust.png', x, f.y, 10 + q * 10, 0, 1 - q);
          break;
        case 'spark':
          g.globalCompositeOperation = 'lighter';
          drawIcon('assets/vfx/sparkle.png', x, f.y, (f.crit ? 26 : 16) * (0.6 + q), q * 2, 1 - q);
          g.globalCompositeOperation = 'source-over';
          break;
        case 'muzzle':
          g.globalCompositeOperation = 'lighter';
          drawIcon('assets/vfx/explosion.png', x, f.y, 12, 0, 1 - q);
          g.globalCompositeOperation = 'source-over';
          break;
        case 'burst': {
          g.globalCompositeOperation = 'lighter';
          g.globalAlpha = 1 - q;
          g.strokeStyle = f.color; g.lineWidth = 3 * (1 - q);
          g.beginPath(); g.ellipse(x, f.y, 6 + q * 20, 4 + q * 12, 0, 0, Math.PI * 2); g.stroke();
          g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
          break;
        }
        case 'boom':
          drawIcon('assets/vfx/explosion.png', x, f.y - q * 6, 46 * f.s * (0.5 + q * 0.8), 0, 1 - q * q);
          break;
        case 'smoke':
          drawIcon('assets/vfx/CannonGas.png', x, f.y - q * 14, 60 * f.s * (0.6 + q * 0.6), 0, (1 - q) * 0.8);
          break;
        case 'ring':
          drawIcon('assets/vfx/ImpactSmokeRing.png', x, f.y, 80 + q * 120, 0, 1 - q);
          break;
        case 'frost':
          drawIcon('assets/vfx/sparkle.png', x, f.y, 20 + q * 8, q, 1 - q);
          break;
        case 'lance': {
          const lx = f.x - B.camX;
          g.globalCompositeOperation = 'lighter';
          const gr = g.createLinearGradient(lx - 80, 0, lx, 0);
          gr.addColorStop(0, 'rgba(120,210,255,0)'); gr.addColorStop(1, 'rgba(160,230,255,0.7)');
          g.fillStyle = gr; g.fillRect(lx - 80, f.y - 5, 80, 10);
          g.globalCompositeOperation = 'source-over';
          drawIcon('assets/skills/ice-lance.png', lx, f.y, 40, Math.PI * 0.28);
          break;
        }
        case 'wave': {
          const wx = f.x - B.camX;
          const a = Math.min(1, (f.dur - f.t) * 3);
          for (let i = 0; i < Math.ceil(LANES / 2); i++) drawIcon('assets/skills/fire-wave.png', wx - (i % 2) * 8, laneY0 - 10 + i * LANE_SP * 2, 52, 0, a);
          break;
        }
        case 'cloud':
          drawIcon(q < 0.85 && Math.sin(f.t * 30) > 0 ? 'assets/vfx/StormCloudFlash.png' : 'assets/vfx/StormCloudIdle.png', x, f.y, 150, 0, Math.min(1, f.t * 5, (f.dur - f.t) * 4));
          break;
        case 'bolt': {
          let px = x, py = f.top;
          const steps = 7;
          g.strokeStyle = 'rgba(180,240,255,0.95)'; g.lineWidth = 3 * (1 - q) + 1;
          g.shadowColor = '#5fd4ff'; g.shadowBlur = 10;
          g.beginPath(); g.moveTo(px, py);
          for (let i = 1; i <= steps; i++) {
            const ny = lerp(f.top, f.y, i / steps);
            const nx = x + (i < steps ? (hash(Math.floor(f.seed) + i) - 0.5) * 22 : 0);
            g.lineTo(nx, ny); px = nx; py = ny;
          }
          g.stroke();
          g.shadowBlur = 0;
          drawIcon('assets/vfx/zap.png', x, f.y, 34, q * 3, 1 - q);
          break;
        }
        case 'icon': {
          const s = q < 0.2 ? q / 0.2 * 1.2 : q < 0.3 ? 1.2 - (q - 0.2) : 1;
          drawIcon(f.icon, x, f.y - q * 16, f.size * s, 0, q > 0.7 ? (1 - q) / 0.3 : 1);
          break;
        }
        case 'sun': {
          g.globalCompositeOperation = 'lighter';
          drawIcon('assets/ui/rank-flare.png', x, f.y, 130 * Math.min(1, q * 3), B.time, (1 - q) * 0.9);
          g.globalCompositeOperation = 'source-over';
          drawIcon('assets/skills/sun-blessing.png', x, f.y, 56 * Math.min(1, q * 4), B.time * 0.5, 1 - Math.max(0, q - 0.7) / 0.3);
          break;
        }
        case 'heal':
          if (f.t >= 0) drawIcon('assets/icons/plus.png', x, f.y - q * 22, 10, 0, 1 - q);
          break;
        case 'nova': {
          g.globalCompositeOperation = 'lighter';
          drawIcon('assets/ui/rank-flare.png', x, f.y, 260 * q, q * 2, 1 - q);
          g.globalCompositeOperation = 'source-over';
          drawIcon('assets/skills/star-nova.png', x, f.y, 40 + 110 * q, q * 3, 1 - q * q);
          break;
        }
      }
    }
  }

  function drawTexts() {
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    for (const t of B.texts) {
      const q = t.t / t.dur;
      const x = t.x - B.camX;
      let size = 10, color = '#ffffff', y = t.y - q * 22;
      if (t.kind === 'crit') { size = 14; color = '#ffd33d'; }
      else if (t.kind === 'skill') { size = 12; color = '#ffa13d'; }
      else if (t.kind === 'skillName') { size = 15; color = t.color; y = t.y - q * 14; }
      const pop = q < 0.12 ? 1 + (0.12 - q) * 4 : 1;
      g.globalAlpha = q > 0.7 ? (1 - q) / 0.3 : 1;
      g.font = `${Math.round(size * pop)}px ${FONT}`;
      g.lineWidth = 3;
      g.strokeStyle = 'rgba(30,15,10,0.9)';
      g.strokeText(t.text, x, y);
      g.fillStyle = color;
      g.fillText(t.text, x, y);
    }
    g.globalAlpha = 1;
  }

  function drawCoins() {
    for (const c of B.coins) drawIcon('assets/icons/coin.png', c.x, c.y, 9, 0);
  }

  function drawBanner() {
    const b = B.banner;
    if (!b) return;
    const q = b.t / b.dur;
    const s = b.t < 0.18 ? 1.5 - b.t / 0.18 * 0.5 : 1;
    const a = q > 0.8 ? (1 - q) / 0.2 : 1;
    const y = Math.max(70, laneY0 - 70);
    g.save();
    g.globalAlpha = a;
    const gr = g.createLinearGradient(0, 0, VW, 0);
    gr.addColorStop(0, 'rgba(10,10,30,0)'); gr.addColorStop(0.25, 'rgba(10,10,30,0.55)');
    gr.addColorStop(0.75, 'rgba(10,10,30,0.55)'); gr.addColorStop(1, 'rgba(10,10,30,0)');
    g.fillStyle = gr;
    g.fillRect(0, y - 26, VW, b.sub ? 58 : 46);
    g.translate(VW / 2, y);
    g.scale(s, s);
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
    g.font = `28px ${FONT}`;
    g.lineWidth = 6; g.strokeStyle = '#2a1408';
    g.strokeText(b.text, 0, 0);
    g.fillStyle = b.color;
    g.fillText(b.text, 0, 0);
    if (b.sub) {
      g.font = `12px ${FONT}`;
      g.lineWidth = 3;
      g.strokeText(b.sub, 0, 22);
      g.fillStyle = '#fff';
      g.fillText(b.sub, 0, 22);
    }
    g.restore();
  }

  function draw() {
    g.setTransform(dpr * k, 0, 0, dpr * k, 0, 0);
    g.imageSmoothingQuality = 'high';
    g.save();
    if (B.shake > 0) g.translate(rnd(-1, 1) * B.shake, rnd(-1, 1) * B.shake * 0.6);
    drawBackground();
    drawGroundFx();
    drawUnits();
    drawProjs();
    drawFx();
    drawTexts();
    g.restore();
    drawCoins();
    if (B.flash) {
      g.fillStyle = B.flash.color + (0.45 * (1 - B.flash.t / B.flash.dur)) + ')';
      g.fillRect(0, 0, VW, VH);
    }
    if (B.themeFade > 0) {
      g.fillStyle = `rgba(255,250,235,${B.themeFade})`;
      g.fillRect(0, 0, VW, VH);
    }
    drawBanner();
  }

  // ---------- public ----------
  function startStage(stage) {
    B.stage = stage; B.wave = 0; B.waveActive = false; B.pending = true; B.pendT = 1.0;
    B.enemies = []; B.projs = []; B.boss = null;
  }

  function armySnapshot() {
    return B.lanes.map((lane) => lane.map((s) => [s.cls, s.grade, s.set, Math.round(s.hp / s.maxHp * 100) / 100]));
  }

  // Old saves may hold other classes or a bigger formation: keep the best soldiers that fit.
  function restoreArmy(snap) {
    for (let l = 0; l < LANES; l++) B.lanes[l] = [];
    const all = [];
    snap.forEach((lane, l) => lane.forEach(([cls, grade, set, hp]) => {
      cls = CLASSES[cls] ? cls : LEGACY_CLASS[cls];
      if (cls && GRADES[grade]) all.push({ cls, grade, set, hp, l });
    }));
    const sameShape = snap.length === LANES && snap.every((lane) => lane.length <= RANKS);
    all.sort((a, b) => b.grade - a.grade);
    for (const s of all.slice(0, SLOTS)) {
      addSoldier(s.cls, s.grade, { set: s.set, hp: Math.max(0.2, s.hp), lane: sameShape ? s.l : undefined });
    }
  }

  function soldiers() { return B.lanes.flat(); }

  return {
    B, init, resize, update, draw, addSoldier, refreshSoldierStats, castSkill, startStage, mergeAll, mergeCount,
    armySnapshot, restoreArmy, aliveCount, soldiers, toVirtual, setBanner,
    get VH() { return VH; },
  };
})();
