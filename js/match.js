// js/match.js
// Transparent match engine.
//
// Design goals (from the project brief):
//  - No hidden randomness or arbitrary "streaks".
//  - Every result is explained: expected goals, strength ratings, and the
//    bounded luck roll that produced the final score.
//  - Uses a Poisson process so scorelines are realistic AND statistically fair
//    over many games (favourites win at the right rate, no rigged runs).

const HOME_BONUS = 6;      // fixed, visible home advantage added to ratings
const BASE_XG = 1.45;      // league-average goals per team per game
const SPREAD = 0.045;      // how strongly a rating gap swings expected goals

// Expected goals for one side, given its attack vs the opponent's defence.
// Fully deterministic — this is the "fair" core of the result.
export function expectedGoals(attack, oppDefense) {
  const edge = attack - oppDefense;
  return Math.max(0.15, BASE_XG * Math.exp(SPREAD * edge));
}

// Probability of scoring k goals from an xG value. Exported so the UI can show
// pre-match win/draw/loss odds using the same model as the actual result.
export function poissonProbability(lambda, k) {
  let factorial = 1;
  for (let i = 2; i <= k; i++) factorial *= i;
  return (Math.exp(-lambda) * Math.pow(lambda, k)) / factorial;
}

export function outcomeProbabilities(homeRatings, awayRatings, maxGoals = 8) {
  const homeXg = expectedGoals(homeRatings.attack, awayRatings.defense);
  const awayXg = expectedGoals(awayRatings.attack, homeRatings.defense);
  let homeWin = 0, draw = 0, awayWin = 0;

  for (let h = 0; h <= maxGoals; h++) {
    for (let a = 0; a <= maxGoals; a++) {
      const p = poissonProbability(homeXg, h) * poissonProbability(awayXg, a);
      if (h > a) homeWin += p;
      else if (h < a) awayWin += p;
      else draw += p;
    }
  }

  const total = homeWin + draw + awayWin;
  return {
    homeWin: +(homeWin / total).toFixed(4),
    draw: +(draw / total).toFixed(4),
    awayWin: +(awayWin / total).toFixed(4),
    xg: { home: +homeXg.toFixed(2), away: +awayXg.toFixed(2) },
  };
}

// Draw a goal count from a Poisson distribution with mean lambda.
// This is the ONLY randomness, and it is unbiased: no memory, no streaks.
function poisson(lambda, rng) {
  const L = Math.exp(-lambda);
  let k = 0, p = 1;
  do { k++; p *= rng(); } while (p > L);
  return k - 1;
}

// Simple seedable RNG (mulberry32) so matches are reproducible for testing.
export function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Generate a lightweight, plausible list of goal minutes for the timeline UI.
function goalMinutes(count, rng) {
  const mins = [];
  for (let i = 0; i < count; i++) mins.push(1 + Math.floor(rng() * 90));
  return mins.sort((x, y) => x - y);
}

/**
 * simulateMatch — returns the score plus a full explanation object.
 * @param {{attack:number,defense:number}} home  ratings (incl. home bonus)
 * @param {{attack:number,defense:number}} away  ratings
 * @param {number} [seed] optional seed for reproducible results
 */
export function simulateMatch(homeRatings, awayRatings, seed = null) {
  const rng = seed == null ? Math.random : makeRng(seed);

  const homeXg = expectedGoals(homeRatings.attack, awayRatings.defense);
  const awayXg = expectedGoals(awayRatings.attack, homeRatings.defense);

  const homeGoals = poisson(homeXg, rng);
  const awayGoals = poisson(awayXg, rng);

  const result = homeGoals > awayGoals ? 'H' : homeGoals < awayGoals ? 'A' : 'D';

  return {
    homeGoals,
    awayGoals,
    result,
    xg: { home: +homeXg.toFixed(2), away: +awayXg.toFixed(2) },
    ratings: {
      homeAtt: Math.round(homeRatings.attack),
      homeDef: Math.round(homeRatings.defense),
      awayAtt: Math.round(awayRatings.attack),
      awayDef: Math.round(awayRatings.defense),
    },
    timeline: {
      home: goalMinutes(homeGoals, rng),
      away: goalMinutes(awayGoals, rng),
    },
  };
}

export { HOME_BONUS };
