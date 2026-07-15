// js/development.js
// Transparent player development and academy intake.
//
// Design goals:
//  - Growth is explainable: age curve + potential gap + training level.
//  - Decline is gentle and predictable for older players.
//  - Academy upgrades create better prospects without becoming a lottery.

import { Player } from './player.js';

const FIRST = ['A.', 'J.', 'M.', 'L.', 'R.', 'K.', 'D.', 'S.', 'T.', 'P.', 'C.', 'G.', 'B.', 'N.'];
const LAST = ['Bennett', 'Cooper', 'Foster', 'Hayes', 'Mason', 'Nolan', 'Porter', 'Russell', 'Turner', 'Wells', 'Young', 'Sharp'];

export function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function developSquad(club, season = 1) {
  const rng = makeRng(hash(`${club.id}-${season}-${club.training}-${club.academy}`));
  const changes = [];

  for (const player of club.players) {
    const before = player.overall;
    const delta = developmentDelta(player, club.training, rng);
    applyAttributeDelta(player, delta);
    player.age++;
    player.form = clampMult(player.form + 0.02);
    player.morale = clampMult(player.morale + 0.01);
    player.refreshValue();

    const after = player.overall;
    if (after !== before) {
      changes.push({
        id: player.id,
        name: player.name,
        position: player.position,
        age: player.age,
        before,
        after,
        delta: after - before,
        reason: developmentReason(player, delta, club.training),
      });
    }
  }

  return changes.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || b.after - a.after);
}

export function generateAcademyIntake(club, season = 1) {
  const rng = makeRng(hash(`academy-${club.id}-${season}-${club.academy}`));
  const count = club.academy >= 4 ? 2 : 1;
  const prospects = [];

  for (let i = 0; i < count; i++) {
    const position = pick(['GK', 'DEF', 'DEF', 'MID', 'MID', 'FWD'], rng);
    const base = 28 + club.academy * 4 + club.reputation * 1.4 + rng() * 8;
    const potentialBoost = 8 + club.academy * 3 + rng() * 8;
    const attrs = roleAttributes(position, base, rng);
    const prospect = new Player({
      id: `ya${season}-${club.id}-${i + 1}-${Math.floor(rng() * 10000)}`,
      name: `${pick(FIRST, rng)} ${pick(LAST, rng)}`,
      position,
      age: 16 + Math.floor(rng() * 3),
      ...attrs,
      wage: academyWage(base),
      form: 1,
      morale: 1.05,
      contractYears: 3,
    });
    prospect.potential = Math.min(95, Math.max(prospect.overall + 4, Math.round(prospect.overall + potentialBoost)));
    prospect.refreshValue();
    prospects.push(prospect);
  }

  return prospects.sort((a, b) => b.potential - a.potential || b.overall - a.overall);
}

export function summariseDevelopment(changes, intake) {
  const improved = changes.filter(c => c.delta > 0);
  const declined = changes.filter(c => c.delta < 0);
  const best = improved[0];
  const topProspect = intake[0];

  return {
    improved: improved.length,
    declined: declined.length,
    best: best ? { ...best } : null,
    topProspect: topProspect ? playerSnapshot(topProspect) : null,
    text: [
      `${improved.length} players improved and ${declined.length} declined.`,
      best ? `${best.name} made the biggest jump (${signed(best.delta)} to ${best.after} OVR).` : 'No player made a rating jump this year.',
      topProspect ? `Academy highlight: ${topProspect.name}, ${topProspect.position}, ${topProspect.overall} OVR / ${topProspect.potential} POT.` : 'No academy intake this season.',
    ].join(' '),
  };
}

function developmentDelta(player, training, rng) {
  const ovr = player.overall;
  const potentialGap = Math.max(0, player.potential - ovr);
  const trainingPush = (training - 1) * 0.35;
  let centre = 0;

  if (player.age <= 19) centre = 1.6 + potentialGap * 0.08 + trainingPush;
  else if (player.age <= 23) centre = 1.0 + potentialGap * 0.06 + trainingPush;
  else if (player.age <= 27) centre = 0.25 + potentialGap * 0.03 + trainingPush * 0.5;
  else if (player.age <= 30) centre = 0;
  else if (player.age <= 33) centre = -0.55 + trainingPush * 0.15;
  else centre = -1.25;

  const variance = (rng() - 0.5) * 1.6;
  return Math.max(-3, Math.min(4, Math.round(centre + variance)));
}

function applyAttributeDelta(player, delta) {
  if (delta === 0) return;
  const attrs = ['attack', 'defense', 'passing', 'finish'];
  const primary = primaryAttributes(player.position);
  const ordered = [...primary, ...attrs.filter(a => !primary.includes(a))];
  const direction = delta > 0 ? 1 : -1;
  let steps = Math.abs(delta);

  while (steps > 0) {
    for (const attr of ordered) {
      if (steps <= 0) break;
      player[attr] = clampAttr(player[attr] + direction);
      steps--;
    }
  }
}

function developmentReason(player, delta, training) {
  if (delta > 0 && player.age <= 23) return `Young player growth, helped by training level ${training}.`;
  if (delta > 0) return `Late improvement, helped by training level ${training}.`;
  if (delta < 0 && player.age >= 31) return 'Age-related decline.';
  if (delta < 0) return 'Minor form and development setback.';
  return 'Held level.';
}

function roleAttributes(position, base, rng) {
  const roll = () => clampAttr(Math.round(base + (rng() - 0.5) * 10));
  let attack = roll(), defense = roll(), passing = roll(), finish = roll();
  if (position === 'GK') { defense += 10; attack -= 8; finish -= 12; }
  if (position === 'DEF') { defense += 8; finish -= 5; }
  if (position === 'MID') { passing += 7; }
  if (position === 'FWD') { attack += 5; finish += 9; defense -= 8; }
  return {
    attack: clampAttr(attack),
    defense: clampAttr(defense),
    passing: clampAttr(passing),
    finish: clampAttr(finish),
  };
}

function primaryAttributes(position) {
  if (position === 'GK') return ['defense', 'passing'];
  if (position === 'DEF') return ['defense', 'passing'];
  if (position === 'MID') return ['passing', 'attack'];
  if (position === 'FWD') return ['finish', 'attack'];
  return ['attack', 'defense'];
}

function academyWage(base) {
  return Math.round((120 + base * 8) / 25) * 25;
}

function pick(items, rng) {
  return items[Math.floor(rng() * items.length)];
}

function clampAttr(v) {
  return Math.max(20, Math.min(99, Math.round(v)));
}

function clampMult(v) {
  return Math.max(0.85, Math.min(1.15, +v.toFixed(3)));
}

function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function signed(n) {
  return n > 0 ? `+${n}` : `${n}`;
}

function playerSnapshot(player) {
  return {
    id: player.id,
    name: player.name,
    position: player.position,
    age: player.age,
    overall: player.overall,
    potential: player.potential,
  };
}
