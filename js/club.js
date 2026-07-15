// js/club.js
// Club model + team-strength calculation used by the match engine.
// Strength is fully explainable: sum of best-XI overalls, tactics modifier,
// and (for the home side) a fixed home bonus.

import { Player } from './player.js';
import { managerTactics } from './manager.js';

export class Club {
  constructor({
    id, name, short, division, reputation,
    cash, baseCommercial, ticketPrice,
    stadiumCapacity, players = [], isUser = false, manager = null, director = null
  }) {
    this.id = id;
    this.name = name;
    this.short = short ?? name.slice(0, 3).toUpperCase();
    this.division = division;             // 0 = top tier in this sim
    this.reputation = reputation;         // 1–10, drives commercial income
    this.cash = cash;                     // £ balance
    this.baseCommercial = baseCommercial; // £ per season base
    this.ticketPrice = ticketPrice;       // £
    this.stadiumCapacity = stadiumCapacity;
    this.players = players.map(p => (p instanceof Player ? p : new Player(p)));
    this.isUser = isUser;
    this.manager = manager;
    this.director = director;

    // Head coach tactical plan. Mentality shifts attack/defence emphasis.
    this.tactics = { mentality: 'balanced', pressing: 'medium' };

    // Season record
    this.resetSeasonRecord();

    // Infrastructure levels (1–5)
    this.academy = 1;
    this.training = 1;
  }

  resetSeasonRecord() {
    this.played = 0; this.won = 0; this.drawn = 0; this.lost = 0;
    this.gf = 0; this.ga = 0; this.points = 0;
  }

  get goalDiff() { return this.gf - this.ga; }

  // Pick the strongest legal XI: 1 GK, and best of the rest by overall,
  // guaranteeing at least 3 DEF / 3 MID / 1 FWD when available.
  bestEleven() {
    const byPos = { GK: [], DEF: [], MID: [], FWD: [] };
    const pool = this.players.filter(p => p.available !== false);
    const selectionPool = pool.length >= 11 ? pool : this.players;
    for (const p of selectionPool) byPos[p.position]?.push(p);
    for (const k in byPos) byPos[k].sort((a, b) => b.overall - a.overall);

    const xi = [];
    if (byPos.GK[0]) xi.push(byPos.GK[0]);
    xi.push(...byPos.DEF.slice(0, 4));
    xi.push(...byPos.MID.slice(0, 4));
    xi.push(...byPos.FWD.slice(0, 2));

    // Fill remaining slots with next-best outfielders.
    const used = new Set(xi.map(p => p.id));
    const rest = this.players
      .filter(p => !used.has(p.id) && p.position !== 'GK')
      .sort((a, b) => b.overall - a.overall);
    while (xi.length < 11 && rest.length) xi.push(rest.shift());

    return xi;
  }

  // Weekly wage bill for squad plus senior football staff.
  wageBill() {
    const playerWages = this.players.reduce((s, p) => s + p.wage, 0);
    return playerWages + (this.manager?.wage || 0) + (this.director?.wage || 0);
  }
}

// Mentality shifts the balance between attacking and defensive output.
const MENTALITY = {
  defensive: { att: 0.90, def: 1.12 },
  balanced:  { att: 1.00, def: 1.00 },
  attacking: { att: 1.12, def: 0.90 },
};

const PRESSING = {
  low:    { att: 0.98, def: 1.02 },
  medium: { att: 1.00, def: 1.00 },
  high:   { att: 1.05, def: 0.96 }, // more chances created AND conceded
};

// Returns transparent attack/defence ratings for a club's best XI.
// homeBonus is added to both once (default 0 for away side).
export function teamRatings(club, homeBonus = 0) {
  const xi = club.bestEleven();
  const plan = club.manager ? managerTactics(club.manager) : club.tactics;
  const m = MENTALITY[plan.mentality] || MENTALITY.balanced;
  const pr = PRESSING[plan.pressing] || PRESSING.medium;

  let att = 0, def = 0;
  for (const p of xi) {
    const contrib = p.overall * p.form * p.morale;
    if (p.position === 'FWD') { att += contrib * 1.1; def += contrib * 0.2; }
    else if (p.position === 'MID') { att += contrib * 0.8; def += contrib * 0.6; }
    else if (p.position === 'DEF') { att += contrib * 0.3; def += contrib * 1.0; }
    else { def += contrib * 1.2; } // GK
  }

  const n = Math.max(1, xi.length);
  att = (att / n) * m.att * pr.att + homeBonus;
  def = (def / n) * m.def * pr.def + homeBonus;

  return { attack: att, defense: def, xiCount: xi.length };
}
