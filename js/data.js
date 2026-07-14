// js/data.js
// Seed pyramid: 24 clubs across 3 divisions (8 per division).
//   division 1 = top tier (hardest, richest)
//   division 2 = middle tier
//   division 3 = National League — selectable starting clubs.
// Squad strength is tiered by division so the climb genuinely gets harder.

import { Club } from './club.js';
import { Player } from './player.js';

const FIRST = ['A.', 'J.', 'M.', 'L.', 'R.', 'K.', 'D.', 'S.', 'T.', 'P.', 'C.', 'G.', 'B.', 'N.', 'O.', 'H.', 'W.', 'F.', 'E.', 'V.'];
const LAST = ['Smith', 'Jones', 'Brown', 'Davis', 'Wilson', 'Taylor', 'Evans', 'Clarke', 'White', 'Harris', 'Martin', 'Lee', 'Scott', 'Adams', 'Walker', 'Hughes', 'Green', 'Baker', 'Cole', 'Reid', 'Fox', 'Shaw', 'Webb', 'Payne', 'Knight'];

// Deterministic RNG so a given club always generates the same squad.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let pid = 0;
function makePlayer(rand, tier) {
  // tier: club strength centre (35–80). Attributes cluster around it.
  const roll = (spread = 12) => Math.round(tier + (rand() - 0.5) * 2 * spread);
  const clamp = v => Math.max(20, Math.min(97, v));
  const positions = ['GK', 'DEF', 'DEF', 'DEF', 'DEF', 'MID', 'MID', 'MID', 'MID', 'FWD', 'FWD', 'FWD'];
  const pos = positions[Math.floor(rand() * positions.length)];
  const age = 18 + Math.floor(rand() * 17);

  // Bias attributes toward the role so overalls feel right.
  let attack = clamp(roll()), defense = clamp(roll()), passing = clamp(roll()), finish = clamp(roll());
  if (pos === 'GK') { defense = clamp(defense + 12); finish = clamp(finish - 20); }
  if (pos === 'DEF') { defense = clamp(defense + 10); finish = clamp(finish - 8); }
  if (pos === 'FWD') { finish = clamp(finish + 12); attack = clamp(attack + 8); defense = clamp(defense - 10); }
  if (pos === 'MID') { passing = clamp(passing + 8); }

  const name = FIRST[Math.floor(rand() * FIRST.length)] + ' ' + LAST[Math.floor(rand() * LAST.length)];
  const ovr = Player.overallOf({ attack, defense, passing, finish, position: pos });
  // Weekly wage — tuned so a mid-table squad is affordable on its division's
  // TV/commercial income (avoids the death-spiral the brief warns of).
  const wage = Math.round((Math.pow(ovr / 10, 2.6) * 14) / 25) * 25;
  const form = +(0.9 + rand() * 0.2).toFixed(2);
  const morale = +(0.9 + rand() * 0.2).toFixed(2);

  return new Player({
    id: 'pl' + (++pid), name, position: pos, age,
    attack, defense, passing, finish, wage, form, morale,
  });
}

function makeSquad(seed, tier, size = 18) {
  const rand = rng(seed);
  const squad = [];
  // Guarantee positional coverage.
  const template = ['GK', 'GK', 'DEF', 'DEF', 'DEF', 'DEF', 'DEF', 'MID', 'MID', 'MID', 'MID', 'MID', 'FWD', 'FWD', 'FWD'];
  for (let i = 0; i < size; i++) {
    const p = makePlayer(rand, tier);
    if (i < template.length) p.position = template[i];
    squad.push(p);
  }
  return squad;
}

