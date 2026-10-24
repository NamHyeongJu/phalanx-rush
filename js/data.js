'use strict';
// Game tables: grades, soldier classes, enemies, skills, upgrades, themes, quests.

// Resolves an asset path; the single-file build embeds files in window.ASSET_DATA.
const asset = (p) => (window.ASSET_DATA && window.ASSET_DATA[p]) || p;
const FONT_STACK = '"ONE Mobile POP", "Jua", "Malgun Gothic", "Apple SD Gothic Neo", sans-serif';

const LANES = 6;          // files (rows on screen)
const RANKS = 3;          // ranks (depth of the phalanx): spears up front, archers always in the last rank
const SLOTS = LANES * RANKS;

const GRADES = [
  { name: '일반', color: '#b5bdc6', dark: '#59626c', mult: 1 },
  { name: '고급', color: '#6cd65f', dark: '#2c7a2a', mult: 1.7 },
  { name: '희귀', color: '#4aa8ff', dark: '#1d5aa6', mult: 2.9 },
  { name: '영웅', color: '#c46dff', dark: '#6a2ba3', mult: 5 },
  { name: '전설', color: '#ffc531', dark: '#a86a00', mult: 8.5 },
  { name: '신화', color: '#ff5a55', dark: '#a3181e', mult: 15 },
];

// Every soldier is a Roman legionary; grade shows through the weapon and the aura underfoot.
const SOLDIER_SET = 'roman-legionary-v1';
const GRADE_SETS = GRADES.map(() => [SOLDIER_SET]);

// role 1: spear and shield, fights from the front ranks; role 2: archer, always in the last rank.
const CLASSES = {
  spear: { name: '창방패병', role: 1, weight: 65, shield: true, atk: 18, hp: 160, spd: 1.0, reach: 64, anim: 'thrust', idle: -0.06,
    weapons: ['bronzeSpear', 'bronzeSpear', 'pike', 'pike', 'halberd', 'trident'] },
  bow: { name: '궁수', role: 2, weight: 35, atk: 16, hp: 110, spd: 1.25, range: 300, proj: 'arrow', anim: 'shoot',
    weapons: ['shortBow', 'bronzeBow', 'longBow', 'warBow', 'crossbow', 'heavyCrossbow'] },
};
const CLASS_IDS = Object.keys(CLASSES);
// Saves from the mixed-class version: ranged units become archers, everything else spearmen.
const LEGACY_CLASS = { sword: 'spear', axe: 'spear', mace: 'spear', gun: 'bow', staff: 'bow' };

// Recruit level -> grade odds (percent).
const RECRUIT_ODDS = [
  [80, 18, 2, 0, 0, 0],
  [70, 24, 5, 1, 0, 0],
  [60, 28, 9, 2.6, 0.4, 0],
  [50, 30, 14, 5, 1, 0],
  [40, 32, 18, 7.5, 2.3, 0.2],
  [32, 32, 22, 10, 3.5, 0.5],
  [25, 31, 25, 13, 5.2, 0.8],
  [18, 30, 28, 16, 6.8, 1.2],
  [12, 28, 30, 19, 9, 2],
  [8, 24, 32, 22, 11, 3],
];
const RECRUIT_XP = [8, 18, 35, 60, 95, 140, 200, 280, 380];

