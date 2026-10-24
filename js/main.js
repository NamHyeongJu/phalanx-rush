'use strict';
// Game state, economy, equipment dice, save/load and the main loop.

const Game = (() => {
  const SAVE_KEY = 'phalanx-rush-save-v1';
  const sfx = (n, v, r) => Engine.Sfx.play(n, v, r);

  function defaults() {
    return {
      v: 2, gold: 300, gems: 500, dice: 30, stage: 0, maxStage: 0,
      upg: Object.fromEntries(UPGRADES.map((u) => [u.id, 0])),
      skills: { fireball: { lv: 1, n: 0 } },
      equip: ['fireball', null, null, null, null, null], // skill slots
      gear: Object.fromEntries(EQ_SLOTS.map((s) => [s, null])), // equipped items
      pending: [], brackets: {}, nextItemId: 1,
      diceLevel: 1, diceUpgradeEnds: 0, autoForge: false,
      level: 1, exp: 0,
      auto: true, farm: false, army: null,
      quest: { i: 0, base: 0 },
      stats: { kills: 0, forges: 0, sells: 0, upgrades: 0, skillSummons: 0, bosses: 0, deaths: 0 },
      lastSeen: Date.now(), sound: true, speed: 1,
    };
  }

  const S = defaults();
  const mods = {};
  const army = { spear: { atk: 1, hp: 1 }, bow: { atk: 1, hp: 1 }, opts: {} };

  let fresh = true;
  function load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return false;
      const d = JSON.parse(raw);
      const base = defaults();
      if (d.v !== 2) {
        // The soldier-gacha version: keep currencies, records, upgrades and skills. Equipment starts
        // fresh, so the march restarts at 1-1 (the best stage reached still unlocks skill slots).
        for (const k of ['gold', 'gems', 'maxStage', 'skills', 'equip', 'auto', 'sound', 'speed', 'lastSeen']) if (d[k] != null) base[k] = d[k];
        for (const u of UPGRADES) if (d.upg && d.upg[u.id] != null) base.upg[u.id] = d.upg[u.id];
        if (d.stats) for (const k of ['kills', 'upgrades', 'skillSummons', 'bosses', 'deaths']) base.stats[k] = d.stats[k] || 0;
        Object.assign(S, base);
        return true;
      }
      Object.assign(S, base, d);
      S.upg = Object.assign(base.upg, d.upg);
      S.stats = Object.assign(base.stats, d.stats);
      S.quest = Object.assign(base.quest, d.quest);
      S.gear = Object.assign(base.gear, d.gear);
      while (S.equip.length < 6) S.equip.push(null);
      fresh = false;
      return true;
    } catch (e) { return false; }
  }

  let resetting = false;
  function save() {
    if (resetting) return;
    S.army = Battle.armySnapshot();
    S.stage = Battle.B.stage;
    S.lastSeen = Date.now();
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(S)); } catch (e) { /* storage unavailable */ }
  }

  function reset() {
    resetting = true;
    try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ }
    location.reload();
  }

  // Equipment -> army: forge-clone-2 totals, level bonus and options, then upgrades per class.
  function recalc() {
    for (const u of UPGRADES) mods[u.id] = u.val(S.upg[u.id] || 0);
    const t = Forge.totals(S.gear), O = t.opts, lv = F.levelBonus(S.level);
    army.opts = O;
    army.attack = t.attack * (1 + O.DAMAGE) * lv;
    army.health = t.health * (1 + O.HEALTH) * lv;
    army.spear = { atk: army.attack * CLASSES.spear.atkF * mods.atk * (1 + O.MELEE_DAMAGE), hp: army.health * CLASSES.spear.hpF * mods.hp };
    army.bow = { atk: army.attack * CLASSES.bow.atkF * mods.atk * (1 + O.RANGED_DAMAGE), hp: army.health * CLASSES.bow.hpF * mods.hp };
    army.crit = mods.crit + O.CRITICAL_CHANCE;
    army.critDmg = mods.critDmg + O.CRITICAL_DAMAGE;
    army.aspd = mods.aspd * (1 + O.ATTACK_SPEED);
    army.skillMult = mods.skill * (1 + O.SKILL_DAMAGE);
    army.skillCd = Math.min(0.5, O.SKILL_COOLDOWN);
    army.lifesteal = O.LIFE_STEAL;
    army.block = Math.min(0.5, O.BLOCK_CHANCE);
    army.regen = O.HEALTH_REGENERATION;
    army.double = O.DOUBLE_CHANCE;
    if (Battle.B) Battle.refreshSoldierStats();
  }

  // Dress the whole formation in the equipped outfit once its sprites are loaded.
  async function applyOutfit() {
    const o = Forge.outfit(S.gear);
    await Engine.loadAll(Forge.outfitLabels(o).map((l) => EQUIP.parts[l].f));
    Battle.setUniform(o);
  }

  // ---------- equipment dice ----------
  function forgeState() { return { diceLevel: S.diceLevel, brackets: S.brackets, nextId: S.nextItemId }; }

  function roll(quiet) {
    if (S.dice < 1) { if (!quiet) { UI.toast('주사위가 부족합니다'); sfx('UiDeny', 0.5); } return null; }
    if (S.pending.length >= PENDING_CAP) { if (!quiet) { UI.toast('보관함이 가득 찼습니다. 장착하거나 판매하세요'); sfx('UiDeny', 0.5); } return null; }
    S.dice -= 1;
    const st = forgeState();
    const item = Forge.roll(st);
    S.nextItemId = st.nextId;
    S.pending.push(item);
    S.stats.forges++;
    return item;
  }

  function takePending(id) {
    const i = S.pending.findIndex((p) => p.id === id);
    return i < 0 ? null : S.pending.splice(i, 1)[0];
  }

  function sell(item) {
    const gold = Math.round(F.sellGold(item, Battle.B.stage) * mods.gold);
    S.gold += gold;
    S.stats.sells++;
    addExp(SELL_EXP);
    return gold;
  }

  // Equipping replaces the slot; the previous item is sold like in forge-clone-2.
  function equipPending(id) {
    const item = takePending(id);
    if (!item) return null;
    const old = S.gear[item.slot];
    S.gear[item.slot] = item;
    let result = null;
    if (old) result = { item: old, gold: sell(old) };
    recalc();
    applyOutfit();
    save();
    return result;
  }

  function sellPending(id) {
    const item = takePending(id);
    return item ? { gold: sell(item) } : null;
  }

  function addExp(n) {
    S.exp += n;
    let up = false;
    while (S.exp >= F.expNeed(S.level)) { S.exp -= F.expNeed(S.level); S.level++; up = true; }
    if (up) {
      recalc();
      UI.toast(`레벨 업! <b>Lv.${S.level}</b> · 공격력·체력 +2%`, 'big');
      sfx('UiPlayerLevelUp', 0.55);
    }
  }

  const autoForgeUnlocked = () => S.maxStage >= 2;
  function toggleAutoForge() {
    if (!autoForgeUnlocked()) { UI.toast('자동 굴리기는 1-3 도달 시 열립니다'); sfx('UiDeny', 0.5); return; }
    S.autoForge = !S.autoForge;
    sfx('UiTap', 0.6);
    UI.toast(S.autoForge ? '자동 굴리기 시작 · 더 좋은 장비가 나오면 멈춥니다' : '자동 굴리기 중지');
  }

  // Rolls on its own; weaker items are sold, an upgrade stops it and waits for the player.
  let autoT = 0;
  function autoForgeTick(dt) {
    if (!S.autoForge) return;
    autoT -= dt;
    if (autoT > 0 || UI.rolling || UI.comparing || S.pending.length || UI.page !== 'home') return;
    autoT = 0.55;
    if (S.dice < 1) { S.autoForge = false; UI.toast('주사위가 떨어져 자동 굴리기를 멈췄습니다'); return; }
    const item = roll(true);
    if (!item) return;
    const kept = Forge.improves(item, S.gear[item.slot]);
    if (kept) {
      S.autoForge = false;
      UI.toast('더 좋은 장비가 나왔습니다!', 'big');
    } else {
      takePending(item.id);
      sell(item);
    }
    UI.autoResult(item, kept);
  }

  // Dice level research: gold plus waiting time, skippable with gems.
  function diceUpgrade() {
    if (S.diceUpgradeEnds || S.diceLevel >= DICE_LEVEL_MAX) return false;
    const cost = F.diceUpgradeCost(S.diceLevel);
    if (S.gold < cost) { UI.toast('골드가 부족합니다'); sfx('UiDeny', 0.5); return false; }
    S.gold -= cost;
    S.diceUpgradeEnds = Date.now() + F.diceUpgradeTime(S.diceLevel) * 1000;
    sfx('UiConfirm', 0.5);
    save();
    return true;
  }

  function diceSkip() {
    if (!S.diceUpgradeEnds) return false;
    const gems = F.diceSkipGems((S.diceUpgradeEnds - Date.now()) / 1000);
    if (S.gems < gems) { UI.toast('보석이 부족합니다'); sfx('UiDeny', 0.5); return false; }
    S.gems -= gems;
    S.diceUpgradeEnds = 1;
    diceTick();
    return true;
  }

  function diceTick() {
    if (S.diceUpgradeEnds && Date.now() >= S.diceUpgradeEnds) {
      S.diceUpgradeEnds = 0;
      S.diceLevel++;
      UI.toast(`주사위 레벨 ${S.diceLevel} 달성! 더 높은 시대 장비가 나옵니다`, 'big');
      sfx('UiLevelUp', 0.7);
      save();
    }
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
    if (e.T.boss) { S.stats.bosses++; S.dice += 3; }
    else if (Math.random() < F.diceDropChance) S.dice += 1;
  }

  function onSoldierDied() { S.stats.deaths++; }

  // Returns the gems awarded (repeat clears pay a fifth).
  function onStageCleared(stage) {
    const before = unlockedSlots();
    const first = stage + 1 > S.maxStage;
    if (first) S.maxStage = stage + 1;
    const gems = first ? F.stageGems(stage) : Math.floor(F.stageGems(stage) / 5);
    S.gems += gems;
    if (first) S.dice += 3;
    if (unlockedSlots() > before) UI.toast('스킬 슬롯이 열렸습니다!', 'big');
    save();
    return gems;
  }

  function onWipe() {
    const B = Battle.B;
    // Fall back one stage and farm it until the player challenges again; the formation regroups in full.
    if (B.stage > 0) B.stage--;
    S.farm = true;
    Battle.reinforce(SLOTS);
    UI.toast(`부대 재정비! ${F.stageLabel(B.stage)} 반복 사냥`, 'big');
    save();
  }

  function challenge() {
    if (!S.farm) return;
    S.farm = false;
    Battle.startStage(Math.min(S.maxStage, Battle.B.stage + 1));
    UI.toast('보스 도전! 전진합니다', 'big');
    sfx('UiConfirm', 0.7, 0.8);
  }

  let coinSfxT = 0;
  function coinArrived() {
    if (coinSfxT <= 0) { sfx('CombatCoin1', 0.18, 1 + Math.random() * 0.2); coinSfxT = 0.08; }
    UI.pulseGold();
  }

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
    S.dice += 5;
    S.quest.i++;
    const next = questDef(S.quest.i);
    S.quest.base = next.kind.stat === 'stage' ? 0 : S.stats[next.kind.stat];
    UI.toast(`퀘스트 완료! <img class="tw" src="${asset('assets/ui/currency-gem.png')}" alt=""> +${q.def.reward} · 주사위 +5`, 'big');
    sfx('UiReward', 0.7);
    return true;
  }

  // ---------- misc ----------
  function power() {
    const dps = army.attack * mods.atk * (1 + army.crit * (army.critDmg - 1)) * army.aspd;
    let p = dps + army.health * mods.hp / 8;
    for (const id of S.equip) if (id && S.skills[id]) p *= 1 + 0.02 * (SKILL_BY_ID[id].grade + 1) * S.skills[id].lv;
    return p;
  }

  function offline() {
    const secs = (Date.now() - S.lastSeen) / 1000;
    if (secs < 120) return;
    const capped = Math.min(secs, 8 * 3600);
    const gold = F.goldPerKill(S.stage) * mods.gold * 10 * (capped / 60) * 0.5;
    const dice = Math.floor(capped / 60 * 0.4);
    S.lastSeen = Date.now();
    UI.offlinePopup(capped, gold, dice, () => { S.gold += gold; S.dice += dice; });
  }

  // ---------- loop ----------
  let last = 0, saveT = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000 || 0);
    last = now;
    coinSfxT -= dt;
    // Each stage is guarded on its own so a drawing glitch never freezes the HUD.
    const steps = [
      () => { for (let i = 0; i < S.speed; i++) Battle.update(dt); },
      () => Battle.draw(),
      () => { diceTick(); autoForgeTick(dt); UI.tick(dt); },
    ];
    for (const step of steps) {
      try { step(); } catch (e) { if (!frame.reported) { frame.reported = true; console.error(e); } }
    }
    saveT += dt;
    if (saveT > 10) { saveT = 0; save(); }
  }

  async function boot() {
    const bar = document.querySelector('#loading .lbar i');
    const loaded = load();
    if (fresh) {
      const st = forgeState();
      for (const item of Forge.starterItems(st)) S.gear[item.slot] = item;
      S.nextItemId = st.nextId;
    }
    const urls = new Set();
    // Enemy sets and the generic enemy weapons; soldier sprites come from the equipped outfit.
    const enemySets = new Set();
    for (const T of Object.values(ENEMY_TYPES)) { enemySets.add(T.look.set); if (T.look.helmet) enemySets.add(T.look.helmet); }
    for (const set of enemySets) for (const p of Object.values(MANIFEST.sets[set])) urls.add(p.f);
    for (const p of MANIFEST.faces) urls.add(p.f);
    for (const p of Object.values(MANIFEST.weapons)) urls.add(p.f);
    for (const l of Forge.outfitLabels(Forge.outfit(S.gear))) urls.add(EQUIP.parts[l].f);
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

    Engine.Sfx.on = S.sound;
    recalc();
    Battle.init(document.getElementById('cv'));
    await applyOutfit();
    if (loaded && S.army) Battle.restoreArmy(S.army);
    if (!Battle.aliveCount()) Battle.reinforce(SLOTS, false);
    Battle.startStage(S.stage);
    UI.init();
    if (loaded) offline();
    document.getElementById('loading').classList.add('gone');

    window.addEventListener('pointerdown', () => Engine.Sfx.unlock(), { passive: true });
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
    S, mods, army, boot, save, reset, roll, equipPending, sellPending, toggleAutoForge, autoForgeUnlocked,
    diceUpgrade, diceSkip, skillSummon, levelSkill, levelAllSkills, toggleEquip, unlockedSlots, upgradeQuote,
    buyUpgrade, onEnemyKilled, onSoldierDied, onStageCleared, onWipe, challenge, coinArrived, questState, claimQuest, power,
  };
})();

// Inside the claude.ai viewer, keep progress across live page updates.
if (window.claude && window.claude.hot && typeof window.claude.hot.snapshot === 'function') {
  window.claude.hot.snapshot(() => { Game.save(); return {}; });
}
if (window.claude && window.claude.hot && window.claude.hot.ready) window.claude.hot.ready(() => Game.boot());
else Game.boot();
