'use strict';
// Game tables: formation, equipment presentation, enemies, skills, upgrades, themes, quests.

// Resolves an asset path; the single-file build embeds files in window.ASSET_DATA.
const asset = (p) => (window.ASSET_DATA && window.ASSET_DATA[p]) || p;
const FONT_STACK = '"ONE Mobile POP", "Jua", "Malgun Gothic", "Apple SD Gothic Neo", sans-serif';

const LANES = 6;          // files (rows on screen)
const RANKS = 3;          // ranks: two ranks of spears in front, archers always in the last rank
const SLOTS = LANES * RANKS;
const SPEAR_RANKS = 2;

// Skill rarities (skills keep their own gacha grades).
const GRADES = [
  { name: '일반', color: '#b5bdc6', mult: 1 },
  { name: '고급', color: '#6cd65f', mult: 1.7 },
  { name: '희귀', color: '#4aa8ff', mult: 2.9 },
  { name: '영웅', color: '#c46dff', mult: 5 },
  { name: '전설', color: '#ffc531', mult: 8.5 },
  { name: '신화', color: '#ff5a55', mult: 15 },
];

// Every soldier wears the equipped outfit. Stats are the army's equipment totals scaled per class.
// role 1: spear and shield, front ranks; role 2: archer, last rank.
const CLASSES = {
  spear: { name: '창방패병', role: 1, shield: true, atkF: 1 / 25, hpF: 1 / 26, spd: 1.0, reach: 48, anim: 'thrust', idle: -0.06 },
  bow: { name: '궁수', role: 2, atkF: 0.9 / 25, hpF: 0.7 / 26, spd: 1.25, range: 300, proj: 'arrow', anim: 'shoot' },
};
const CLASS_IDS = Object.keys(CLASSES);
const rankClass = (rank) => (rank < SPEAR_RANKS ? 'spear' : 'bow');

// ---------- equipment (forge-clone-2 rules, data in js/equipment.js) ----------
const EQ_SLOTS = ['helmet', 'armor', 'gloves', 'necklace', 'ring', 'weapon', 'shoes', 'belt'];
const EQ_SLOT_NAME = { helmet: '투구', armor: '갑옷', gloves: '장갑', necklace: '목걸이', ring: '반지', weapon: '무기', shoes: '신발', belt: '벨트' };
const EQ_ITEM_TYPE = { helmet: 'Helmet', armor: 'Armour', gloves: 'Gloves', necklace: 'Necklace', ring: 'Ring', weapon: 'Weapon', shoes: 'Shoes', belt: 'Belt' };
const AGE_NAMES = ['원시 시대', '청동기 시대', '고대 제국 시대', '중세 시대', '대항해 시대', '산업 시대', '세계대전 시대', '정보화 시대', '우주 시대', '양자 시대'];
const AGE_SHORT = ['원시', '청동기', '고대 제국', '중세', '대항해', '산업', '세계대전', '정보화', '우주', '양자'];
// Tier = age + 1; colors from forge-clone-2 _tokens.uss (--tier-1..10).
const TIER_COLORS = ['#b4ae9c', '#72baff', '#7bcb78', '#f4c34a', '#ff9087', '#d398f3', '#43dddd', '#ea90d8', '#88b5ff', '#b0a7ff'];
const TIER_GRADIENTS = { 8: ['#EA90D8', '#FFB5CB'], 9: ['#88B5FF', '#8CE4EE'], 10: ['#B0A7FF', '#FF93F8'] };
const OPTION_COUNT = [0, 0, 0, 1, 1, 1, 1, 2, 2, 2]; // per age
const ITEM_MAX_LEVEL = 98;
const STAT_SCALE = 15;            // CombatStatScalePermille 1500 x CombatStatUnitMultiplier 10
const LEVEL_SCALING = 1.01;       // LevelScalingBase
const BASE_ATTACK = 10 * STAT_SCALE, BASE_HEALTH = 80 * STAT_SCALE;
const PENDING_CAP = 20;
const DICE_LEVEL_MAX = 35;
const SELL_EXP = 20;

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
    val: (l) => Math.pow(1.05, l), show: (v) => '+' + fmtPct(v - 1) },
  { id: 'hp', name: '체력', icon: 'assets/icons/meat.png', tile: true, cost: 25, rate: 1.13,
    val: (l) => Math.pow(1.05, l), show: (v) => '+' + fmtPct(v - 1) },
  { id: 'reinforceCd', name: '병력 보충 쿨타임', icon: 'assets/icons/banner.png', cost: 80, rate: 1.3, max: 40,
    val: (l) => Math.max(1, 8 * Math.pow(0.95, l)), show: (v) => v.toFixed(1) + '초마다' },
  { id: 'reinforceCount', name: '한 번에 보충하는 병력', icon: 'assets/weapons/roman-shield.png', cost: 300, rate: 2.0, max: SLOTS - 1,
    val: (l) => 1 + l, show: (v) => v + '명' },
  { id: 'aspd', name: '공격 속도', icon: 'assets/icons/rage.png', tile: true, cost: 60, rate: 1.22, max: 40,
    val: (l) => 1 + 0.025 * l, show: (v) => '+' + fmtPct(v - 1) },
  { id: 'crit', name: '치명타 확률', icon: 'assets/icons/crown-fist.png', tile: true, cost: 80, rate: 1.2, max: 50,
    val: (l) => 0.05 + 0.006 * l, show: (v) => fmtPct(v) },
  { id: 'critDmg', name: '치명타 피해', icon: 'assets/icons/muscle.png', tile: true, cost: 100, rate: 1.17,
    val: (l) => 1.5 + 0.12 * l, show: (v) => fmtPct(v) },
  { id: 'skill', name: '마력 (스킬 피해)', icon: 'assets/icons/book.png', cost: 150, rate: 1.15,
    val: (l) => 1 + 0.06 * l, show: (v) => '+' + fmtPct(v - 1) },
  { id: 'armor', name: '방패벽', icon: 'assets/icons/anvil.png', cost: 120, rate: 1.18, max: 28,
    val: (l) => 1 - 1 / (1 + 0.035 * l), show: (v) => '피해 -' + fmtPct(v) },
  { id: 'gold', name: '골드 획득', icon: 'assets/icons/coin.png', cost: 60, rate: 1.17,
    val: (l) => 1 + 0.06 * l, show: (v) => '+' + fmtPct(v - 1) },
  { id: 'march', name: '행군 속도', icon: 'assets/icons/boots.png', cost: 200, rate: 1.3, max: 20,
    val: (l) => 1 + 0.05 * l, show: (v) => '+' + fmtPct(v - 1) },
];
const UPGRADE_BY_ID = Object.fromEntries(UPGRADES.map((u) => [u.id, u]));