const ENEMY_TYPES = {
  grunt: { name: '오크 전사', look: { set: 'orc-monster-v1' }, weapons: ['boneClub', 'stoneAxe', 'spikedClub', 'rustySword'],
    hp: 1, atk: 1, spd: 30, aspd: 1.3, reach: 24, gold: 1 },
  archer: { name: '오크 궁수', look: { set: 'primitive-handmade-01-v1', face: 3 }, weapons: ['shortBow'],
    hp: 0.65, atk: 0.75, spd: 28, aspd: 2.2, range: 150, proj: 'arrow', gold: 1.2 },
  brute: { name: '오크 광전사', look: { set: 'orc-monster-v1', tint: ['#ff3a1e', 'hue', 0.75] }, weapons: ['cleaver', 'bigClub'],
    hp: 1.7, atk: 1.8, spd: 42, aspd: 1.0, reach: 26, gold: 1.6, scale: 1.1 },
  shield: { name: '오크 방패병', look: { set: 'bronze-handmade-02-v1', face: 3, shield: true }, weapons: ['rustySword', 'khopesh'],
    hp: 2.8, atk: 0.7, spd: 22, aspd: 1.4, reach: 24, gold: 1.8 },
  shaman: { name: '오크 주술사', look: { set: 'primitive-handmade-03-v1', face: 3 }, weapons: ['staff'],
    hp: 0.8, atk: 1.2, spd: 24, aspd: 2.8, range: 170, proj: 'orb', splash: 28, gold: 1.8 },
  knight: { name: '오크 기사', look: { set: 'medieval-handmade-01-v1', face: 3, shield: true }, weapons: ['battleAxe', 'scimitar'],
    hp: 3.6, atk: 1.6, spd: 26, aspd: 1.3, reach: 26, gold: 2.5 },
  boss: { name: '오크 족장', look: { set: 'orc-monster-v1', helmet: 'bronze-handmade-02-v1', tint: ['#3a2a55', 'multiply', 0.35] },
    weapons: ['battleAxe'], hp: 18, atk: 3, spd: 20, aspd: 1.7, reach: 34, cleave: true, gold: 14, scale: 1.6, boss: true },
  warlord: { name: '오크 대족장', look: { set: 'orc-monster-v1', helmet: 'medieval-handmade-01-v1', tint: ['#b0180c', 'multiply', 0.32] },
    weapons: ['cleaver'], hp: 45, atk: 4.5, spd: 18, aspd: 1.8, reach: 40, cleave: true, gold: 45, scale: 1.95, boss: true },
};

const WAVES_PER_STAGE = 5; // the last one is the boss wave
const STAGES_PER_CHAPTER = 10;

const THEMES = [
  { name: '고요한 숲', bg: 'assets/bg/forest.jpg', crop: [0, 0.72], horizon: 0.89, ground: ['#e7a865', '#d08f52'], spot: '#c98245', tuft: '#7cb84a' },
  { name: '붉은 협곡', bg: 'assets/bg/canyon.jpg', crop: [0, 0.6], horizon: 0.9, ground: ['#e1aa6c', '#c98d55'], spot: '#c07a45', tuft: '#a4a35a' },
  { name: '고대 평원', bg: 'assets/bg/classical.jpg', crop: [0, 0.62], horizon: 0.92, ground: ['#a8cc62', '#86ad4a'], spot: '#94b955', tuft: '#5d8f35' },
  { name: '중세 왕국', bg: 'assets/bg/medieval.jpg', crop: [0, 0.6], horizon: 0.92, ground: ['#9fcb5e', '#7aa846'], spot: '#8cb850', tuft: '#4f8a30' },
  { name: '푸른 해안', bg: 'assets/bg/coast.jpg', crop: [0, 0.6], horizon: 0.9, ground: ['#ecd6a0', '#d4ba80'], spot: '#d9c08a', tuft: '#9fb55c' },
  { name: '나일 강변', bg: 'assets/bg/nile.jpg', crop: [0, 0.6], horizon: 0.9, ground: ['#ecd197', '#d4b073'], spot: '#d6b47c', tuft: '#9db04f' },
];

