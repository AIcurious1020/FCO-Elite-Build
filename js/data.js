// js/data.js
// Seed league: 8 clubs with procedurally generated squads. The user starts at
// Solihull FC (lowest reputation) so the "non-league to elite" climb is real.

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
  // Weekly wage — tuned so a mid-table lower-league squad is affordable on its
  // division's TV/commercial income (avoids the death-spiral the brief warns of).
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

// League definition: [id, name, short, reputation, tier, cash, capacity, ticket, commercial]
const DEFS = [
  ['solihull',  'Solihull FC',        'SOL', 1,  40,   250_000,  3_000, 18,  120_000],
  ['bristol',   'Bristol Rovers',     'BRS', 3,  52, 1_200_000,  8_000, 24,  500_000],
  ['wrexham',   'Wrexham Town',       'WRX', 4,  56, 2_000_000, 12_000, 26,  800_000],
  ['stockport', 'Stockport County',   'STK', 3,  50, 1_000_000,  9_000, 22,  450_000],
  ['notts',     'Notts United',       'NTS', 5,  60, 3_500_000, 18_000, 30, 1_400_000],
  ['grimsby',   'Grimsby Athletic',   'GRM', 2,  46,   600_000,  6_000, 20,  260_000],
  ['chester',   'Chester City',       'CHS', 4,  54, 1_600_000, 10_000, 25,  650_000],
  ['barnet',    'Barnet Rangers',     'BNT', 3,  49,   900_000,  7_500, 22,  400_000],
];

export function createLeague(userClubId = 'solihull') {
  const clubs = DEFS.map(([id, name, short, rep, tier, cash, cap, ticket, comm], i) =>
    new Club({
      id, name, short,
      division: 3,                 // all start in the same division
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
