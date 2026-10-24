'use strict';
// Game state, economy, save/load and the main loop.

const Game = (() => {
  const SAVE_KEY = 'phalanx-rush-save-v1';
  const sfx = (n, v, r) => Engine.Sfx.play(n, v, r);

  function defaults() {
    return {
      v: 1, gold: 300, gems: 500, stage: 0, maxStage: 0,
      upg: Object.fromEntries(UPGRADES.map((u) => [u.id, 0])),
      recruit: { lv: 0, xp: 0 },
      skills: { fireball: { lv: 1, n: 0 } },
      equip: ['fireball', null, null, null, null, null],
      auto: true, farm: false, army: null,
      quest: { i: 0, base: 0 },
      stats: { kills: 0, summons: 0, upgrades: 0, skillSummons: 0, bosses: 0, deaths: 0, merges: 0 },
      lastSeen: Date.now(), sound: true, speed: 1, tut: 0, cheat: false,
    };
  }

  // Settings cheat: keeps every currency topped up while it is on.
  function cheatTick() {
    if (!S.cheat) return;
    S.gold = Math.max(S.gold, 1e15);
    S.gems = Math.max(S.gems, 1e6);
  }

  const S = defaults();
  const mods = {};

  function load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return false;
      const d = JSON.parse(raw);
      // Saves from the dice-equipment version: its army and quest data use other formats.
      if (d.v === 2) {
        d.v = 1;
        d.army = null;
        d.quest = null;
        d.tut = 1;
        if (d.upg) { delete d.upg.reinforceCd; delete d.upg.reinforceCount; }
        for (const k of ['dice', 'gear', 'pending', 'brackets', 'nextItemId', 'diceLevel', 'diceUpgradeEnds', 'autoForge', 'level', 'exp']) delete d[k];
      }
      const base = defaults();
      Object.assign(S, base, d);
      S.upg = Object.assign(base.upg, d.upg);
      S.stats = Object.assign(base.stats, d.stats);
      S.recruit = Object.assign(base.recruit, d.recruit);
      S.quest = Object.assign(base.quest, d.quest);
      while (S.equip.length < 6) S.equip.push(null);
      return true;
    } catch (e) { return false; }
  }

  function save() {
    if (resetting) return;
    S.army = Battle.armySnapshot();
    S.stage = Battle.B.stage;
    S.lastSeen = Date.now();
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(S)); } catch (e) { /* storage unavailable */ }
  }

  let resetting = false;
  function reset() {
    resetting = true;
    try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ }
    location.reload();
  }

  function recalc() {
    for (const u of UPGRADES) mods[u.id] = u.val(S.upg[u.id] || 0);
    if (Battle.B) Battle.refreshSoldierStats();
  }

  // ---------- soldiers ----------
  const summonCost = () => F.summonCost(Battle.B.stage);

  function rollSoldier() {
    const odds = RECRUIT_ODDS[Math.min(S.recruit.lv, RECRUIT_ODDS.length - 1)];
    const grade = pickWeighted(odds);
    const cls = CLASS_IDS[pickWeighted(CLASS_IDS.map((c) => CLASSES[c].weight))];
    return { cls, grade };
  }

  function addRecruitXp(n) {
    const R = S.recruit;
    R.xp += n;
    while (R.lv < RECRUIT_XP.length && R.xp >= RECRUIT_XP[R.lv]) {
      R.xp -= RECRUIT_XP[R.lv];
      R.lv++;
      UI.toast(`모집 레벨 업! <b>Lv.${R.lv + 1}</b> — 고급 병사 확률 상승`, 'big g2');
      sfx('UiPlayerLevelUp', 0.6);
    }
    if (R.lv >= RECRUIT_XP.length) R.xp = 0;
  }

  function summonOne(quiet) {
    if (Battle.B.state === 'wipe') return null;
    if (Battle.aliveCount() >= SLOTS) {
      if (!quiet) { UI.toast('부대가 가득 찼습니다'); sfx('UiDeny', 0.5); }
      return null;
    }
    const cost = summonCost();
    if (S.gold < cost) {
      if (!quiet) { UI.toast('골드가 부족합니다'); sfx('UiDeny', 0.5); }
      return null;
    }
    S.gold -= cost;
    const r = rollSoldier();
    const s = Battle.addSoldier(r.cls, r.grade, { drop: true });
    S.stats.summons++;
    S.tut = 1;
    addRecruitXp(1);
    UI.summonToast(s);
    sfx(r.grade >= 3 ? 'UiReveal' : 'UiConfirm', r.grade >= 3 ? 0.7 : 0.35, 1 + Math.random() * 0.1);
    return s;
  }

  function summonFill() {
    const cost = summonCost();
    const list = [];
    while (Battle.aliveCount() < SLOTS && S.gold >= cost && Battle.B.state !== 'wipe') {
      S.gold -= cost;
      const r = rollSoldier();
      list.push(Battle.addSoldier(r.cls, r.grade, { drop: true }));
      S.stats.summons++;
      addRecruitXp(1);
    }
    if (!list.length) {
      UI.toast(Battle.aliveCount() >= SLOTS ? '부대가 가득 찼습니다' : '골드가 부족합니다');
      sfx('UiDeny', 0.5);
      return;
    }
    S.tut = 1;
    UI.showFillResults(list);
    sfx(list.some((s) => s.grade >= 3) ? 'UiReveal' : 'UiConfirm', 0.6);
  }

  function merge() {
    if (Battle.B.state === 'wipe') return [];
    const made = Battle.mergeAll();
    if (!made.length) {
      UI.toast('같은 등급 병사 3명이 있어야 합성할 수 있습니다');
      sfx('UiDeny', 0.5);
      return made;
    }
    S.stats.merges += made.length;
    const top = Math.max(...made.map((s) => s.grade));
    const counts = GRADES.map(() => 0);
    for (const s of made) counts[s.grade]++;
    const parts = counts.map((n, i) => n ? `<b style="color:${GRADES[i].color}">${GRADES[i].name} ${n}</b>` : '').filter(Boolean).join(' · ');
    UI.toast(`합성 완료! ${parts} · 빈자리 ${SLOTS - Battle.aliveCount()}칸`, 'big g' + top);
    sfx('UiReveal', 0.6, 1.1);
    return made;
  }

  // ---------- skills ----------
  const unlockedSlots = () => SKILL_SLOT_UNLOCK.filter((v) => S.maxStage >= v).length;

  function skillSummon(n) {
    const cost = n === 10 ? SKILL_COST.ten : SKILL_COST.one * n;
    if (S.gems < cost) { UI.toast('보석이 부족합니다'); sfx('UiDeny', 0.5); return; }
    S.gems -= cost;
    const res = [];
    for (let i = 0; i < n; i++) {
      const grade = pickWeighted(SKILL_ODDS);
      const pool = SKILLS.filter((s) => s.grade === grade);
      const sk = pool[Math.floor(Math.random() * pool.length)];
      const own = S.skills[sk.id];
      if (own) { own.n++; res.push({ sk, isNew: false }); }
      else {
        S.skills[sk.id] = { lv: 1, n: 0 };
        res.push({ sk, isNew: true });
        const free = S.equip.findIndex((e, j) => !e && j < unlockedSlots());
        if (free >= 0) S.equip[free] = sk.id;
      }
    }
    S.stats.skillSummons += n;
    UI.showSkillResults(res);
    sfx('UiChest', 0.5);
  }

  function levelSkill(id) {
    const o = S.skills[id];
    if (!o || o.lv >= SKILL_MAX_LV) return false;
    const need = F.skillNeed(o.lv);
    if (o.n < need) return false;
    o.n -= need;
    o.lv++;
    return true;
  }

  function levelAllSkills() {
    let any = false;
    for (const id in S.skills) while (levelSkill(id)) any = true;
    return any;
  }

  function toggleEquip(id) {
    const i = S.equip.indexOf(id);
    if (i >= 0) { S.equip[i] = null; return 'off'; }
    const free = S.equip.findIndex((e, j) => !e && j < unlockedSlots());
    if (free < 0) return 'full';
    S.equip[free] = id;
    return 'on';
  }

  // ---------- upgrades ----------
  function upgradeQuote(u, n) {
    let lv = S.upg[u.id] || 0;
    const max = u.max != null ? u.max : Infinity;
    let total = 0, count = 0;
    if (n === 'max') {
      while (lv < max) {
        const c = F.upgradeCost(u, lv);
        if (total + c > S.gold) break;
        total += c; lv++; count++;
      }
      if (!count && lv < max) return { total: F.upgradeCost(u, lv), count: 0 };
    } else {
      for (let i = 0; i < n && lv < max; i++) { total += F.upgradeCost(u, lv); lv++; count++; }
    }
    return { total, count };
  }

  function buyUpgrade(id, n) {
    const u = UPGRADE_BY_ID[id];
    const { total, count } = upgradeQuote(u, n);
    if (!count || S.gold < total) { sfx('UiDeny', 0.4); return false; }
    S.gold -= total;
    S.upg[id] += count;
    S.stats.upgrades += count;
    recalc();
    sfx('UiLevelUp', 0.25, 1.3 + Math.random() * 0.1);
    return true;
  }

  // ---------- battle events ----------
  function onEnemyKilled(e) {
    S.gold += F.goldPerKill(Battle.B.stage) * e.T.gold * mods.gold;
    S.stats.kills++;
    if (e.T.boss) S.stats.bosses++;
  }

  function onSoldierDied() {
    S.stats.deaths++;
    UI.bumpBadge();
  }

  // Returns the gems awarded (first clears only).
  function onStageCleared(stage) {
    const before = unlockedSlots();
    // Repeat clears pay a fifth of the first-clear gems.
    const first = stage + 1 > S.maxStage;
    if (first) S.maxStage = stage + 1;
    const gems = first ? F.stageGems(stage) : Math.floor(F.stageGems(stage) / 5);
    S.gems += gems;
    if (unlockedSlots() > before) UI.toast('스킬 슬롯이 열렸습니다!', 'big g3');
    save();
    return gems;
  }

  function onWipe() {
    const B = Battle.B;
    // Fall back one stage and farm it until the player challenges again.
    if (B.stage > 0) B.stage--;
    S.farm = true;
    const n = Math.min(Math.ceil(SLOTS / 3), SLOTS - Battle.aliveCount());
    for (let i = 0; i < n; i++) {
      const cls = CLASS_IDS[pickWeighted(CLASS_IDS.map((c) => CLASSES[c].weight))];
      Battle.addSoldier(cls, 0, { drop: true });
    }
    UI.toast(`긴급 징집! 일반 병사 ${n}명 합류 · ${F.stageLabel(B.stage)} 반복 사냥`, 'big g0');
    save();
  }

  function challenge() {
    if (!S.farm) return;
    S.farm = false;
    Battle.startStage(Math.min(S.maxStage, Battle.B.stage + 1));
    UI.toast('보스 도전! 전진합니다', 'big g5');
    sfx('UiConfirm', 0.7, 0.8);
  }

  function coinArrived() {
    if (coinSfxT <= 0) { sfx('CombatCoin1', 0.18, 1 + Math.random() * 0.2); coinSfxT = 0.08; }
    UI.pulseGold();
  }
  let coinSfxT = 0;

  // ---------- quests ----------
  function questState() {
    const def = questDef(S.quest.i);
    const cur = def.kind.stat === 'stage' ? S.maxStage + 1 : S.stats[def.kind.stat] - S.quest.base;
    return { def, cur: Math.max(0, Math.min(cur, def.target)), done: cur >= def.target };
  }

  function claimQuest() {
    const q = questState();
    if (!q.done) { UI.toast('퀘스트: ' + q.def.kind.text(q.def.target)); return false; }
    S.gems += q.def.reward;
    S.quest.i++;
    const next = questDef(S.quest.i);
    S.quest.base = next.kind.stat === 'stage' ? 0 : S.stats[next.kind.stat];
    UI.toast(`퀘스트 완료! <img class="tw" src="${asset('assets/ui/currency-gem.png')}" alt=""> +${q.def.reward}`, 'big g4');
    sfx('UiReward', 0.7);
    return true;
  }

  // ---------- misc ----------
  function power() {
    let p = 0;
    for (const s of Battle.soldiers()) p += (s.C.atk / s.C.spd) * GRADES[s.grade].mult * mods.atk * 6 + s.maxHp * 0.5;
    for (const id of S.equip) if (id && S.skills[id]) p += (SKILL_BY_ID[id].grade + 1) * 60 * S.skills[id].lv * mods.skill * mods.atk;
    return p * (1 + mods.crit * (mods.critDmg - 1)) * mods.aspd;
  }

  // One spearman and one archer per file; the empty middle rank is the first thing to recruit.
  function starterArmy() {
    for (let l = 0; l < LANES; l++) {
      Battle.addSoldier('spear', l === 2 ? 1 : 0, { lane: l });
      Battle.addSoldier('bow', 0, { lane: l });
    }
  }

  function offline() {
    const secs = (Date.now() - S.lastSeen) / 1000;
    if (secs < 120) return;
    const capped = Math.min(secs, 8 * 3600);
    const gold = F.goldPerKill(S.stage) * mods.gold * 10 * (capped / 60) * 0.5;
    UI.offlinePopup(capped, gold, () => { S.gold += gold; });
  }

  // ---------- loop ----------
  let last = 0, saveT = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000 || 0);
    last = now;
    coinSfxT -= dt;
    // Each stage is guarded on its own so a drawing glitch never freezes the HUD.
    for (const step of [() => { for (let i = 0; i < S.speed; i++) Battle.update(dt); }, () => Battle.draw(), () => { cheatTick(); UI.tick(dt); }]) {
      try { step(); } catch (e) { if (!frame.reported) { frame.reported = true; console.error(e); } }
    }
    saveT += dt;
    if (saveT > 10) { saveT = 0; save(); }
  }

  async function boot() {
    const bar = document.querySelector('#loading .lbar i');
    const urls = new Set();
    for (const s of Object.values(MANIFEST.sets)) for (const p of Object.values(s)) urls.add(p.f);
    for (const p of MANIFEST.faces) urls.add(p.f);
    for (const p of Object.values(MANIFEST.weapons)) urls.add(p.f);
    for (const t of THEMES) urls.add(t.bg);
    for (const sk of SKILLS) urls.add('assets/skills/' + sk.id + '.png');
    for (const n of ['arrow', 'sparkle', 'dust', 'explosion', 'ring', 'zap', 'CannonGas', 'ImpactCrater', 'ImpactSmokeRing', 'StormCloudFlash', 'StormCloudIdle']) urls.add('assets/vfx/' + n + '.png');
    for (const n of ['coin', 'plus']) urls.add('assets/icons/' + n + '.png');
    urls.add('assets/ui/rank-flare.png');
    let done = 0;
    const list = [...urls];
    await Engine.loadAll(list, () => { done++; bar.style.width = (done / list.length * 100) + '%'; });
    try {
      const fonts = Promise.all(['ONE Mobile POP', 'Jua'].map((f) => document.fonts.load(`16px "${f}"`, '가')));
      await Promise.race([fonts, new Promise((r) => setTimeout(r, 2500))]);
    } catch (e) { /* font optional */ }

    const loaded = load();
    Engine.Sfx.on = S.sound;
    recalc();
    Battle.init(document.getElementById('cv'));
    if (loaded && S.army) Battle.restoreArmy(S.army);
    if (!Battle.aliveCount()) starterArmy();
    Battle.startStage(S.stage);
    UI.init();
    if (loaded) offline();
    document.getElementById('loading').classList.add('gone');

    const unlock = () => Engine.Sfx.unlock();
    window.addEventListener('pointerdown', unlock, { passive: true });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { save(); return; }
      last = performance.now();
      if (document.getElementById('modal').hidden) offline();
    });
    window.addEventListener('pagehide', save);
    last = performance.now();
    requestAnimationFrame(frame);
  }

  return {
    S, mods, boot, save, reset, summonCost, summonOne, summonFill, merge, skillSummon, levelSkill, levelAllSkills,
    toggleEquip, unlockedSlots, upgradeQuote, buyUpgrade, onEnemyKilled, onSoldierDied, onStageCleared,
    onWipe, challenge, coinArrived, questState, claimQuest, power,
  };
})();

// Inside the claude.ai viewer, keep progress across live page updates.
if (window.claude && window.claude.hot && typeof window.claude.hot.snapshot === 'function') {
  window.claude.hot.snapshot(() => { Game.save(); return {}; });
}
if (window.claude && window.claude.hot && window.claude.hot.ready) window.claude.hot.ready(() => Game.boot());
else Game.boot();