const SKILLS = [
  { id: 'fireball', name: '화염구', grade: 0, cd: 5, base: 400, per: 48, desc: (v) => `적 무리에 화염구를 던져 공격력 ${v}%의 범위 피해` },
  { id: 'arrow-rain', name: '화살비', grade: 0, cd: 8, base: 130, per: 16, desc: (v) => `화살 16발을 퍼부어 각각 공격력 ${v}% 피해` },
  { id: 'ice-lance', name: '빙결창', grade: 1, cd: 7, base: 380, per: 45, desc: (v) => `전방을 관통하는 얼음창, ${v}% 피해 + 3초 둔화` },
  { id: 'lightning', name: '낙뢰', grade: 1, cd: 8, base: 320, per: 38, desc: (v) => `적 5명에게 벼락, ${v}% 피해 + 기절` },
  { id: 'poison-bomb', name: '독 폭탄', grade: 2, cd: 10, base: 75, per: 9, desc: (v) => `독구름 5초, 0.5초마다 ${v}% 피해` },
  { id: 'beast-claw', name: '야수의 격노', grade: 2, cd: 15, base: 60, per: 6, buff: true, desc: (v) => `7초간 병사 공격 속도 +${v}%` },
  { id: 'crystal', name: '수정 방벽', grade: 3, cd: 16, base: 30, per: 3, buff: true, desc: (v) => `8초간 모든 병사에게 최대 체력 ${v}% 보호막` },
  { id: 'hellfire', name: '지옥불', grade: 3, cd: 12, base: 120, per: 14, desc: (v) => `지옥불 장판 5초, 0.5초마다 ${v}% 피해` },
  { id: 'fire-wave', name: '화염 파도', grade: 3, cd: 13, base: 650, per: 78, desc: (v) => `전장을 휩쓰는 화염 파도 ${v}% 피해 + 넉백` },
  { id: 'sun-blessing', name: '태양의 축복', grade: 4, cd: 18, base: 40, per: 3, buff: true, desc: (v) => `모든 병사 체력 ${v}% 회복` },
  { id: 'star-nova', name: '별의 폭발', grade: 4, cd: 16, base: 850, per: 100, desc: (v) => `화면의 모든 적에게 ${v}% 피해` },
  { id: 'meteor', name: '운석 낙하', grade: 5, cd: 20, base: 2200, per: 260, desc: (v) => `거대 운석 낙하 ${v}% 피해 + 기절` },
];
const SKILL_BY_ID = Object.fromEntries(SKILLS.map((s) => [s.id, s]));
const SKILL_ODDS = [44, 30, 16, 7, 2.5, 0.5];
const SKILL_SLOT_UNLOCK = [0, 0, 0, 3, 8, 15]; // max stage index required
const SKILL_MAX_LV = 30;
const SKILL_COST = { one: 50, ten: 450 };

const UPGRADES = [
  { id: 'atk', name: '공격력', icon: 'assets/icons/fist.png', tile: true, cost: 25, rate: 1.13,
    val: (l) => Math.pow(1.06, l), show: (v) => '+' + fmtPct(v - 1) },
  { id: 'hp', name: '체력', icon: 'assets/icons/meat.png', tile: true, cost: 25, rate: 1.13,
    val: (l) => Math.pow(1.065, l), show: (v) => '+' + fmtPct(v - 1) },
  { id: 'aspd', name: '공격 속도', icon: 'assets/icons/rage.png', tile: true, cost: 60, rate: 1.22, max: 40,
    val: (l) => 1 + 0.025 * l, show: (v) => '+' + fmtPct(v - 1) },
  { id: 'crit', name: '치명타 확률', icon: 'assets/icons/crown-fist.png', tile: true, cost: 80, rate: 1.2, max: 50,
    val: (l) => 0.05 + 0.006 * l, show: (v) => fmtPct(v) },
  { id: 'critDmg', name: '치명타 피해', icon: 'assets/icons/muscle.png', tile: true, cost: 100, rate: 1.17,
    val: (l) => 1.5 + 0.12 * l, show: (v) => fmtPct(v) },
  { id: 'skill', name: '마력 (스킬 피해)', icon: 'assets/icons/book.png', cost: 150, rate: 1.15,
    val: (l) => 1 + 0.06 * l, show: (v) => '+' + fmtPct(v - 1) },
  { id: 'armor', name: '방패벽', icon: 'assets/weapons/roman-shield.png', cost: 120, rate: 1.18,
    val: (l) => 1 - 1 / (1 + 0.035 * l), show: (v) => '피해 -' + fmtPct(v) },
  { id: 'gold', name: '골드 획득', icon: 'assets/icons/coin.png', cost: 60, rate: 1.17,
    val: (l) => 1 + 0.06 * l, show: (v) => '+' + fmtPct(v - 1) },
  { id: 'march', name: '행군 속도', icon: 'assets/icons/boots.png', cost: 200, rate: 1.3, max: 20,
    val: (l) => 1 + 0.05 * l, show: (v) => '+' + fmtPct(v - 1) },
];
const UPGRADE_BY_ID = Object.fromEntries(UPGRADES.map((u) => [u.id, u]));