// ---------- formulas ----------
const F = {
  enemyHp: (s) => 30 * Math.pow(1.19, s),
  enemyAtk: (s) => 14 * Math.pow(1.19, s),
  goldPerKill: (s) => 3 * Math.pow(1.14, s),
  upgradeCost: (u, lv) => Math.round(u.cost * Math.pow(u.rate, lv)),
  stageGems: (s) => 10 + Math.floor(s / 5) * 2,
  stageLabel: (s) => `${Math.floor(s / STAGES_PER_CHAPTER) + 1}-${(s % STAGES_PER_CHAPTER) + 1}`,
  theme: (s) => THEMES[Math.floor(s / STAGES_PER_CHAPTER) % THEMES.length],
  skillValue: (sk, lv) => sk.base + sk.per * (lv - 1),
  skillNeed: (lv) => lv + 1,
  // Dice level L -> L+1: gold and seconds (forge-clone-2's research, compressed for a web session).
  diceUpgradeCost: (L) => Math.round(300 * Math.pow(1.55, L - 1)),
  diceUpgradeTime: (L) => Math.round(40 * Math.pow(1.14, L - 1)),
  diceSkipGems: (secs) => Math.max(1, Math.ceil(secs / 10)),
  // Selling pays forge-clone-2's age/level curve, priced in kills at the current stage.
  sellGold: (item, s) => Math.max(1, Math.round(0.5 * F.goldPerKill(s) * (1 + 0.25 * item.age) * Math.pow(LEVEL_SCALING, item.lv - 1))),
  diceDropChance: 0.04,
  expNeed: (lv) => 100 + 30 * (lv - 1),
  levelBonus: (lv) => 1 + 0.02 * (lv - 1),
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
  { stat: 'forges', text: (n) => `주사위 ${n}회 굴리기`, target: (t) => 10 + 10 * t },
  { stat: 'sells', text: (n) => `장비 ${n}회 판매`, target: (t) => 5 + 6 * t },
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

// ---------- formatting (forge-clone-2 compact numbers: 30,041 / 424.9k / 6m) ----------
const UNITS = ['', 'k', 'm', 'b', 't', 'q', 'aa', 'ab', 'ac', 'ad', 'ae', 'af'];
function compact(n, from) {
  n = Math.max(0, n);
  if (n < from) return Math.floor(n).toLocaleString('en-US');
  let i = 0, v = n;
  while (v >= 1000 && i < UNITS.length - 1) { v /= 1000; i++; }
  const digits = v >= 100 ? 0 : v >= 10 ? 1 : 2;
  const s = (Math.floor(v * Math.pow(10, digits)) / Math.pow(10, digits)).toFixed(digits);
  return (digits ? s.replace(/\.?0+$/, '') : s) + UNITS[i];
}
const fmt = (n) => compact(n, 100000);
const fmtStat = (n) => compact(n, 1000);
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
