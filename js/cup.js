// js/cup.js
// Domestic knockout cup. It uses the same transparent match engine as the
// league, then resolves level knockout ties with a visible weighted shootout.

import { teamRatings } from './club.js';
import { simulateMatch, HOME_BONUS, outcomeProbabilities, makeRng } from './match.js';

export const CUP_NAME = 'Chairman Cup';

const ROUND_DEFS = [
  { name: 'Preliminary Round', short: 'Prelim', prize: 30_000, unlockWeek: 1 },
  { name: 'Round of 16', short: 'R16', prize: 60_000, unlockWeek: 3 },
  { name: 'Quarter Final', short: 'QF', prize: 120_000, unlockWeek: 6 },
  { name: 'Semi Final', short: 'SF', prize: 250_000, unlockWeek: 9 },
  { name: 'Final', short: 'Final', prize: 650_000, unlockWeek: 12 },
];

export function createCup(clubs, season) {
  const seeded = clubs.slice().sort((a, b) =>
    b.reputation - a.reputation || avgOverall(b) - avgOverall(a) || a.name.localeCompare(b.name)
  );
  const byes = seeded.slice(0, 8).map(c => c.id);
  const prelimEntrants = shuffleIds(seeded.slice(8).map(c => c.id), season * 101);
  const rounds = ROUND_DEFS.map(def => ({ ...def, fixtures: [], results: [], played: false }));
  rounds[0].fixtures = pairIds(prelimEntrants);

  return {
    name: CUP_NAME,
    season,
    roundIndex: 0,
    byes,
    rounds,
    championId: null,
    userBestRound: null,
    status: 'active',
  };
}

export function cupCurrentRound(cup) {
  if (!cup || cup.status === 'complete') return null;
  return cup.rounds[cup.roundIndex] || null;
}

export function cupCanPlay(cup, currentWeek) {
  const round = cupCurrentRound(cup);
  if (!round || round.played) return false;
  return currentWeek + 1 >= round.unlockWeek;
}

export function cupStatus(cup, userClubId) {
  if (!cup) return { label: 'Not started', band: 'pending', text: 'Cup draw pending.' };
  if (cup.championId === userClubId) {
    return { label: 'Winners', band: 'ontrack', text: `${CUP_NAME} lifted. The season has a serious headline now.` };
  }
  const current = cupCurrentRound(cup);
  const alive = userStillAlive(cup, userClubId);
  if (!alive) {
    return { label: 'Eliminated', band: 'offtrack', text: `Best run: ${cup.userBestRound || 'entered the cup'}.` };
  }
  if (!current) return { label: 'Complete', band: 'pending', text: 'Cup complete.' };
  return { label: current.short, band: 'close', text: `Still alive. Next round: ${current.name}.` };
}

export function userStillAlive(cup, userClubId) {
  if (!cup || cup.status === 'complete') return cup?.championId === userClubId;
  const current = cupCurrentRound(cup);
  if (current?.fixtures.some(f => f.home === userClubId || f.away === userClubId)) return true;
  if (cup.roundIndex === 0 && cup.byes.includes(userClubId)) return true;
  return false;
}

export function playCupRound(cup, clubsById, seedBase = null) {
  const round = cupCurrentRound(cup);
  if (!round || round.played) return { round: null, results: [], userPrize: 0, championId: cup?.championId || null };

  const results = round.fixtures.map((fixture, idx) =>
    playCupMatch(fixture, clubsById, seedBase == null ? null : seedBase + cup.season * 1000 + cup.roundIndex * 100 + idx)
  );
  round.results = results.map(serialiseResult);
  round.played = true;

  const winners = results.map(r => r.winner.id);
  const nextEntrants = cup.roundIndex === 0
    ? shuffleIds([...cup.byes, ...winners], cup.season * 211 + cup.roundIndex)
    : shuffleIds(winners, cup.season * 211 + cup.roundIndex);

  if (round.name === 'Final') {
    cup.championId = winners[0] || null;
    cup.status = 'complete';
  } else {
    cup.roundIndex++;
    cup.rounds[cup.roundIndex].fixtures = pairIds(nextEntrants);
  }

  return { round, results, championId: cup.championId };
}

export function cupRoundFixture(cup, userClubId) {
  const round = cupCurrentRound(cup);
  if (!round) return null;
  return round.fixtures.find(f => f.home === userClubId || f.away === userClubId) || null;
}

function playCupMatch(fixture, clubsById, seed = null) {
  const home = clubsById[fixture.home];
  const away = clubsById[fixture.away];
  const homeRatings = teamRatings(home, HOME_BONUS);
  const awayRatings = teamRatings(away, 0);
  const res = simulateMatch(homeRatings, awayRatings, seed);
  const probs = outcomeProbabilities(homeRatings, awayRatings);
  let winner = res.result === 'H' ? home : res.result === 'A' ? away : null;
  let tiebreak = null;

  if (!winner) {
    const rng = seed == null ? Math.random : makeRng(seed + 77);
    const homeChance = clamp(probs.homeWin / Math.max(0.001, probs.homeWin + probs.awayWin), 0.35, 0.65);
    const homePens = 3 + Math.floor(rng() * 3);
    const awayPens = 3 + Math.floor(rng() * 3);
    winner = rng() <= homeChance ? home : away;
    tiebreak = {
      method: 'Penalties',
      homeChance: +homeChance.toFixed(2),
      penaltyScore: winner === home
        ? `${Math.max(homePens, awayPens + 1)}-${awayPens}`
        : `${homePens}-${Math.max(awayPens, homePens + 1)}`,
    };
  }

  return { home, away, winner, ...res, probs, tiebreak };
}

function serialiseResult(r) {
  return {
    home: r.home.id,
    away: r.away.id,
    winner: r.winner.id,
    homeGoals: r.homeGoals,
    awayGoals: r.awayGoals,
    result: r.result,
    xg: r.xg,
    ratings: r.ratings,
    timeline: r.timeline,
    tiebreak: r.tiebreak,
  };
}

function pairIds(ids) {
  const fixtures = [];
  for (let i = 0; i < ids.length; i += 2) fixtures.push({ home: ids[i], away: ids[i + 1] });
  return fixtures.filter(f => f.home && f.away);
}

function shuffleIds(ids, seed) {
  const rand = makeRng(seed);
  const arr = ids.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function avgOverall(club) {
  if (!club.players?.length) return 0;
  return club.players.reduce((s, p) => s + p.overall, 0) / club.players.length;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}
