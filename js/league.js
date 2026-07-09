// js/league.js
// Round-robin fixture generation, result recording, and standings.

import { teamRatings } from './club.js';
import { simulateMatch, HOME_BONUS } from './match.js';

// Double round-robin (home + away) using the circle method.
export function generateFixtures(clubs) {
  const ids = clubs.map(c => c.id);
  if (ids.length % 2 !== 0) ids.push(null); // bye
  const n = ids.length;
  const rounds = [];
  const arr = ids.slice();

  for (let r = 0; r < n - 1; r++) {
    const round = [];
    for (let i = 0; i < n / 2; i++) {
      const h = arr[i], a = arr[n - 1 - i];
      if (h != null && a != null) {
        // Alternate home/away by round for fairness.
        round.push(r % 2 === 0 ? { home: h, away: a } : { home: a, away: h });
      }
    }
    rounds.push(round);
    arr.splice(1, 0, arr.pop()); // rotate, keeping first fixed
  }

  // Second half = reversed venues.
  const secondHalf = rounds.map(round =>
    round.map(f => ({ home: f.away, away: f.home }))
  );

  const all = [...rounds, ...secondHalf];
  // Flatten into a matchweek-indexed schedule.
  return all.map((round, i) => ({ week: i + 1, matches: round, played: false }));
}

// Simulate every match in a matchweek and update club records.
export function playMatchweek(week, clubsById, seedBase = null) {
  const results = [];
  week.matches.forEach((fx, idx) => {
    const home = clubsById[fx.home];
    const away = clubsById[fx.away];
    const hr = teamRatings(home, HOME_BONUS);
    const ar = teamRatings(away, 0);
    const seed = seedBase == null ? null : seedBase + week.week * 100 + idx;
    const res = simulateMatch(hr, ar, seed);
    recordResult(home, away, res);
    results.push({ home, away, ...res });
  });
  week.played = true;
  return results;
}

// Update both clubs' standings from a single result.
export function recordResult(home, away, res) {
  home.played++; away.played++;
  home.gf += res.homeGoals; home.ga += res.awayGoals;
  away.gf += res.awayGoals; away.ga += res.homeGoals;

  if (res.result === 'H') { home.won++; home.points += 3; away.lost++; }
  else if (res.result === 'A') { away.won++; away.points += 3; home.lost++; }
  else { home.drawn++; away.drawn++; home.points++; away.points++; }
}

// Sorted standings: points, then goal difference, then goals for.
export function standings(clubs) {
  return clubs.slice().sort((a, b) =>
    b.points - a.points ||
    b.goalDiff - a.goalDiff ||
    b.gf - a.gf ||
    a.name.localeCompare(b.name)
  );
}
