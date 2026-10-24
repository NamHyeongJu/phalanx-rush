'use strict';
// Asset loading, modular character rig and sound.

const Engine = (() => {
  // ---------- images ----------
  const images = {};

  // Retries with backoff: a fresh deploy or a flaky mobile link can drop a few requests.
  function loadImage(src) {
    if (images[src]) return images[src].promise;
    const el = new Image();
    const url = asset(src);
    let tries = 0;
    const promise = new Promise((resolve) => {
      el.onload = () => resolve(el);
      el.onerror = () => {
        tries++;
        if (tries > 4 || url.startsWith('data:')) { console.warn('image failed', src); resolve(null); return; }
        setTimeout(() => { el.src = url + (url.includes('?') ? '&' : '?') + 'retry=' + tries; }, 400 * tries * tries);
      };
    });
    el.src = url;
    images[src] = { el, promise };
    return promise;
  }

  // Loads many images a few at a time instead of all at once.
  async function loadAll(list, onEach) {
    let next = 0;
    const worker = async () => {
      while (next < list.length) {
        const src = list[next++];
        await loadImage(src);
        if (onEach) onEach(src);
      }
    };
    await Promise.all(Array.from({ length: 10 }, worker));
  }

  function img(src) {
    const e = images[src];
    return e && e.el.complete && e.el.naturalWidth ? e.el : null;
  }

  // Downscale in halving steps so small sprites stay crisp.
  function scaledCanvas(source, s) {
    let src = source;
    let w = source.naturalWidth || source.width;
    let h = source.naturalHeight || source.height;
    const tw = Math.max(1, Math.round(w * s));
    const th = Math.max(1, Math.round(h * s));
    while (w / 2 > tw && h / 2 > th) {
      const c = document.createElement('canvas');
      c.width = Math.round(w / 2); c.height = Math.round(h / 2);
      const g = c.getContext('2d');
      g.imageSmoothingQuality = 'high';
      g.drawImage(src, 0, 0, c.width, c.height);
      src = c; w = c.width; h = c.height;
    }
    const c = document.createElement('canvas');
    c.width = tw; c.height = th;
    const g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(src, 0, 0, tw, th);
    return c;
  }

  // Recolor without reading pixels (works from file:// too).
  // mode 'wash': flat color over the sprite; 'hue': shift hue keeping shading.
  function recolor(canvas, color, mode, alpha) {
    const c = document.createElement('canvas');
    c.width = canvas.width; c.height = canvas.height;
    const g = c.getContext('2d');
    g.drawImage(canvas, 0, 0);
    g.globalAlpha = alpha == null ? 1 : alpha;
    g.globalCompositeOperation = mode === 'wash' ? 'source-atop' : mode;
    g.fillStyle = color;
    g.fillRect(0, 0, c.width, c.height);
    if (mode !== 'wash') {
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'destination-in';
      g.drawImage(canvas, 0, 0);
    }
    return c;
  }

  // ---------- modular rig ----------
  // Sprite positions from Characters/Battle/ModularBattleRig.prefab (Unity units * 100,
  // y flipped for canvas). Layer order follows the prefab's sorting orders.
  const PS = 0.4; // parts are prescaled once to this fraction of their native size
  const RIG = {
    armL: [30, -101], body: [0, -115], hairBack: [0, -115], face: [0, -115], head: [0, -115],
    helmet: [0, -115], armR: [-40, -102], handL: [61, -61], shield: [61, -61],
    weapon: [-45, -57], handR: [-45, -57],
  };

  const partCache = new Map();
  function part(def, tint) {
    const key = def.f + '|' + (tint ? tint.join(',') : '');
    let p = partCache.get(key);
    if (p) return p;
    const base = img(def.f);
    if (!base) return null;
    // Sizes in the manifest are native; the embedded build ships smaller copies.
    let c = scaledCanvas(base, PS * def.w / base.naturalWidth);
    if (tint) c = recolor(c, tint[0], tint[1], tint[2]);
    const k = c.width / def.w;
    p = { c, px: def.px * k, py: def.py * k, w: c.width, h: c.height };
    partCache.set(key, p);
    return p;
  }

  // Flatten several rig parts into a single canvas.
  function composite(entries) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const e of entries) {
      e.x0 = e.at[0] - e.p.px; e.y0 = e.at[1] - e.p.py;
      minX = Math.min(minX, e.x0); minY = Math.min(minY, e.y0);
      maxX = Math.max(maxX, e.x0 + e.p.w); maxY = Math.max(maxY, e.y0 + e.p.h);
    }
    const c = document.createElement('canvas');
    c.width = Math.ceil(maxX - minX) + 2; c.height = Math.ceil(maxY - minY) + 2;
    const g = c.getContext('2d');
    for (const e of entries) g.drawImage(e.p.c, Math.round(e.x0 - minX + 1), Math.round(e.y0 - minY + 1));
    return { c, x: minX - 1, y: minY - 1 };
  }

  const lookCache = new Map();
  // opts: { set, face, weapon, shield, helmet (set to borrow a helmet from), tint:[color, mode, alpha] }
  function look(opts) {
    const key = [opts.set, opts.face | 0, opts.weapon || '', opts.shield ? 1 : 0, opts.helmet || '', opts.tint ? opts.tint.join(',') : ''].join('|');
    let L = lookCache.get(key);
    if (L) return L;
    const S = MANIFEST.sets[opts.set];
    const tint = opts.tint;
    const foot = (S.body.h - S.body.py) + RIG.body[1]; // native y of the feet
    const at = (name) => [RIG[name][0] * PS, (RIG[name][1] - foot) * PS];
    const P = (def) => part(def, tint);

    const layerA = [];
    const add = (list, name, def) => { if (def) { const p = P(def); if (p) list.push({ p, at: at(name) }); } };
    add(layerA, 'armL', S.armL);
    add(layerA, 'body', S.body);
    add(layerA, 'hairBack', S.hairBack);
    if (S.head) add(layerA, 'head', S.head);
    else add(layerA, 'face', MANIFEST.faces[(opts.face | 0) % MANIFEST.faces.length]);
    add(layerA, 'helmet', opts.helmet ? MANIFEST.sets[opts.helmet].helmet : S.helmet);
    const layerB = [];
    add(layerB, 'handL', S.handL);
    if (opts.shield) add(layerB, 'shield', MANIFEST.weapons.shield);

    const armR = P(S.armR), handR = P(S.handR);
    const shoulder = at('armR'), hand = at('weapon');
    if (!layerA.length) return null; // parts not loaded (yet); callers skip drawing
    L = {
      A: composite(layerA),
      B: layerB.length ? composite(layerB) : null,
      armR: armR && { c: armR.c, x: shoulder[0] - armR.px, y: shoulder[1] - armR.py },
      handR,
      weapon: opts.weapon ? part(MANIFEST.weapons[opts.weapon]) : null,
      shoulder, hand,
      top: (RIG.head[1] - foot) * PS,
      flash: null,
    };
    lookCache.set(key, L);
    return L;
  }

  function flashOf(L) {
    if (!L.flash) {
      L.flash = {
        A: recolor(L.A.c, 'rgba(255,255,255,0.6)', 'wash'),
        B: L.B ? recolor(L.B.c, 'rgba(255,255,255,0.6)', 'wash') : null,
      };
    }
    return L.flash;
  }

  // s: world px per prescaled px. pose (native px / radians): bob, lunge, tilt, arm, wpn, thrust
  function drawLook(g, L, x, y, s, flip, pose, flash) {
    if (!L) return;
    const F = flash ? flashOf(L) : null;
    g.save();
    g.translate(x, y);
    g.scale(flip ? -s : s, s);
    if (pose.tilt) g.rotate(pose.tilt);
    g.translate((pose.lunge || 0) * PS, -(pose.bob || 0) * PS);
    g.drawImage(F ? F.A : L.A.c, L.A.x, L.A.y);
    const sx = L.shoulder[0], sy = L.shoulder[1];
    const arm = pose.arm || 0, thrust = (pose.thrust || 0) * PS;
    if (L.armR) {
      g.save();
      g.translate(sx, sy); g.rotate(arm); g.translate(-sx + thrust, -sy);
      g.drawImage(L.armR.c, L.armR.x, L.armR.y);
      g.restore();
    }
    if (L.B) g.drawImage(F ? F.B : L.B.c, L.B.x, L.B.y);
    g.translate(sx, sy); g.rotate(arm); g.translate(-sx + thrust, -sy);
    g.translate(L.hand[0], L.hand[1]);
    g.rotate(pose.wpn || 0);
    if (L.weapon) g.drawImage(L.weapon.c, -L.weapon.px, -L.weapon.py);
    if (L.handR) g.drawImage(L.handR.c, -L.handR.px, -L.handR.py);
    g.restore();
  }

  // ---------- sound ----------
  const SOUND_NAMES = [
    'CombatSwing1', 'CombatSwing2', 'CombatSwing3', 'CombatHit1', 'CombatHit2', 'CombatHit3', 'CombatHit4',
    'CombatBow1', 'CombatBow2', 'CombatCrossbow1', 'CombatGun1', 'CombatGun2', 'CombatExplosion1', 'CombatFlame1',
    'CombatCoin1', 'CombatGrave1', 'CombatLaser1', 'UiTap', 'UiConfirm', 'UiDeny', 'UiReveal', 'UiReward',
    'UiLevelUp', 'UiCoins', 'UiOpen', 'UiClose', 'UiChest', 'UiPlayerLevelUp',
  ];
  // Embedded data: URIs are decoded directly; fetching them may be blocked by the page's CSP.
  function loadBytes(src) {
    if (src.startsWith('data:')) {
      const bin = atob(src.slice(src.indexOf(',') + 1));
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return Promise.resolve(bytes.buffer);
    }
    return fetch(src).then((r) => r.arrayBuffer());
  }

  const Sfx = {
    on: true, ctx: null, master: null, buf: {}, els: {}, last: {}, active: 0,
    unlock() {
      if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.45;
      this.master.connect(this.ctx.destination);
      for (const n of SOUND_NAMES) {
        const src = asset('assets/audio/' + n + '.wav');
        loadBytes(src)
          .then((ab) => new Promise((res, rej) => this.ctx.decodeAudioData(ab, res, rej)))
          .then((b) => { this.buf[n] = b; })
          .catch(() => { this.els[n] = new Audio(src); }); // file:// has no fetch
      }
    },
    play(n, vol = 1, rate = 1) {
      if (!this.on) return;
      const now = performance.now();
      if (now - (this.last[n] || 0) < 55) return;
      this.last[n] = now;
      if (this.ctx && this.buf[n]) {
        if (this.active > 14) return;
        const s = this.ctx.createBufferSource();
        s.buffer = this.buf[n];
        s.playbackRate.value = rate;
        const gn = this.ctx.createGain();
        gn.gain.value = vol;
        s.connect(gn); gn.connect(this.master);
        this.active++;
        s.onended = () => { this.active--; };
        s.start();
      } else if (this.els[n]) {
        const a = this.els[n].cloneNode();
        a.volume = Math.min(1, vol * 0.45);
        a.play().catch(() => {});
      }
    },
  };

  return { loadImage, loadAll, img, scaledCanvas, recolor, look, drawLook, PS, Sfx };
})();
