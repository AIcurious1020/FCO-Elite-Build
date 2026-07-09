// js/pyramid.js
// Multi-division pyramid: division helpers, AI-division auto-simulation, and
// transparent promotion/relegation at season end.
//
// Rules (deliberately simple and fair):
//   - Top 2 of each division are PROMOTED (except division 1 — already top).
//   - Bottom 2 of each division are RELEGATED (except division 3 — the floor).
//   - Everyone else stays put.
// Because exactly 2 go up and 2 come down between adjacent divisions, every
// division always keeps 8 clubs.

import { standings, generateFixtures, playMatchweek } from './league.js';
import { TOP_DIVISION, BOTTOM_DIVISION } from './data.js';

export const PROMOTE = 2;   // top N promoted
export const RELEGATE = 2;  // bottom N relegated

// All clubs currently in a given division.
export function clubsInDivision(clubs, division) {
  return clubs.filter(c => c.division === division);
}

// Standings for just one division.
export function divisionStandings(clubs, division) {
  return standings(clubsInDivision(clubs, division));
}

// Auto-play a full season for one division (used for the divisions the user
// is NOT managing). Fast, headless, updates each club's season record.
export function autoSimulateDivision(clubs, division, clubsById) {
  const divClubs = clubsInDivision(clubs, division);
  const fixtures = generateFixtures(divClubs);
  for (const week of fixtures) playMatchweek(week, clubsById);
}

/**
 * Apply promotion & relegation across the whole pyramid.
 * Returns a structured summary so the UI can explain exactly what moved.
 * @param {Club[]} clubs
 * @param {string} userClubId
 */
export function applyPromotionRelegation(clubs, userClubId) {
  const moves = { promoted: [], relegated: [], userMove: null };

  // Snapshot each division's final order BEFORE changing any divisions,
  // so movements are computed from the season just played.
  const byDivision = {};
  for (let d = TOP_DIVISION; d <= BOTTOM_DIVISION; d++) {
    byDivision[d] = divisionStandings(clubs, d);
  }

  for (let d = TOP_DIVISION; d <= BOTTOM_DIVISION; d++) {
    const table = byDivision[d];

    // Promote top 2 (move to a numerically lower division = higher tier).
    if (d > TOP_DIVISION) {
      table.slice(0, PROMOTE).forEach(c => {
        c.division = d - 1;
        c.reputation = Math.min(10, +(c.reputation + 1).toFixed(1));
        moves.promoted.push({ id: c.id, name: c.name, from: d, to: d - 1 });
        if (c.id === userClubId) moves.userMove = { type: 'promoted', from: d, to: d - 1 };
      });
    }

    // Relegate bottom 2 (move to a numerically higher division = lower tier).
    if (d < BOTTOM_DIVISION) {
      table.slice(-RELEGATE).forEach(c => {
        c.division = d + 1;
        c.reputation = Math.max(1, +(c.reputation - 0.5).toFixed(1));
        moves.relegated.push({ id: c.id, name: c.name, from: d, to: d + 1 });
        if (c.id === userClubId) moves.userMove = { type: 'relegated', from: d, to: d + 1 };
      });
    }
  }

  return moves;
}