// Club definition: [id, name, short, division, reputation, tier, cash, capacity, ticket, commercial]
// Tiers ascend with division quality: D3 ~40–48, D2 ~50–60, D1 ~62–74.
const DEFS = [
  // ---- National League (bottom tier) — selectable career starts ----
  ['solihull',  'Solihull FC',       'SOL', 3, 1, 40,   250_000,  3_000, 18,  120_000],
  ['grimsby',   'Grimsby Athletic',  'GRM', 3, 2, 44,   600_000,  6_000, 20,  260_000],
  ['barnet',    'Barnet Rangers',    'BNT', 3, 2, 46,   900_000,  7_500, 22,  400_000],
  ['woking',    'Woking Town',       'WOK', 3, 2, 45,   700_000,  5_500, 20,  240_000],
  ['altrincham','Altrincham FC',     'ALT', 3, 2, 43,   550_000,  5_000, 19,  210_000],
  ['dagenham',  'Dagenham & R.',     'DAG', 3, 2, 47,   800_000,  6_500, 21,  320_000],
  ['boreham',   'Boreham Wood',      'BOR', 3, 1, 42,   450_000,  4_500, 18,  180_000],
  ['halifax',   'Halifax United',    'HAL', 3, 2, 48,   950_000,  7_000, 22,  380_000],

  // ---- Division 2 (middle tier) ----
  ['bristol',   'Bristol Rovers',    'BRS', 2, 3, 52, 1_200_000,  8_000, 24,  500_000],
  ['stockport', 'Stockport County',  'STK', 2, 3, 50, 1_000_000,  9_000, 22,  450_000],
  ['chester',   'Chester City',      'CHS', 2, 4, 54, 1_600_000, 10_000, 25,  650_000],
  ['wrexham',   'Wrexham Town',      'WRX', 2, 4, 56, 2_000_000, 12_000, 26,  800_000],
  ['mansfield', 'Mansfield Town',    'MAN', 2, 3, 53, 1_400_000, 10_000, 24,  600_000],
  ['newport',   'Newport City',      'NEW', 2, 3, 51, 1_100_000,  8_500, 23,  480_000],
  ['exeter',    'Exeter Athletic',   'EXE', 2, 4, 55, 1_800_000, 11_000, 25,  720_000],
  ['swindon',   'Swindon Rangers',   'SWN', 2, 3, 52, 1_300_000,  9_500, 24,  560_000],

  // ---- Division 1 (top tier) ----
  ['notts',     'Notts United',      'NTS', 1, 6, 64, 5_500_000, 20_000, 32, 2_200_000],
  ['sunderland','Sunderland City',   'SUN', 1, 7, 70, 9_000_000, 32_000, 36, 4_000_000],
  ['leeds',     'Leeds Athletic',    'LDS', 1, 8, 74,14_000_000, 38_000, 40, 6_500_000],
  ['sheffield', 'Sheffield Rangers', 'SHF', 1, 6, 66, 6_500_000, 24_000, 33, 2_800_000],
  ['norwich',   'Norwich United',    'NOR', 1, 6, 65, 6_000_000, 22_000, 32, 2_500_000],
  ['boro',      'Boro Town',         'BRO', 1, 5, 62, 4_500_000, 19_000, 30, 1_900_000],
  ['coventry',  'Coventry City',     'COV', 1, 6, 67, 7_000_000, 26_000, 34, 3_100_000],
  ['ipswich',   'Ipswich Rovers',    'IPS', 1, 7, 69, 8_000_000, 28_000, 35, 3_600_000],
];

export function createLeague(userClubId = 'solihull') {
  const clubs = DEFS.map(([id, name, short, div, rep, tier, cash, cap, ticket, comm], i) =>
    new Club({
      id, name, short,
      division: div,
      reputation: rep,
      cash,
      baseCommercial: comm,
      ticketPrice: ticket,
      stadiumCapacity: cap,
      players: makeSquad(1000 + i * 37, tier),
      isUser: id === userClubId,
    })
  );

  const clubsById = {};
  clubs.forEach(c => { clubsById[c.id] = c; });

  return { clubs, clubsById, userClubId };
}

// Division metadata for the UI. Index by division number (1–3).
export const DIVISIONS = {
  1: { name: 'Premier Division', short: 'Div 1' },
  2: { name: 'Championship',     short: 'Div 2' },
  3: { name: 'National League',  short: 'NL' },
};
export const TOP_DIVISION = 1;
export const BOTTOM_DIVISION = 3;
