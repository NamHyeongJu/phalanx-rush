'use strict';
// DOM interface: top HUD, battle overlay, forge-clone-2 equipment panel, comparison, pages, popups.

const UI = (() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const el = (tag, cls, html) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  };
  const sfx = (n, v, r) => Engine.Sfx.play(n, v, r);
  const GOLD = `<img class="ci" src="${asset('assets/ui/currency-gold.png')}" alt="">`;
  const GEM = `<img class="ci" src="${asset('assets/ui/currency-gem.png')}" alt="">`;
  const DICE = `<img class="ci" src="${asset('assets/ui/forge-token.png')}" alt="">`;

  let page = 'home';
  let mult = 1;
  let acc = 0;
  let slowAcc = 0;
  let lastEquipSig = '';
  let gearSig = '';
  let deckSig = '';
  let comparing = false;
  let rolling = false;

  // ---------- helpers ----------
  function setText(node, v) {
    if (node && node._v !== v) { node._v = v; node.textContent = v; }
  }

  // Tap fires on release; holding repeats; moving the finger (scrolling) cancels.
  function holdRepeat(btn, fn) {
    let t1 = 0, t2 = 0, sx = 0, sy = 0, active = false, repeated = false;
    const stop = () => { clearTimeout(t1); clearInterval(t2); active = false; };
    btn.addEventListener('pointerdown', (ev) => {
      Engine.Sfx.unlock();
      stop();
      active = true; repeated = false; sx = ev.clientX; sy = ev.clientY;
      t1 = setTimeout(() => {
        if (!active) return;
        repeated = true;
        if (fn(false) === false) { stop(); return; }
        t2 = setInterval(() => { if (fn(true) === false) stop(); }, 120);
      }, 420);
    });
    btn.addEventListener('pointermove', (ev) => {
      if (active && !repeated && Math.hypot(ev.clientX - sx, ev.clientY - sy) > 12) stop();
    });
    btn.addEventListener('pointerup', () => { if (active && !repeated) fn(false); stop(); });
    btn.addEventListener('pointercancel', stop);
    btn.addEventListener('pointerleave', stop);
    btn.addEventListener('contextmenu', (ev) => ev.preventDefault());
  }

  function tap(node, fn) { node.addEventListener('click', (ev) => { Engine.Sfx.unlock(); fn(ev); }); }

  function timeText(secs) {
    secs = Math.max(0, Math.ceil(secs));
    const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60;
    if (h) return `${h}시 ${m}분`;
    if (m) return `${m}분 ${s}초`;
    return `${s}초`;
  }

  // ---------- toasts ----------
  function toast(text, kind = '') {
    const box = $('#toasts');
    const t = el('div', 'toast ' + kind, text);
    box.prepend(t);
    while (box.children.length > 3) box.lastChild.remove();
    setTimeout(() => t.classList.add('out'), 1700);
    setTimeout(() => t.remove(), 2100);
  }

  // ---------- modal ----------
  function openModal(html, opts = {}) {
    const m = $('#modal');
    m.innerHTML = `<div class="sheet ${opts.cls || ''}">${opts.noClose ? '' : `<button class="xbtn" aria-label="닫기"><img src="${asset('assets/ui/close-button.png')}" alt=""></button>`}${html}</div>`;
    m.hidden = false;
    m.onclick = (ev) => { if (ev.target === m && !opts.locked) closeModal(); };
    const x = $('.xbtn', m);
    if (x) tap(x, () => { sfx('UiClose', 0.5); closeModal(); });
    sfx('UiOpen', 0.4);
    return m.firstChild;
  }
  function closeModal() { const m = $('#modal'); m.hidden = true; m.innerHTML = ''; }

  // ---------- item cards (forge-clone-2 ComparisonItem) ----------
  function trendSvg(up) {
    const tip = up ? 'M13 3 L24 22 L2 22 Z' : 'M13 23 L24 4 L2 4 Z';
    return `<svg class="compare-trend" viewBox="0 0 26 26"><path d="${tip}" fill="${up ? 'rgb(73,196,68)' : 'rgb(235,70,70)'}" stroke="#000" stroke-width="2.5" stroke-linejoin="round"/></svg>`;
  }

  function statText(v) { return v < 1000 ? String(Math.round(v * 100) / 100) : fmtStat(v); }

  function itemCard(item, previous, badge) {
    if (!item) return '<div class="compare-copy"><div class="compare-stat">장착된 장비 없음</div></div>';
    const t = Forge.tier(item);
    const stats = [];
    for (const [stat, label] of [[0, '피해'], [1, '생명력']]) {
      const v = Forge.value(item, stat), pv = previous ? Forge.value(previous, stat) : 0;
      if (!v && !pv) continue;
      const diff = v - pv;
      const trend = (previous || badge) && Math.abs(diff) > 0.01 ? trendSvg(diff > 0) : '';
      stats.push(`<div class="compare-stat"><span>${statText(v)} ${label}</span>${trend}</div>`);
    }
    const options = item.op.map((op) => `<div class="compare-option">${Forge.optionText(op)}</div>`).join('');
    return `<div class="compare-icon-column">
        <div class="ui-slot compare-icon-slot tier-${t}"><img src="${asset(Forge.icon(item))}" alt=""><span class="compare-level">Lv.${item.lv}</span></div>
        ${badge ? `<span class="compare-new-badge">${badge}</span>` : ''}</div>
      <div class="compare-copy ${stats.length > 1 ? 'dual' : ''}">
        <div class="compare-name tier-${t}">${Forge.name(item)}</div>${stats.join('')}${options}</div>`;
  }

  // ---------- build ----------
  function init() {
    buildHud();
    buildSkillBar();
    buildHome();
    buildUpgradePage();
    buildSkillPage();
    buildSummonPage();

    for (const b of $$('#bottom-bar button')) tap(b, () => { sfx('UiTap', 0.5); switchPage(b.dataset.page); });
    switchPage('home');

    tap($('#btnMenu'), openSettings);
    tap($('#btn-profile'), openStats);
    tap($('#btnSpeed'), () => { Game.S.speed = Game.S.speed === 1 ? 2 : 1; sfx('UiTap', 0.5); updateHudButtons(); });
    tap($('#btnSound'), () => { Game.S.sound = !Game.S.sound; Engine.Sfx.on = Game.S.sound; updateHudButtons(); });
    updateHudButtons();
    window.addEventListener('resize', onResize);
    onResize();
  }

  function onResize() {
    Battle.resize();
    const cv = $('#cv').getBoundingClientRect();
    const gp = $('#goldPill img').getBoundingClientRect();
    Battle.B.goldAnchor = Battle.toVirtual(gp.left + gp.width / 2 - cv.left, gp.top + gp.height / 2 - cv.top);
  }

  function updateHudButtons() {
    $('#btnSpeed').textContent = 'x' + Game.S.speed;
    $('#btnSpeed').classList.toggle('on', Game.S.speed > 1);
    $('#btnSound').classList.toggle('off', !Game.S.sound);
  }

  function switchPage(id) {
    page = id;
    for (const b of $$('#bottom-bar button')) b.classList.toggle('on', b.dataset.page === id);
    for (const p of $$('#lower .page')) p.hidden = p.id !== (id === 'home' ? 'home' : 'page-' + id);
    if (id !== 'home') hideComparison();
    refreshPage(true);
  }

  // ---------- battle HUD ----------
  function buildHud() {
    const pips = $('#wavePips');
    for (let i = 0; i < WAVES_PER_STAGE; i++) pips.append(el('i', i === WAVES_PER_STAGE - 1 ? 'boss' : ''));
    tap($('#btnChallenge'), () => Game.challenge());
    tap($('#questBox'), () => {
      if (Game.claimQuest()) { const q = $('#questBox'); q.classList.remove('claim'); void q.offsetWidth; q.classList.add('claim'); }
    });
  }

  function updateHud() {
    const B = Battle.B;
    setText($('#stageName'), F.stageLabel(B.stage) + '  ' + F.theme(B.stage).name + (Game.S.farm ? ' (반복)' : ''));
    $('#btnChallenge').hidden = !Game.S.farm;
    $$('#wavePips i').forEach((p, i) => { p.classList.toggle('done', i < B.wave); p.classList.toggle('cur', i === B.wave); });
    const boss = B.boss, bb = $('#bossBar');
    if (boss && !boss.dead && B.enemies.includes(boss)) {
      bb.hidden = false;
      setText($('.bname', bb), boss.T.name);
      $('.bbar i', bb).style.width = Math.max(0, boss.hp / boss.maxHp * 100) + '%';
      setText($('.bhp', bb), fmt(Math.max(0, boss.hp)));
    } else bb.hidden = true;

    const q = Game.questState();
    setText($('#questText'), q.def.kind.text(q.def.target));
    setText($('#questProg'), `${fmt(q.cur)}/${fmt(q.def.target)}`);
    $('#questBox .qbar i').style.width = Math.min(100, q.cur / q.def.target * 100) + '%';
    $('#questBox').classList.toggle('done', q.done);
    setText($('#questReward'), '' + q.def.reward);
    setText($('#questNo'), '퀘스트 ' + (Game.S.quest.i + 1));

    const alive = Battle.aliveCount();
    setText($('#armyCount'), `${alive}/${SLOTS}`);
    $('#armyBox').classList.toggle('low', alive < SLOTS * 0.5);
    const cd = Game.mods.reinforceCd;
    const full = alive >= SLOTS;
    $('#armyBox .reinforce i').style.width = (full ? 100 : (1 - B.reinforceT / cd) * 100) + '%';
    setText($('#reinforceText'), full ? '' : `보충 ${Math.max(0, B.reinforceT).toFixed(1)}초 · ${Math.round(Game.mods.reinforceCount)}명`);
  }

  // ---------- skill bar (battle overlay) ----------
  function buildSkillBar() {
    const box = $('#skillSlots');
    for (let i = 0; i < 6; i++) {
      const s = el('button', 'sslot', `<img class="sk" alt=""><div class="cdmask"></div><span class="cdt"></span><img class="lock" src="${asset('assets/ui/content-lock.png')}" alt="">`);
      tap(s, () => {
        const id = Game.S.equip[i];
        if (i >= Game.unlockedSlots()) { toast(F.stageLabel(SKILL_SLOT_UNLOCK[i]) + ' 도달 시 열립니다'); return; }
        if (!id) { switchPage('skill'); return; }
        if (!Game.S.auto) { if (Battle.castSkill(id)) sfx('UiTap', 0.4); else sfx('UiDeny', 0.4); }
        else showSkillDetail(id);
      });
      box.append(s);
    }
    tap($('#btnAuto'), () => {
      Game.S.auto = !Game.S.auto;
      sfx('UiTap', 0.6);
      toast(Game.S.auto ? '스킬 자동 사용 <b>ON</b>' : '스킬 자동 사용 <b>OFF</b> · 슬롯을 눌러 직접 사용');
    });
  }

  function updateSkillBar() {
    const S = Game.S;
    const unlocked = Game.unlockedSlots();
    const sig = S.equip.join(',') + '|' + unlocked;
    const slots = $$('#skillSlots .sslot');
    if (sig !== lastEquipSig) {
      lastEquipSig = sig;
      slots.forEach((s, i) => {
        const id = S.equip[i];
        s.classList.toggle('locked', i >= unlocked);
        s.classList.toggle('empty', !id && i < unlocked);
        const img = $('.sk', s);
        if (id) { img.src = asset('assets/skills/' + id + '.png'); img.hidden = false; s.style.setProperty('--gc', GRADES[SKILL_BY_ID[id].grade].color); }
        else { img.hidden = true; s.style.removeProperty('--gc'); }
      });
    }
    slots.forEach((s, i) => {
      const id = S.equip[i];
      if (!id) return;
      const cd = Battle.B.cd[id] || 0;
      const max = SKILL_BY_ID[id].cd;
      $('.cdmask', s).style.setProperty('--p', (Math.max(0, Math.min(1, cd / max)) * 360) + 'deg');
      setText($('.cdt', s), cd > 0.05 ? (cd >= 1 ? '' + Math.ceil(cd) : cd.toFixed(1)) : '');
    });
    const autoBtn = $('#btnAuto');
    if (autoBtn._on !== S.auto) {
      autoBtn._on = S.auto;
      $('img', autoBtn).src = asset(S.auto ? 'assets/ui/skill-auto-on.png' : 'assets/ui/skill-auto-off.png');
      autoBtn.classList.toggle('on', S.auto);
    }
  }

  // ---------- home: forge-clone-2 equipment panel ----------
  const FACES = ['front', 'right', 'top', 'left', 'bottom', 'back']; // sword, helmet, armor, gloves, boot, ring
  const FACE_OF_SLOT = { weapon: 0, helmet: 1, armor: 2, gloves: 3, shoes: 4, ring: 5, necklace: 5, belt: 5 };
  const FACE_ROT = { front: [0, 0], right: [0, -90], top: [-90, 0], left: [0, 90], bottom: [90, 0], back: [0, 180] };
  let dieRot = [0, 0];

  function buildHome() {
    const rows = $$('#equip-grid .equip-row');
    EQ_SLOTS.forEach((slot, i) => {
      const cell = el('div', 'equip-cell');
      const b = el('button', 'slot ui-slot empty', `<img alt=""><span class="lv"></span><span class="empty-label">${EQ_SLOT_NAME[slot]}</span>`);
      b.dataset.slot = slot;
      tap(b, () => showEquipped(slot));
      cell.append(b);
      rows[i < 5 ? 0 : 1].append(cell);
    });
    const mount = el('button', 'mount-slot ui-slot', `<img class="mount-icon" src="${asset('assets/ui/mount-slot.png')}" alt=""><img class="lock" src="${asset('assets/ui/content-lock.png')}" alt="">`);
    tap(mount, () => toast('탈것은 준비 중입니다'));
    rows[1].append(mount);

    const die = $('#die');
    FACES.forEach((f, i) => die.append(el('div', 'face f-' + f, `<img src="${asset('assets/dice/face-' + i + '.png')}" alt="">`)));
    die.classList.add('idle');

    tap($('#btn-roll'), () => {
      if (rolling || comparing) return;
      if (Game.S.autoForge) { toast('자동 굴리기 중입니다'); return; }
      const item = Game.roll();
      if (item) playRoll(item, () => showComparison());
    });
    tap($('#btn-dice-level'), openResearch);
    tap($('#btn-auto-forge'), () => Game.toggleAutoForge());
    tap($('#pending-deck'), () => { if (!rolling) showComparison(); });
    tap($('#btn-rank'), openLevelInfo);
    tap($('#forge-dimmer'), hideComparison);
    tap($('#compare-equip'), () => decide('equip'));
    tap($('#empty-slot-equip'), () => decide('equip'));
    tap($('#compare-sell'), () => decide('sell'));
  }

  function refreshHome() {
    const S = Game.S, A = Game.army;
    setText($('#player-level'), 'Lv.' + S.level);
    const need = F.expNeed(S.level);
    $('#player-exp i').style.width = Math.min(100, S.exp / need * 100) + '%';
    setText($('#player-exp span'), `${fmt(S.exp)} / ${fmt(need)}`);
    setText($('#equip-power'), `공격력 ${fmtStat(A.attack * Game.mods.atk)}  ·  체력 ${fmtStat(A.health * Game.mods.hp)}`);

    const sig = EQ_SLOTS.map((s) => (S.gear[s] ? S.gear[s].id : 0)).join(',');
    if (sig !== gearSig) {
      gearSig = sig;
      for (const b of $$('#equip-grid .slot')) {
        const item = S.gear[b.dataset.slot];
        b.className = 'slot ui-slot' + (item ? ' tier-' + Forge.tier(item) : ' empty');
        if (item) { $('img', b).src = asset(Forge.icon(item)); setText($('.lv', b), 'Lv.' + item.lv); }
      }
    }
    setText($('#dice-value'), fmt(S.dice));
    $('#btn-roll').classList.toggle('dis', S.dice < 1 || S.pending.length >= PENDING_CAP);
    const upgrading = S.diceUpgradeEnds > 0;
    setText($('#dice-level-label'), '레벨 ' + S.diceLevel);
    $('#btn-dice-level').classList.toggle('upgrading', upgrading);
    setText($('#dice-upgrade-time'), upgrading ? timeText((S.diceUpgradeEnds - Date.now()) / 1000) : '');
    const auto = $('#btn-auto-forge');
    auto.classList.toggle('running', !!S.autoForge);
    auto.classList.toggle('locked', !Game.autoForgeUnlocked());
    $('.auto-icon', auto).src = asset(S.autoForge ? 'assets/ui/auto-forge-active.png' : 'assets/ui/auto-forge.png');
    renderDeck();
  }

  // Forged items waiting for a decision, as a fanned stack of tier cards.
  function renderDeck() {
    const S = Game.S, deck = $('#pending-deck');
    const visible = S.pending.length > 0 && !comparing && !rolling;
    deck.hidden = !visible;
    const sig = S.pending.map((i) => i.id).join(',');
    if (!visible || sig === deckSig) return;
    deckSig = sig;
    deck.innerHTML = '';
    const n = S.pending.length, shown = Math.min(16, n);
    for (let i = 0; i < shown - 1; i++) {
      const it = S.pending[n - shown + i];
      const c = el('span', 'pcard ui-slot tier-' + Forge.tier(it));
      c.style.left = (8 + i * 2.7) + '%';
      deck.append(c);
    }
    const top = S.pending[n - 1];
    deck.append(el('span', 'pcard front ui-slot tier-' + Forge.tier(top), `<img src="${asset(Forge.icon(top))}" alt=""><span class="lv">Lv.${top.lv}</span>`));
    deck.append(el('span', 'pcount', '×' + n));
  }

  // Throw the die, land on the face of the forged slot, then reveal the item on its tier plate.
  function playRoll(item, done, quick) {
    rolling = true;
    const stage = $('#die-stage'), die = $('#die'), result = $('#dice-result');
    result.hidden = true; stage.hidden = false;
    die.classList.remove('idle');
    const [fx, fy] = FACE_ROT[FACES[FACE_OF_SLOT[item.slot]]];
    const end = [fx + 720 * (Math.random() < 0.5 ? 1 : -1), fy + 360 * (Math.random() < 0.5 ? 1 : -1)];
    const frame = (t, r) => ({ transform: `translateY(${t}px) rotateX(-24deg) rotateY(32deg) rotateX(${r[0]}deg) rotateY(${r[1]}deg)` });
    const mid = [(dieRot[0] + end[0]) / 2, (dieRot[1] + end[1]) / 2];
    const dur = quick ? 360 : 640;
    const anim = die.animate([frame(0, dieRot), frame(-62, mid), frame(0, end)], { duration: dur, easing: 'cubic-bezier(.3,.7,.4,1)', fill: 'forwards' });
    if (!quick) { sfx('UiTap', 0.35, 1.3); setTimeout(() => sfx('UiTap', 0.3, 1.1), 180); setTimeout(() => sfx('UiTap', 0.3, 0.9), 360); }
    anim.onfinish = () => {
      dieRot = [fx, fy];
      die.style.transform = `rotateX(-24deg) rotateY(32deg) rotateX(${fx}deg) rotateY(${fy}deg)`;
      anim.cancel();
      stage.hidden = true;
      result.className = 'ui-slot tier-' + Forge.tier(item);
      const better = Forge.improves(item, Game.S.gear[item.slot]);
      result.classList.toggle('better', better);
      $('img', result).src = asset(Forge.icon(item));
      $('span', result).textContent = 'Lv.' + item.lv;
      result.hidden = false;
      if (!quick) sfx(better ? 'UiReveal' : 'UiConfirm', better ? 0.55 : 0.35);
      setTimeout(() => { rolling = false; if (done) done(); }, quick ? 260 : 380);
    };
  }

  function resetDie() {
    $('#dice-result').hidden = true;
    $('#die-stage').hidden = false;
    $('#die').classList.add('idle');
    $('#die').style.transform = '';
    dieRot = [0, 0];
  }

  function showComparison() {
    const S = Game.S;
    const incoming = S.pending[S.pending.length - 1];
    if (!incoming || page !== 'home') { hideComparison(); return; }
    comparing = true;
    const current = S.gear[incoming.slot];
    $('#forge-layer').hidden = false;
    $('#forge-empty-slot').hidden = !!current;
    $('#forge-comparison').hidden = !current;
    if (!current) {
      $('#empty-slot-item').innerHTML = itemCard(incoming, null, '새로운!');
    } else {
      $('#compare-current').innerHTML = itemCard(current, incoming);
      $('#compare-incoming').innerHTML = itemCard(incoming, current, '새로운!');
    }
    renderDeck();
  }

  function hideComparison() {
    comparing = false;
    $('#forge-layer').hidden = true;
    deckSig = '';
    renderDeck();
  }

  function decide(kind) {
    const S = Game.S;
    const incoming = S.pending[S.pending.length - 1];
    if (!incoming) { hideComparison(); return; }
    if (kind === 'equip') {
      const sold = Game.equipPending(incoming.id);
      const slotBtn = $(`#equip-grid .slot[data-slot="${incoming.slot}"]`);
      slotBtn.classList.remove('flash'); void slotBtn.offsetWidth; slotBtn.classList.add('flash');
      sfx('UiLevelUp', 0.5);
      if (sold) toast(`${GOLD} +${fmt(sold.gold)} · 이전 장비 판매`);
    } else {
      const r = Game.sellPending(incoming.id);
      sfx('UiCoins', 0.5);
      toast(`${GOLD} +${fmt(r.gold)} · EXP +${SELL_EXP}`);
    }
    resetDie();
    gearSig = '';
    if (S.pending.length) showComparison(); else hideComparison();
    refreshHome();
  }

  // Auto forge: kept upgrades open the comparison; the rest flash and get sold.
  function autoResult(item, kept) {
    playRoll(item, () => {
      if (kept) { showComparison(); return; }
      setTimeout(() => { if (!rolling && !Game.S.pending.length) resetDie(); }, 300);
    }, true);
  }

  function showEquipped(slot) {
    const item = Game.S.gear[slot];
    if (!item) { toast('주사위를 굴려 ' + EQ_SLOT_NAME[slot] + '을(를) 얻으세요'); return; }
    openModal(`<h2 class="mtitle">${EQ_SLOT_NAME[slot]}</h2><div class="comparison-item equipped-card">${itemCard(item, null, '장착됨')}</div>
      <p class="hint">${AGE_NAMES[item.age]} 장비 · 판매가 ${fmt(F.sellGold(item, Battle.B.stage) * Game.mods.gold)} 골드</p>`, { cls: 'small' });
  }

  function openResearch() {
    const S = Game.S;
    const L = S.diceLevel;
    const odds = EQUIP.odds[L - 1], next = EQUIP.odds[Math.min(L, EQUIP.odds.length - 1)];
    const rows = odds.map((p, age) => {
      const np = next[age];
      if (!p && !np) return '';
      const up = L < DICE_LEVEL_MAX && np > p ? ` <span class="up">→ ${(np * 100).toFixed(2).replace(/\.?0+$/, '')}%</span>` : '';
      return `<div class="prob-row tier-${age + 1}"><span>${AGE_NAMES[age]}</span><b>${(p * 100).toFixed(2).replace(/\.?0+$/, '')}%${up}</b></div>`;
    }).join('');
    const upgrading = S.diceUpgradeEnds > 0;
    const maxed = L >= DICE_LEVEL_MAX;
    const cost = F.diceUpgradeCost(L), secs = F.diceUpgradeTime(L);
    const remain = upgrading ? (S.diceUpgradeEnds - Date.now()) / 1000 : 0;
    const sheet = openModal(`<h2 class="mtitle">주사위 레벨 ${L}</h2>
      <p class="hint">주사위 레벨이 오르면 더 높은 시대의 장비가 나옵니다</p>
      <div class="prob">${rows}</div>
      ${maxed ? '<p class="hint">최고 레벨입니다</p>' : upgrading
        ? `<p class="desc center">레벨 ${L + 1}로 업그레이드 중 · 남은 시간 <b id="rsRemain">${timeText(remain)}</b></p>
           <div class="mbtns"><button class="btn ui-button gold" id="rsSkip">${GEM}${F.diceSkipGems(remain)} 즉시 완료</button></div>`
        : `<div class="research-cost"><span>비용 ${GOLD}<b>${fmt(cost)}</b></span><span>소요 시간 <b>${timeText(secs)}</b></span></div>
           <div class="mbtns"><button class="btn ui-button ${S.gold < cost ? 'dis' : ''}" id="rsGo">레벨 ${L + 1} 업그레이드</button></div>`}`, { cls: 'small' });
    const go = $('#rsGo', sheet);
    if (go) tap(go, () => { if (Game.diceUpgrade()) openResearch(); });
    const skip = $('#rsSkip', sheet);
    if (skip) tap(skip, () => { if (Game.diceSkip()) closeModal(); });
  }

  function openLevelInfo() {
    const S = Game.S;
    openModal(`<h2 class="mtitle">Lv.${S.level}</h2>
      <p class="desc center">레벨마다 공격력과 체력이 2%씩 오릅니다<br>현재 보너스 <b>+${Math.round((F.levelBonus(S.level) - 1) * 100)}%</b></p>
      <p class="hint">장비를 판매하면 경험치 ${SELL_EXP}을 얻습니다 · 다음 레벨까지 ${fmt(F.expNeed(S.level) - S.exp)}</p>`, { cls: 'small' });
  }

  function openStats() {
    const A = Game.army, M = Game.mods;
    const o = A.opts;
    const line = (k, v) => `<div class="setrow"><span>${k}</span><b>${v}</b></div>`;
    const optLines = Object.keys(EQUIP.options).filter((k) => o[k] > 0)
      .map((k) => line(EQUIP.options[k][2], '+' + (Math.round(o[k] * 1000) / 10) + '%')).join('');
    openModal(`<h2 class="mtitle">부대 능력치</h2>
      ${line('공격력', fmtStat(A.attack * M.atk))}${line('체력', fmtStat(A.health * M.hp))}
      ${line('창방패병 1명 공격 / 체력', `${fmtStat(A.spear.atk)} / ${fmtStat(A.spear.hp)}`)}
      ${line('궁수 1명 공격 / 체력', `${fmtStat(A.bow.atk)} / ${fmtStat(A.bow.hp)}`)}
      ${line('치명타 확률', fmtPct(A.crit))}${line('치명타 피해', fmtPct(A.critDmg))}
      ${optLines || '<p class="hint">장비 옵션은 중세 시대 장비부터 붙습니다</p>'}`, { cls: 'small' });
  }

  // ---------- upgrade page ----------
  function buildUpgradePage() {
    const t = $('#page-upgrade');
    t.classList.add('scroll');
    t.innerHTML = `<div class="tabhead"><h2>능력치 강화</h2><div class="seg" id="multSeg">
      <button data-m="1" class="on">x1</button><button data-m="10">x10</button><button data-m="max">MAX</button></div></div>
      <div class="list" id="upList"></div>
      <p class="hint">버튼을 길게 누르면 연속 강화됩니다</p>`;
    for (const b of $$('#multSeg button', t)) tap(b, () => {
      mult = b.dataset.m === 'max' ? 'max' : +b.dataset.m;
      $$('#multSeg button', t).forEach((x) => x.classList.toggle('on', x === b));
      sfx('UiTap', 0.4);
      refreshPage(true);
    });
    const list = $('#upList', t);
    for (const u of UPGRADES) {
      const row = el('div', 'row', `
        <div class="ico ${u.tile ? 'tile' : ''}"><img src="${asset(u.icon)}" alt=""></div>
        <div class="info"><div class="nm">${u.name} <span class="lv"></span></div><div class="val"></div></div>
        <button class="buy ui-button"><span class="cost">${GOLD}<span class="cv"></span></span><span class="lbl">강화</span></button>`);
      row.dataset.id = u.id;
      list.append(row);
      holdRepeat($('.buy', row), () => Game.buyUpgrade(u.id, mult));
    }
  }

  function refreshUpgradePage() {
    for (const row of $$('#upList .row')) {
      const u = UPGRADE_BY_ID[row.dataset.id];
      const lv = Game.S.upg[u.id] || 0;
      const { total, count } = Game.upgradeQuote(u, mult);
      const maxed = u.max != null && lv >= u.max;
      setText($('.lv', row), 'Lv.' + lv);
      const cur = u.show(u.val(lv));
      $('.val', row).innerHTML = maxed ? `<b>${cur}</b> <em>MAX</em>` : `${cur} → <b>${u.show(u.val(lv + Math.max(1, count)))}</b>`;
      setText($('.cv', row), maxed ? '-' : fmt(total));
      setText($('.lbl', row), maxed ? '최대' : count > 1 ? `강화 +${count}` : '강화');
      $('.buy', row).classList.toggle('dis', maxed || !count || Game.S.gold < total);
    }
  }

  // ---------- skill page ----------
  function buildSkillPage() {
    const t = $('#page-skill');
    t.classList.add('scroll');
    t.innerHTML = `<div class="tabhead"><h2>스킬 장착</h2><span class="sub">자동 사용 · 쿨타임마다 발동</span></div>
      <div class="equiprow" id="equipRow"></div>
      <div class="tabhead"><h2>보유 스킬</h2><button class="btn small ui-button" id="btnLvAll">일괄 강화</button></div>
      <div class="skillgrid" id="skillGrid"></div>`;
    const row = $('#equipRow', t);
    for (let i = 0; i < 6; i++) {
      const s = el('button', 'eslot', '<img class="sk" alt=""><span class="lk"></span>');
      tap(s, () => { const id = Game.S.equip[i]; if (id) showSkillDetail(id); });
      row.append(s);
    }
    const grid = $('#skillGrid', t);
    for (const sk of SKILLS) {
      const c = el('button', 'scard', `<div class="art"><img src="${asset('assets/skills/' + sk.id + '.png')}" alt=""></div>
        <div class="sname">${sk.name}</div><div class="slv"></div><div class="bar"><i></i><span></span></div><em class="eq">장착</em>`);
      c.dataset.id = sk.id;
      c.style.setProperty('--gc', GRADES[sk.grade].color);
      tap(c, () => showSkillDetail(sk.id));
      grid.append(c);
    }
    tap($('#btnLvAll', t), () => {
      if (Game.levelAllSkills()) { sfx('UiLevelUp', 0.6); toast('스킬 일괄 강화 완료!'); }
      else { sfx('UiDeny', 0.5); toast('강화할 수 있는 스킬이 없습니다'); }
      refreshPage(true);
    });
  }

  function refreshSkillPage() {
    const S = Game.S;
    const unlocked = Game.unlockedSlots();
    $$('#equipRow .eslot').forEach((s, i) => {
      const id = S.equip[i];
      s.classList.toggle('locked', i >= unlocked);
      const img = $('.sk', s);
      if (id) { img.src = asset('assets/skills/' + id + '.png'); img.hidden = false; s.style.setProperty('--gc', GRADES[SKILL_BY_ID[id].grade].color); }
      else { img.hidden = true; s.style.removeProperty('--gc'); }
      $('.lk', s).textContent = i >= unlocked ? F.stageLabel(SKILL_SLOT_UNLOCK[i]) + ' 도달' : '';
    });
    let canLv = false;
    for (const c of $$('#skillGrid .scard')) {
      const id = c.dataset.id, own = S.skills[id];
      c.classList.toggle('owned', !!own);
      c.classList.toggle('equipped', S.equip.includes(id));
      if (own) {
        const need = F.skillNeed(own.lv), maxed = own.lv >= SKILL_MAX_LV;
        $('.slv', c).textContent = 'Lv.' + own.lv;
        $('.bar i', c).style.width = maxed ? '100%' : Math.min(100, own.n / need * 100) + '%';
        $('.bar span', c).textContent = maxed ? 'MAX' : `${own.n}/${need}`;
        const up = !maxed && own.n >= need;
        c.classList.toggle('canup', up);
        if (up) canLv = true;
      } else {
        $('.slv', c).textContent = '미보유';
        $('.bar span', c).textContent = '';
        $('.bar i', c).style.width = '0%';
        c.classList.remove('canup');
      }
    }
    $('#btnLvAll').classList.toggle('dis', !canLv);
  }

  function showSkillDetail(id) {
    const sk = SKILL_BY_ID[id], own = Game.S.skills[id], G = GRADES[sk.grade];
    const lv = own ? own.lv : 1;
    const equipped = Game.S.equip.includes(id);
    const need = F.skillNeed(lv);
    const sheet = openModal(`
      <div class="skd" style="--gc:${G.color}">
        <div class="skart"><img src="${asset('assets/skills/' + id + '.png')}" alt=""></div>
        <div class="skt"><span class="gtag" style="--gc:${G.color}">${G.name}</span><h3>${sk.name}</h3><p>${own ? 'Lv.' + lv : '미보유'} · 쿨타임 ${sk.cd}초</p></div>
      </div>
      <p class="desc">${sk.desc(F.skillValue(sk, lv))}</p>
      ${own && lv < SKILL_MAX_LV ? `<p class="next">다음 레벨: ${sk.desc(F.skillValue(sk, lv + 1))}</p>` : ''}
      <div class="mbtns">
        ${own ? `<button class="btn ui-button ${equipped ? 'sell-button' : ''}" id="mEquip">${equipped ? '해제' : '장착'}</button>
        <button class="btn ui-button gold ${own.n >= need && lv < SKILL_MAX_LV ? '' : 'dis'}" id="mLv">강화 (${own.n}/${need})</button>`
        : '<p class="hint">스킬 소환에서 획득할 수 있습니다</p>'}
      </div>`, { cls: 'small' });
    const eq = $('#mEquip', sheet);
    if (eq) tap(eq, () => {
      if (Game.toggleEquip(id) === 'full') { toast('빈 슬롯이 없습니다. 장착 중인 스킬을 먼저 해제하세요'); sfx('UiDeny', 0.5); return; }
      sfx('UiConfirm', 0.5); closeModal(); refreshPage(true);
    });
    const lvb = $('#mLv', sheet);
    if (lvb) tap(lvb, () => { if (Game.levelSkill(id)) { sfx('UiLevelUp', 0.6); showSkillDetail(id); refreshPage(true); } else sfx('UiDeny', 0.5); });
  }

  // ---------- summon page ----------
  function buildSummonPage() {
    const t = $('#page-summon');
    t.classList.add('scroll');
    t.innerHTML = `
      <div class="bigcard">
        <div class="bc-head"><img src="${asset('assets/ui/forge-crystal.png')}" alt=""><div><h3>스킬 소환</h3>
          <p>장착한 스킬은 전투 중 자동으로 발동합니다</p></div></div>
        <div class="odds">${SKILL_ODDS.map((p, i) => `<span class="chip" style="--gc:${GRADES[i].color}">${GRADES[i].name} ${p}%</span>`).join('')}</div>
        <div class="bc-btns"><button class="btn ui-button" id="kOne">${GEM}<span>${SKILL_COST.one}</span><small>1회 소환</small></button>
          <button class="btn ui-button gold" id="kTen">${GEM}<span>${SKILL_COST.ten}</span><small>10회 소환</small></button></div>
      </div>
      <div class="bigcard">
        <div class="bc-head"><img src="${asset('assets/ui/forge-token.png')}" alt=""><div><h3>주사위</h3>
          <p>오크를 쓰러뜨리면 주사위가 떨어집니다. 장비 화면에서 굴려 새 장비를 얻으세요</p></div></div>
      </div>`;
    tap($('#kOne', t), () => Game.skillSummon(1));
    tap($('#kTen', t), () => Game.skillSummon(10));
  }

  function refreshSummonPage() {
    $('#kOne').classList.toggle('dis', Game.S.gems < SKILL_COST.one);
    $('#kTen').classList.toggle('dis', Game.S.gems < SKILL_COST.ten);
  }

  function refreshPage(force) {
    if (page === 'home') refreshHome();
    else if (page === 'upgrade') refreshUpgradePage();
    else if (page === 'skill') refreshSkillPage();
    else if (page === 'summon') refreshSummonPage();
  }

  // ---------- results / popups ----------
  function showSkillResults(res) {
    const cards = res.map((r, i) => {
      const G = GRADES[r.sk.grade];
      return `<div class="rcard g${r.sk.grade}" style="--gc:${G.color}">
        <div class="inner"><div class="back"><img src="${asset('assets/ui/forge-card-back.png')}" alt=""></div>
        <div class="front">${r.sk.grade >= 4 ? `<img class="flare" src="${asset('assets/ui/rank-flare.png')}" alt="">` : ''}
          <img class="ic" src="${asset('assets/skills/' + r.sk.id + '.png')}" alt=""><b>${r.sk.name}</b><span>${r.isNew ? 'NEW!' : '+1'}</span></div></div></div>`;
    }).join('');
    const again = res.length === 10 ? SKILL_COST.ten : SKILL_COST.one * res.length;
    const sheet = openModal(`<h2 class="mtitle">스킬 소환 결과</h2><div class="rgrid n${res.length}">${cards}</div>
      <div class="mbtns"><button class="btn ui-button" id="mOk">확인</button>
      <button class="btn ui-button gold ${Game.S.gems < again ? 'dis' : ''}" id="mAgain">${GEM}${again} 다시 소환</button></div>`, { cls: 'results', locked: true, noClose: true });
    $$('.rcard', sheet).forEach((c, i) => setTimeout(() => {
      c.classList.add('open');
      const gr = +c.className.match(/g(\d)/)[1];
      sfx(gr >= 3 ? 'UiReveal' : 'UiTap', gr >= 3 ? 0.6 : 0.35, 1 + i * 0.03);
    }, 250 + i * 140));
    tap($('#mOk', sheet), () => { closeModal(); refreshPage(true); });
    tap($('#mAgain', sheet), () => Game.skillSummon(res.length));
  }

  function offlinePopup(secs, gold, dice, claim) {
    const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60);
    const sheet = openModal(`<h2 class="mtitle">방치 보상</h2>
      <div class="chest"></div>
      <p class="desc center">부대가 ${h ? h + '시간 ' : ''}${m}분 동안 오크를 사냥했습니다</p>
      <div class="reward"><span>${GOLD}<b>+${fmt(gold)}</b></span><span>${DICE}<b>+${fmt(dice)}</b></span></div>
      <div class="mbtns"><button class="btn ui-button gold" id="mClaim">받기</button></div>`, { cls: 'small', locked: true, noClose: true });
    tap($('#mClaim', sheet), (ev) => {
      ev.currentTarget.disabled = true;
      claim();
      $('.chest', sheet).classList.add('open');
      sfx('UiChest', 0.6); sfx('UiCoins', 0.7);
      setTimeout(closeModal, 700);
    });
  }

  function openSettings() {
    const S = Game.S;
    const sheet = openModal(`<h2 class="mtitle">설정</h2>
      <div class="setrow"><span>효과음</span><button class="btn small ui-button ${S.sound ? '' : 'sell-button'}" id="mSnd">${S.sound ? '켜짐' : '꺼짐'}</button></div>
      <div class="setrow"><span>전투 속도</span><button class="btn small ui-button" id="mSpd">x${S.speed}</button></div>
      <div class="setrow"><span>최고 스테이지</span><b>${F.stageLabel(S.maxStage)}</b></div>
      <div class="setrow"><span>처치한 오크</span><b>${fmt(S.stats.kills)}</b></div>
      <div class="setrow"><span>굴린 주사위</span><b>${fmt(S.stats.forges)}</b></div>
      <div class="mbtns"><button class="btn small ui-button sell-button" id="mReset">데이터 초기화</button></div>`, { cls: 'small' });
    tap($('#mSnd', sheet), () => { S.sound = !S.sound; Engine.Sfx.on = S.sound; updateHudButtons(); openSettings(); });
    tap($('#mSpd', sheet), () => { S.speed = S.speed === 1 ? 2 : 1; updateHudButtons(); openSettings(); });
    let armed = false;
    tap($('#mReset', sheet), (ev) => {
      if (!armed) { armed = true; ev.currentTarget.textContent = '정말 초기화할까요? 한 번 더 누르세요'; return; }
      Game.reset();
    });
  }

  function pulseGold() { const p = $('#goldPill'); p.classList.remove('pulse'); void p.offsetWidth; p.classList.add('pulse'); }

  // ---------- per frame ----------
  function tick(dt) {
    acc += dt; slowAcc += dt;
    updateSkillBar();
    if (acc >= 0.1) {
      acc = 0;
      const S = Game.S;
      setText($('#gold'), fmt(S.gold));
      setText($('#gems'), fmt(S.gems));
      setText($('#power'), fmt(Game.power()));
      updateHud();
      if (page === 'home') refreshHome();
      $('#bottom-bar button[data-page=skill]').classList.toggle('badge', Object.entries(S.skills).some(([, o]) => o.lv < SKILL_MAX_LV && o.n >= F.skillNeed(o.lv)));
      $('#bottom-bar button[data-page=home]').classList.toggle('badge', page !== 'home' && S.pending.length > 0);
    }
    if (slowAcc >= 0.25) { slowAcc = 0; if (page !== 'home') refreshPage(false); }
  }

  return {
    init, tick, toast, showSkillResults, offlinePopup, pulseGold, refreshPage, openModal, closeModal,
    autoResult, showComparison, get comparing() { return comparing; }, get rolling() { return rolling; }, get page() { return page; },
  };
})();
