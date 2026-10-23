'use strict';
// DOM interface: top bar, battle HUD, action bar, tab panels, popups.

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

  let tab = 'upgrade';
  let mult = 1;
  let acc = 0;
  let slowAcc = 0;
  let lastEquipSig = '';
  let selectedSoldier = null;

  // ---------- helpers ----------
  function setText(node, v) {
    if (node._v !== v) { node._v = v; node.textContent = v; }
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

  function tap(node, fn) {
    node.addEventListener('click', (ev) => { Engine.Sfx.unlock(); fn(ev); });
  }

  function portrait(canvas, s) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = canvas.clientWidth || 56, H = canvas.clientHeight || 56;
    if (canvas.width !== Math.round(W * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
    const g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    if (!s) return;
    const C = CLASSES[s.cls];
    const L = Engine.look({ set: s.set, face: 0, weapon: C.weapons[s.grade], shield: !!C.shield });
    const sc = (H * 0.86) / -L.A.y;
    const pose = C.role === 2 ? { arm: -1.15, wpn: 1.15 } : C.role === 3 ? { arm: -0.55, wpn: -0.75 } : { wpn: C.idle || 0 };
    Engine.drawLook(g, L, W * 0.46, H * 0.95, sc, false, pose);
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

  function summonToast(s) {
    const G = GRADES[s.grade];
    const w = MANIFEST.weapons[s.C.weapons[s.grade]];
    toast(`<img class="tw" src="${asset(w.f)}" alt=""><b style="color:${G.color}">[${G.name}]</b> ${s.C.name} 합류!`, s.grade >= 3 ? 'big g' + s.grade : '');
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

  // ---------- build ----------
  function init() {
    buildActionBar();
    buildUpgradeTab();
    buildArmyTab();
    buildSkillTab();
    buildSummonTab();
    buildHud();

    for (const b of $$('#nav button')) tap(b, () => { sfx('UiTap', 0.5); switchTab(b.dataset.tab); });
    switchTab('upgrade');

    tap($('#btnMenu'), openSettings);
    tap($('#btnSpeed'), () => {
      Game.S.speed = Game.S.speed === 1 ? 2 : 1;
      sfx('UiTap', 0.5);
      updateHudButtons();
    });
    tap($('#btnSound'), () => {
      Game.S.sound = !Game.S.sound;
      Engine.Sfx.on = Game.S.sound;
      updateHudButtons();
    });
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

  function switchTab(id) {
    tab = id;
    for (const b of $$('#nav button')) b.classList.toggle('on', b.dataset.tab === id);
    for (const t of $$('.tab')) t.hidden = t.id !== 'tab-' + id;
    $('#panel').scrollTop = 0;
    refreshTab(true);
  }

  // ---------- HUD ----------
  function buildHud() {
    const pips = $('#wavePips');
    for (let i = 0; i < WAVES_PER_STAGE; i++) pips.append(el('i', i === WAVES_PER_STAGE - 1 ? 'boss' : ''));
    tap($('#btnChallenge'), () => Game.challenge());
    tap($('#questBox'), () => {
      if (Game.claimQuest()) {
        const q = $('#questBox');
        q.classList.remove('claim'); void q.offsetWidth; q.classList.add('claim');
      }
    });
  }

  function updateHud() {
    const B = Battle.B;
    setText($('#stageName'), F.stageLabel(B.stage) + '  ' + F.theme(B.stage).name + (Game.S.farm ? ' (반복)' : ''));
    $('#btnChallenge').hidden = !Game.S.farm;
    $$('#wavePips i').forEach((p, i) => {
      p.classList.toggle('done', i < B.wave);
      p.classList.toggle('cur', i === B.wave);
    });
    const boss = B.boss;
    const bb = $('#bossBar');
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
  }

  // ---------- action bar ----------
  function buildActionBar() {
    const box = $('#skillSlots');
    for (let i = 0; i < 6; i++) {
      const s = el('button', 'sslot', `<img class="sk" alt=""><div class="cdmask"></div><span class="cdt"></span><img class="lock" src="${asset('assets/ui/content-lock.png')}" alt="">`);
      s.dataset.i = i;
      tap(s, () => {
        const id = Game.S.equip[i];
        if (!id) { switchTab('skill'); return; }
        if (!Game.S.auto) {
          if (Battle.castSkill(id)) sfx('UiTap', 0.4); else sfx('UiDeny', 0.4);
        } else showSkillDetail(id);
      });
      box.append(s);
    }
    tap($('#btnAuto'), () => {
      Game.S.auto = !Game.S.auto;
      sfx('UiTap', 0.6);
      toast(Game.S.auto ? '스킬 자동 사용 <b>ON</b>' : '스킬 자동 사용 <b>OFF</b> — 슬롯을 눌러 직접 사용');
    });
    holdRepeat($('#btnSummon'), (repeat) => Game.summonOne(repeat) ? true : false);
  }

  function updateActionBar() {
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
      const p = Math.max(0, Math.min(1, cd / max));
      $('.cdmask', s).style.setProperty('--p', (p * 360) + 'deg');
      setText($('.cdt', s), cd > 0.05 ? (cd >= 1 ? Math.ceil(cd) : cd.toFixed(1)) : '');
      s.classList.toggle('ready', cd <= 0.05);
    });
    const autoBtn = $('#btnAuto');
    if (autoBtn._on !== S.auto) {
      autoBtn._on = S.auto;
      $('img', autoBtn).src = asset(S.auto ? 'assets/ui/skill-auto-on.png' : 'assets/ui/skill-auto-off.png');
      autoBtn.classList.toggle('on', S.auto);
    }

    const empty = SLOTS - Battle.aliveCount();
    const cost = Game.summonCost();
    const btn = $('#btnSummon');
    setText($('#summonCost'), fmt(cost));
    const badge = $('#emptyBadge');
    setText(badge, '' + empty);
    badge.hidden = empty <= 0;
    btn.classList.toggle('ready', empty > 0 && S.gold >= cost);
    btn.classList.toggle('poor', S.gold < cost);
    btn.classList.toggle('full', empty <= 0);
    setText($('#summonLabel'), empty > 0 ? '병사 뽑기' : '부대 만원');
    const hand = $('#tutHand');
    hand.hidden = !(S.tut === 0 && empty > 0 && S.gold >= cost);
  }

  function bumpBadge() {
    const b = $('#emptyBadge');
    b.classList.remove('bump'); void b.offsetWidth; b.classList.add('bump');
  }

  function pulseGold() {
    const p = $('#goldPill');
    p.classList.remove('pulse'); void p.offsetWidth; p.classList.add('pulse');
  }

  // ---------- upgrade tab ----------
  function buildUpgradeTab() {
    const t = $('#tab-upgrade');
    t.innerHTML = `<div class="tabhead"><h2>능력치 강화</h2><div class="seg" id="multSeg">
      <button data-m="1" class="on">x1</button><button data-m="10">x10</button><button data-m="max">MAX</button></div></div>
      <div class="list" id="upList"></div>
      <p class="hint">버튼을 길게 누르면 연속 강화됩니다</p>`;
    for (const b of $$('#multSeg button', t)) tap(b, () => {
      mult = b.dataset.m === 'max' ? 'max' : +b.dataset.m;
      $$('#multSeg button', t).forEach((x) => x.classList.toggle('on', x === b));
      sfx('UiTap', 0.4);
      refreshTab(true);
    });
    const list = $('#upList', t);
    for (const u of UPGRADES) {
      const row = el('div', 'row', `
        <div class="ico ${u.tile ? 'tile' : ''}"><img src="${asset(u.icon)}" alt=""></div>
        <div class="info"><div class="nm">${u.name} <span class="lv"></span></div><div class="val"></div></div>
        <button class="buy"><span class="cost">${GOLD}<span class="cv"></span></span><span class="lbl">강화</span></button>`);
      row.dataset.id = u.id;
      list.append(row);
      holdRepeat($('.buy', row), () => Game.buyUpgrade(u.id, mult));
    }
  }

  function refreshUpgradeTab() {
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

  // ---------- army tab ----------
  function buildArmyTab() {
    const t = $('#tab-army');
    t.innerHTML = `<div class="tabhead"><h2>방진 편성</h2><div class="armystat"><img src="${asset('assets/ui/combat-power-small.png')}" alt=""><b id="armyPower">0</b></div></div>
      <div class="gradebar" id="gradeBar"></div>
      <div class="formation-wrap"><div class="flabel"><span>◀ 후열</span><span>전열 ▶</span></div><div class="formation" id="formation"></div></div>
      <div class="sinfo" id="soldierInfo"><p class="hint">병사를 눌러 정보를 확인하세요</p></div>
      <div class="armybtns"><button class="btn purple" id="btnMerge"><img class="ci" src="${asset('assets/vfx/sparkle.png')}" alt=""><span>합성</span></button>
        <button class="btn gold" id="btnFill">${GOLD}<span>빈자리 모두 보충</span></button></div>
      <p class="hint">같은 등급 병사 3명을 합성하면 한 단계 높은 등급 병사 1명이 됩니다. 남는 자리는 뽑기로 채우세요!</p>`;
    const grid = $('#formation', t);
    for (let l = 0; l < LANES; l++) {
      for (let c = 0; c < RANKS; c++) {
        const cell = el('button', 'cell', '<canvas></canvas><i class="hp"><b></b></i>');
        cell.dataset.lane = l;
        cell.dataset.rank = RANKS - 1 - c;
        tap(cell, () => {
          const s = Battle.B.lanes[l][RANKS - 1 - c];
          selectedSoldier = s || null;
          sfx('UiTap', 0.4);
          refreshArmyTab(true);
        });
        grid.append(cell);
      }
    }
    tap($('#btnFill', t), () => Game.summonFill());
    tap($('#btnMerge', t), () => { Game.merge(); refreshArmyTab(true); });
  }

  function refreshArmyTab(force) {
    const B = Battle.B;
    let total = 0;
    const counts = GRADES.map(() => 0);
    for (const cell of $$('#formation .cell')) {
      const s = B.lanes[+cell.dataset.lane][+cell.dataset.rank];
      const sid = s ? s.id : 0;
      if (s) counts[s.grade]++;
      if (force || cell._sid !== sid) {
        cell._sid = sid;
        cell.className = 'cell' + (s ? ' g' + s.grade : ' empty');
        portrait($('canvas', cell), s);
      }
      if (s) $('.hp b', cell).style.width = Math.max(0, s.hp / s.maxHp * 100) + '%';
      cell.classList.toggle('sel', !!s && s === selectedSoldier);
    }
    for (const n of counts) total += n;
    $('#gradeBar').innerHTML = `<span class="tot">병력 <b>${total}</b>/${SLOTS}</span>` +
      counts.map((n, i) => n ? `<span class="chip" style="--gc:${GRADES[i].color}">${GRADES[i].name} ${n}</span>` : '').join('');
    setText($('#armyPower'), fmt(Game.power()));
    const info = $('#soldierInfo');
    const s = selectedSoldier;
    if (s && (s.dead || !Battle.soldiers().includes(s))) selectedSoldier = null;
    if (selectedSoldier) {
      const G = GRADES[s.grade];
      const atk = s.C.atk * G.mult * Game.mods.atk;
      const roleText = ['전열 근접', '2열까지 공격', '원거리', '원거리 범위'][s.C.role];
      if (info._sid !== s.id || force) {
        info._sid = s.id;
        info.innerHTML = `<canvas class="big"></canvas><div class="sd">
          <div class="sn"><span class="gtag" style="--gc:${G.color}">${G.name}</span> ${s.C.name}</div>
          <div class="ss">공격력 <b class="sa"></b> · 체력 <b class="sh"></b></div>
          <div class="ss">공격 간격 ${s.C.spd.toFixed(2)}초 · ${roleText}${s.C.splash ? ' · 범위' : ''}${s.C.stun ? ' · 기절' : ''}</div></div>`;
        portrait($('canvas', info), s);
      }
      setText($('.sa', info), fmt(atk));
      setText($('.sh', info), `${fmt(Math.max(0, s.hp))}/${fmt(s.maxHp)}`);
    } else if (info._sid !== 0) {
      info._sid = 0;
      info.innerHTML = '<p class="hint">병사를 눌러 정보를 확인하세요 · 근접병은 앞열, 원거리병은 뒷열에 자동 배치됩니다</p>';
    }
    const cost = Game.summonCost();
    const empty = SLOTS - Battle.aliveCount();
    const n = Math.min(empty, Math.floor(Game.S.gold / cost));
    $('#btnFill span').textContent = empty ? `빈자리 ${empty}칸 보충 (${n}명)` : '부대 만원';
    $('#btnFill').classList.toggle('dis', !n);
    const m = Battle.mergeCount();
    $('#btnMerge span').textContent = m ? `합성 ${m}회 가능` : '합성';
    $('#btnMerge').classList.toggle('dis', !m);
  }

  // ---------- skill tab ----------
  function buildSkillTab() {
    const t = $('#tab-skill');
    t.innerHTML = `<div class="tabhead"><h2>스킬 장착</h2><span class="sub">자동 사용 · 쿨타임마다 발동</span></div>
      <div class="equiprow" id="equipRow"></div>
      <div class="tabhead"><h2>보유 스킬</h2><button class="btn green small" id="btnLvAll">일괄 강화</button></div>
      <div class="skillgrid" id="skillGrid"></div>`;
    const row = $('#equipRow', t);
    for (let i = 0; i < 6; i++) {
      const s = el('button', 'eslot', '<img class="sk" alt=""><span class="lk"></span>');
      tap(s, () => {
        const id = Game.S.equip[i];
        if (id) showSkillDetail(id);
      });
      row.append(s);
    }
    const grid = $('#skillGrid', t);
    for (const sk of SKILLS) {
      const c = el('button', 'scard', `<div class="art"><img src="${asset('assets/skills/' + sk.id + '.png')}" alt=""></div>
        <div class="sname">${sk.name}</div><div class="slv"></div><div class="sbar"><i></i><span></span></div><em class="eq">장착</em>`);
      c.dataset.id = sk.id;
      c.style.setProperty('--gc', GRADES[sk.grade].color);
      tap(c, () => showSkillDetail(sk.id));
      grid.append(c);
    }
    tap($('#btnLvAll', t), () => {
      if (Game.levelAllSkills()) { sfx('UiLevelUp', 0.6); toast('스킬 일괄 강화 완료!'); }
      else { sfx('UiDeny', 0.5); toast('강화할 수 있는 스킬이 없습니다'); }
      refreshTab(true);
    });
  }

  function refreshSkillTab() {
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
      const id = c.dataset.id;
      const own = S.skills[id];
      c.classList.toggle('owned', !!own);
      c.classList.toggle('equipped', S.equip.includes(id));
      if (own) {
        const need = F.skillNeed(own.lv);
        const maxed = own.lv >= SKILL_MAX_LV;
        $('.slv', c).textContent = 'Lv.' + own.lv;
        $('.sbar i', c).style.width = maxed ? '100%' : Math.min(100, own.n / need * 100) + '%';
        $('.sbar span', c).textContent = maxed ? 'MAX' : `${own.n}/${need}`;
        const up = !maxed && own.n >= need;
        c.classList.toggle('canup', up);
        if (up) canLv = true;
      } else {
        $('.slv', c).textContent = '미보유';
        $('.sbar span', c).textContent = '';
        $('.sbar i', c).style.width = '0%';
        c.classList.remove('canup');
      }
    }
    $('#btnLvAll').classList.toggle('dis', !canLv);
  }

  function showSkillDetail(id) {
    const sk = SKILL_BY_ID[id];
    const own = Game.S.skills[id];
    const G = GRADES[sk.grade];
    const lv = own ? own.lv : 1;
    const v = F.skillValue(sk, lv);
    const nv = F.skillValue(sk, lv + 1);
    const equipped = Game.S.equip.includes(id);
    const need = F.skillNeed(lv);
    const sheet = openModal(`
      <div class="skd" style="--gc:${G.color}">
        <div class="skart"><img src="${asset('assets/skills/' + id + '.png')}" alt=""></div>
        <div class="skt"><span class="gtag" style="--gc:${G.color}">${G.name}</span><h3>${sk.name}</h3><p>${own ? 'Lv.' + lv : '미보유'} · 쿨타임 ${sk.cd}초</p></div>
      </div>
      <p class="desc">${sk.desc(v)}</p>
      ${own && lv < SKILL_MAX_LV ? `<p class="next">다음 레벨: ${sk.desc(nv)}</p>` : ''}
      <div class="mbtns">
        ${own ? `<button class="btn ${equipped ? 'gray' : 'green'}" id="mEquip">${equipped ? '해제' : '장착'}</button>
        <button class="btn gold ${own.n >= need && lv < SKILL_MAX_LV ? '' : 'dis'}" id="mLv">강화 (${own.n}/${need})</button>`
        : '<p class="hint">스킬 소환에서 획득할 수 있습니다</p>'}
      </div>`, { cls: 'small' });
    const eq = $('#mEquip', sheet);
    if (eq) tap(eq, () => {
      const r = Game.toggleEquip(id);
      if (r === 'full') { toast('빈 슬롯이 없습니다. 장착 중인 스킬을 먼저 해제하세요'); sfx('UiDeny', 0.5); return; }
      sfx('UiConfirm', 0.5);
      closeModal(); refreshTab(true);
    });
    const lvb = $('#mLv', sheet);
    if (lvb) tap(lvb, () => {
      if (Game.levelSkill(id)) { sfx('UiLevelUp', 0.6); showSkillDetail(id); refreshTab(true); }
      else sfx('UiDeny', 0.5);
    });
  }

  // ---------- summon tab ----------
  function buildSummonTab() {
    const t = $('#tab-summon');
    t.innerHTML = `
      <div class="bigcard recruit">
        <div class="bc-head"><img src="${asset('assets/ui/mercenary-contract.png')}" alt=""><div><h3>병사 모집</h3>
          <p>모집 <b id="rLv">Lv.1</b> · 모집할수록 고급 병사 확률 증가</p><div class="xpbar"><i id="rXp"></i><span id="rXpT"></span></div></div></div>
        <div class="odds" id="rOdds"></div>
        <div class="bc-btns"><button class="btn gold" id="sOne">${GOLD}<span id="sOneC"></span><small>1회 모집</small></button>
          <button class="btn orange" id="sFill">${GOLD}<span id="sFillC"></span><small id="sFillL">빈자리 보충</small></button></div>
      </div>
      <div class="bigcard skills">
        <div class="bc-head"><img src="${asset('assets/ui/forge-crystal.png')}" alt=""><div><h3>스킬 소환</h3>
          <p>장착한 스킬은 전투 중 자동으로 발동합니다</p></div></div>
        <div class="odds" id="kOdds"></div>
        <div class="bc-btns"><button class="btn purple" id="kOne">${GEM}<span>${SKILL_COST.one}</span><small>1회 소환</small></button>
          <button class="btn purple strong" id="kTen">${GEM}<span>${SKILL_COST.ten}</span><small>10회 소환</small></button></div>
      </div>
      <div class="bigcard classes"><h3>병종 안내</h3><div class="classlist">${CLASS_IDS.map((c) => {
        const C = CLASSES[c];
        return `<div class="cl"><img src="${asset(MANIFEST.weapons[C.weapons[2]].f)}" alt=""><b>${C.name}</b><span>${['전열 근접', '2열 공격', '원거리', '범위 마법'][C.role]}</span></div>`;
      }).join('')}</div></div>`;
    holdRepeat($('#sOne', t), (repeat) => Game.summonOne(repeat) ? true : false);
    tap($('#sFill', t), () => Game.summonFill());
    tap($('#kOne', t), () => Game.skillSummon(1));
    tap($('#kTen', t), () => Game.skillSummon(10));
    $('#kOdds', t).innerHTML = SKILL_ODDS.map((p, i) => `<span class="chip" style="--gc:${GRADES[i].color}">${GRADES[i].name} ${p}%</span>`).join('');
  }

  function refreshSummonTab() {
    const R = Game.S.recruit;
    const lv = R.lv;
    const need = RECRUIT_XP[lv];
    setText($('#rLv'), 'Lv.' + (lv + 1));
    $('#rXp').style.width = need ? Math.min(100, R.xp / need * 100) + '%' : '100%';
    setText($('#rXpT'), need ? `${R.xp}/${need}` : 'MAX');
    const odds = RECRUIT_ODDS[Math.min(lv, RECRUIT_ODDS.length - 1)];
    const sig = 'o' + lv;
    const ro = $('#rOdds');
    if (ro._sig !== sig) {
      ro._sig = sig;
      ro.innerHTML = odds.map((p, i) => p ? `<span class="chip" style="--gc:${GRADES[i].color}">${GRADES[i].name} ${p}%</span>` : '').join('');
    }
    const cost = Game.summonCost();
    const empty = SLOTS - Battle.aliveCount();
    const n = Math.min(empty, Math.floor(Game.S.gold / cost));
    setText($('#sOneC'), fmt(cost));
    setText($('#sFillC'), fmt(cost * Math.max(1, n)));
    setText($('#sFillL'), `빈자리 보충 (${n}명)`);
    $('#sOne').classList.toggle('dis', !empty || Game.S.gold < cost);
    $('#sFill').classList.toggle('dis', !n);
    $('#kOne').classList.toggle('dis', Game.S.gems < SKILL_COST.one);
    $('#kTen').classList.toggle('dis', Game.S.gems < SKILL_COST.ten);
  }

  function refreshTab(force) {
    if (tab === 'upgrade') refreshUpgradeTab();
    else if (tab === 'army') refreshArmyTab(force);
    else if (tab === 'skill') refreshSkillTab();
    else if (tab === 'summon') refreshSummonTab();
  }

  // ---------- results ----------
  function showSkillResults(res) {
    const cards = res.map((r, i) => {
      const G = GRADES[r.sk.grade];
      return `<div class="rcard g${r.sk.grade}" style="--gc:${G.color};--d:${i * 0.12}s">
        <div class="inner"><div class="back"><img src="${asset('assets/ui/forge-card-back.png')}" alt=""></div>
        <div class="front">${r.sk.grade >= 4 ? `<img class="flare" src="${asset('assets/ui/rank-flare.png')}" alt="">` : ''}
          <img class="ic" src="${asset('assets/skills/' + r.sk.id + '.png')}" alt=""><b>${r.sk.name}</b><span>${r.isNew ? 'NEW!' : '+1'}</span></div></div></div>`;
    }).join('');
    const again = res.length === 10 ? SKILL_COST.ten : SKILL_COST.one * res.length;
    const sheet = openModal(`<h2 class="mtitle">스킬 소환 결과</h2><div class="rgrid n${res.length}">${cards}</div>
      <div class="mbtns"><button class="btn green" id="mOk">확인</button>
      <button class="btn purple ${Game.S.gems < again ? 'dis' : ''}" id="mAgain">${GEM}${again} 다시 소환</button></div>`, { cls: 'results', locked: true, noClose: true });
    const cardsEl = $$('.rcard', sheet);
    cardsEl.forEach((c, i) => setTimeout(() => {
      c.classList.add('open');
      const gr = +c.className.match(/g(\d)/)[1];
      sfx(gr >= 3 ? 'UiReveal' : 'UiTap', gr >= 3 ? 0.6 : 0.35, 1 + i * 0.03);
    }, 250 + i * 140));
    tap($('#mOk', sheet), () => { closeModal(); refreshTab(true); });
    tap($('#mAgain', sheet), () => { Game.skillSummon(res.length); });
  }

  function showFillResults(list) {
    if (!list.length) return;
    const counts = GRADES.map(() => 0);
    for (const s of list) counts[s.grade]++;
    const parts = counts.map((n, i) => n ? `<b style="color:${GRADES[i].color}">${GRADES[i].name} ${n}</b>` : '').filter(Boolean).join(' · ');
    toast(`병사 ${list.length}명 합류! ${parts}`, list.some((s) => s.grade >= 3) ? 'big g' + Math.max(...list.map((s) => s.grade)) : '');
  }

  function offlinePopup(secs, gold, claim) {
    const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60);
    const sheet = openModal(`<h2 class="mtitle">방치 보상</h2>
      <div class="chest"></div>
      <p class="desc center">부대가 ${h ? h + '시간 ' : ''}${m}분 동안 오크를 사냥했습니다</p>
      <div class="reward">${GOLD}<b>+${fmt(gold)}</b></div>
      <div class="mbtns"><button class="btn gold" id="mClaim">받기</button></div>`, { cls: 'small', locked: true, noClose: true });
    tap($('#mClaim', sheet), (ev) => {
      ev.currentTarget.disabled = true;
      claim();
      $('.chest', sheet).classList.add('open');
      sfx('UiChest', 0.6);
      sfx('UiCoins', 0.7);
      setTimeout(closeModal, 700);
    });
  }

  function openSettings() {
    const sheet = openModal(`<h2 class="mtitle">설정</h2>
      <div class="setrow"><span>효과음</span><button class="btn small ${Game.S.sound ? 'green' : 'gray'}" id="mSnd">${Game.S.sound ? '켜짐' : '꺼짐'}</button></div>
      <div class="setrow"><span>전투 속도</span><button class="btn small ${Game.S.speed > 1 ? 'green' : 'gray'}" id="mSpd">x${Game.S.speed}</button></div>
      <div class="setrow"><span>최고 스테이지</span><b>${F.stageLabel(Game.S.maxStage)}</b></div>
      <div class="setrow"><span>처치한 오크</span><b>${fmt(Game.S.stats.kills)}</b></div>
      <div class="setrow"><span>모집한 병사</span><b>${fmt(Game.S.stats.summons)}</b></div>
      <div class="mbtns"><button class="btn red small" id="mReset">데이터 초기화</button></div>`, { cls: 'small' });
    tap($('#mSnd', sheet), () => { Game.S.sound = !Game.S.sound; Engine.Sfx.on = Game.S.sound; updateHudButtons(); openSettings(); });
    tap($('#mSpd', sheet), () => { Game.S.speed = Game.S.speed === 1 ? 2 : 1; updateHudButtons(); openSettings(); });
    let armed = false;
    tap($('#mReset', sheet), (ev) => {
      if (!armed) { armed = true; ev.currentTarget.textContent = '정말 초기화할까요? 한 번 더 누르세요'; return; }
      Game.reset();
    });
  }

  // ---------- per-frame ----------
  function tick(dt) {
    acc += dt;
    slowAcc += dt;
    updateActionBar();
    if (acc >= 0.1) {
      acc = 0;
      const S = Game.S;
      setText($('#gold'), fmt(S.gold));
      setText($('#gems'), fmt(S.gems));
      setText($('#power'), fmt(Game.power()));
      updateHud();
      $('#nav button[data-tab=army]').classList.toggle('badge', Battle.mergeCount() > 0);
      $('#nav button[data-tab=skill]').classList.toggle('badge', Object.entries(S.skills).some(([, o]) => o.lv < SKILL_MAX_LV && o.n >= F.skillNeed(o.lv)));
    }
    if (slowAcc >= 0.25) {
      slowAcc = 0;
      refreshTab(false);
    }
  }

  return {
    init, tick, toast, summonToast, showSkillResults, showFillResults, offlinePopup, bumpBadge, pulseGold,
    refreshTab, openModal, closeModal,
  };
})();