// ---------- formulas ----------
const F = {
  enemyHp: (s) => 30 * Math.pow(1.175, s),
  enemyAtk: (s) => 7 * Math.pow(1.165, s),
  goldPerKill: (s) => 3 * Math.pow(1.14, s),
  summonCost: (s) => Math.round(35 * Math.pow(1.14, s)),
  upgradeCost: (u, lv) => Math.round(u.cost * Math.pow(u.rate, lv)),
  stageGems: (s) => 10 + Math.floor(s / 5) * 2,
  chapterOf: (s) => Math.floor(s / STAGES_PER_CHAPTER),
  stageLabel: (s) => `${Math.floor(s / STAGES_PER_CHAPTER) + 1}-${(s % STAGES_PER_CHAPTER) + 1}`,
  theme: (s) => THEMES[Math.floor(s / STAGES_PER_CHAPTER) % THEMES.length],
  skillValue: (sk, lv) => sk.base + sk.per * (lv - 1),
  skillNeed: (lv) => lv + 1,
};

function waveEnemies(s, w) {
  const boss = w === WAVES_PER_STAGE - 1;
  const n = Math.min(6 + Math.floor(s * 0.6) + w, 22);
  const pool = [['grunt', 10]];
  if (s >= 1) pool.push(['archer', 3]);
  if (s >= 3) pool.push(['brute', 3]);
  if (s >= 5) pool.push(['shield', 3]);
  if (s >= 7) pool.push(['shaman', 2]);
  if (s >= 12) pool.push(['knight', 3]);
  const total = pool.reduce((a, p) => a + p[1], 0);
  const list = [];
  const count = boss ? Math.ceil(n * 0.6) : n;
  for (let i = 0; i < count; i++) {
    let r = Math.random() * total;
    for (const [id, wgt] of pool) { r -= wgt; if (r <= 0) { list.push(id); break; } }
  }
  if (boss) list.splice(Math.floor(list.length / 2), 0, (s % STAGES_PER_CHAPTER) === STAGES_PER_CHAPTER - 1 ? 'warlord' : 'boss');
  return list;
}

// Quest chain: kinds cycle, targets grow per tier.
const QUEST_KINDS = [
  { stat: 'kills', text: (n) => `오크 ${n}마리 처치`, target: (t) => 30 + 30 * t },
  { stat: 'summons', text: (n) => `병사 ${n}회 모집`, target: (t) => 8 + 8 * t },
  { stat: 'merges', text: (n) => `병사 합성 ${n}회`, target: (t) => 2 + 3 * t },
  { stat: 'upgrades', text: (n) => `능력치 강화 ${n}회`, target: (t) => 8 + 6 * t },
  { stat: 'stage', text: (n) => `스테이지 ${F.stageLabel(n - 1)} 도달`, target: (t) => 3 + 4 * t },
  { stat: 'skillSummons', text: (n) => `스킬 소환 ${n}회`, target: (t) => 5 + 5 * t },
  { stat: 'bosses', text: (n) => `보스 ${n}마리 처치`, target: (t) => 1 + 2 * t },
];
function questDef(i) {
  const tier = Math.floor(i / QUEST_KINDS.length);
  const kind = QUEST_KINDS[i % QUEST_KINDS.length];
  return { kind, target: kind.target(tier), reward: 30 + 10 * tier };
}

// ---------- formatting ----------
const UNITS = ['', 'K', 'M', 'B', 'T', 'aa', 'ab', 'ac', 'ad', 'ae', 'af'];
function fmt(n) {
  n = Math.floor(n);
  if (n < 10000) return n.toLocaleString('en-US');
  let i = 0;
  let v = n;
  while (v >= 1000 && i < UNITS.length - 1) { v /= 1000; i++; }
  return (v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)) + UNITS[i];
}
function fmtPct(v) {
  const p = v * 100;
  return (p >= 100 ? fmt(p) : p.toFixed(p % 1 ? 1 : 0)) + '%';
}

function pickWeighted(weights) {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < weights.length; i++) { r -= weights[i]; if (r < 0) return i; }
  return weights.length - 1;
}
