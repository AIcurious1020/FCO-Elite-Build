// js/transfers.js
// Transfer market with transparent negotiation. Offers are evaluated against a
// clear rule set (fee vs value, wage affordability) — no hidden dice rolls that
// frustrate players.

import { Player } from './player.js';

const FIRST = ['A.', 'J.', 'M.', 'L.', 'R.', 'K.', 'D.', 'S.', 'T.', 'P.', 'C.', 'G.'];
const LAST = ['Novak', 'Silva', 'Muller', 'Rossi', 'Dubois', 'Ferrari', 'Costa', 'Bauer', 'Moreau', 'Ricci', 'Vidal', 'Sané'];

let fid = 0;

// Build a rotating list of transfer targets scaled to the user's level.
export function generateMarket(userClub, size = 8) {
  const rand = Math.random;
  const tier = averageOverall(userClub);
  const market = [];
  for (let i = 0; i < size; i++) {
    const spread = 14;
    const centre = tier + (rand() - 0.4) * 20; // some bargains, some stars
    const clamp = v => Math.max(30, Math.min(94, Math.round(v)));
    const positions = ['GK', 'DEF', 'DEF', 'MID', 'MID', 'MID', 'FWD', 'FWD'];
    const pos = positions[Math.floor(rand() * positions.length)];
    let attack = clamp(centre + (rand() - .5) * spread);
    let defense = clamp(centre + (rand() - .5) * spread);
    let passing = clamp(centre + (rand() - .5) * spread);
    let finish = clamp(centre + (rand() - .5) * spread);
    if (pos === 'GK') { defense = clamp(defense + 12); }
    if (pos === 'DEF') { defense = clamp(defense + 8); }
    if (pos === 'FWD') { finish = clamp(finish + 10); }
    const age = 18 + Math.floor(rand() * 16);
    const name = FIRST[Math.floor(rand() * FIRST.length)] + ' ' + LAST[Math.floor(rand() * LAST.length)];
    const p = new Player({
      id: 'tf' + (++fid), name, position: pos, age,
      attack, defense, passing, finish,
      wage: 0,
    });
    p.wage = Math.round((Math.pow(p.overall / 10, 2.6) * 15) / 25) * 25;
    p.refreshValue();
    market.push(p);
  }
  return market;
}

function averageOverall(club) {
  if (!club.players.length) return 50;
  return club.players.reduce((s, p) => s + p.overall, 0) / club.players.length;
}

// Evaluate a bid transparently. Returns {accepted, reason}.
export function evaluateBid(target, feeOffered, userClub) {
  // Selling club wants at least 90% of value (rep gives small discount).
  const askingPrice = Math.round(target.value * 0.95);
  if (feeOffered < askingPrice) {
    return { accepted: false, reason: `Rejected — they want at least £${fmt(askingPrice)}.`, askingPrice };
  }
  if (feeOffered > userClub.cash) {
    return { accepted: false, reason: `You cannot afford this fee (balance £${fmt(userClub.cash)}).`, askingPrice };
  }
  return { accepted: true, reason: `Accepted for £${fmt(feeOffered)}.`, askingPrice };
}

export function squadNeeds(club) {
  const desired = { GK: 2, DEF: 5, MID: 5, FWD: 3 };
  const counts = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
  const best = { GK: 0, DEF: 0, MID: 0, FWD: 0 };

  club.players.forEach(p => {
    if (p.available === false) return;
    if (!counts[p.position]) counts[p.position] = 0;
    counts[p.position]++;
    best[p.position] = Math.max(best[p.position] || 0, p.overall);
  });

  return Object.keys(desired).map(position => {
    const count = counts[position] || 0;
    const depthGap = desired[position] - count;
    const bestOverall = best[position] || 0;
    const priority = depthGap > 0 ? 'urgent' : bestOverall < averageOverall(club) - 5 ? 'upgrade' : 'covered';
    return {
      position,
      count,
      desired: desired[position],
      bestOverall,
      priority,
      label: priority === 'urgent' ? 'Needs depth' : priority === 'upgrade' ? 'Upgrade chance' : 'Covered',
    };
  });
}

export function transferFit(player, club) {
  const needs = squadNeeds(club);
  const need = needs.find(n => n.position === player.position);
  const currentBest = need?.bestOverall || 0;
  const improvement = player.overall - currentBest;
  const askingPrice = Math.round(player.value * 0.95);
  const affordable = askingPrice <= club.cash;
  const wageRatioAfter = projectedWageRatio(club, player);
  let recommendation = 'Depth option';

  if (need?.priority === 'urgent') recommendation = 'Fills squad need';
  else if (improvement >= 5) recommendation = 'Clear upgrade';
  else if (improvement >= 1) recommendation = 'Marginal upgrade';
  else if (!affordable) recommendation = 'Too expensive';

  return {
    need,
    currentBest,
    improvement,
    askingPrice,
    affordable,
    wageRatioAfter,
    recommendation,
  };
}

export function projectedWageRatio(club, incoming = null) {
  const weekly = club.wageBill() + (incoming ? incoming.wage : 0);
  const annualWages = weekly * 52;
  const annualRevenue = projectedRevenue(club);
  return annualRevenue ? annualWages / annualRevenue : 1;
}

// Complete a purchase: move player, deduct cash.
export function completeTransferIn(target, fee, userClub, market) {
  userClub.cash -= fee;
  userClub.players.push(target);
  const idx = market.indexOf(target);
  if (idx >= 0) market.splice(idx, 1);
}

// Sell a squad player: 85–100% of value depending on demand (fixed band).
export function sellPlayer(player, userClub) {
  const fee = Math.round(player.value * 0.9);
  userClub.cash += fee;
  const idx = userClub.players.indexOf(player);
  if (idx >= 0) userClub.players.splice(idx, 1);
  return fee;
}

function fmt(n) { return Math.round(n).toLocaleString('en-GB'); }

function projectedRevenue(club) {
  const played = club.played || 14;
  const winRatio = played ? club.won / played : 0.4;
  const homeGames = Math.max(1, Math.round(played / 2));
  const attendancePull = 0.45 + 0.30 * winRatio + 0.05 * club.reputation;
  const matchday = Math.min(club.stadiumCapacity, club.stadiumCapacity * attendancePull) * club.ticketPrice * homeGames;
  const tv = [0, 18_000_000, 4_000_000, 900_000][club.division] ?? 20_000;
  const commercial = club.baseCommercial * (1 + 0.15 * club.reputation) * (1 + 0.3 * winRatio);
  return Math.round(matchday + tv + commercial);
}
