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
      contractYears: 3,
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
  const profiles = squadRoleProfiles(club);

  return Object.keys(desired).map(position => {
    const profile = profiles[position];
    const depthGap = profile.desired - profile.count;
    const priority = profile.needType === 'starter' || profile.needType === 'depth' ? 'urgent'
      : profile.needType === 'rotation' || profile.needType === 'future' ? 'upgrade'
        : 'covered';
    return {
      position,
      count: profile.count,
      desired: profile.desired,
      bestOverall: profile.bestOverall,
      rotationOverall: profile.rotationOverall,
      depthOverall: profile.depthOverall,
      squadAverage: profile.squadAverage,
      roleNeed: profile.needType,
      priority,
      label: profile.label,
      reason: profile.reason,
      depthGap,
    };
  });
}

export function transferFit(player, club) {
  const needs = squadNeeds(club);
  const need = needs.find(n => n.position === player.position);
  const profile = squadRoleProfiles(club)[player.position];
  const role = playerSquadRole(player, profile);
  const currentBest = profile?.bestOverall || 0;
  const improvement = player.overall - role.benchmark;
  const askingPrice = Math.round(player.value * 0.95);
  const affordable = askingPrice <= club.cash;
  const wageRatioAfter = projectedWageRatio(club, player);
  const clubFit = clubFitLabel(role, need, affordable);
  const recommendation = clubFit.reason;

  return {
    need,
    currentBest,
    role,
    clubFit,
    improvement,
    askingPrice,
    affordable,
    wageRatioAfter,
    recommendation,
  };
}

function clubFitLabel(role, need, affordable) {
  if (!affordable) return { label: 'Risky', band: 'danger', reason: 'Fee is beyond current budget.' };
  if (role.type === 'poor') return { label: 'Poor fit', band: 'danger', reason: 'Does not clearly improve the squad.' };
  if (role.type === 'starter') return { label: 'Excellent fit', band: 'safe', reason: 'Improves the first XI.' };
  if (role.type === 'rotation') return { label: 'Good fit', band: 'safe', reason: 'Strengthens matchday options.' };
  if (role.type === 'prospect') return { label: 'Good fit', band: 'ok', reason: 'Young player with development upside.' };
  if (need?.roleNeed === 'depth') return { label: 'Useful cover', band: 'warning', reason: 'Adds needed squad depth.' };
  return { label: 'Useful cover', band: 'warning', reason: 'Adds cover, but not a clear upgrade.' };
}

const desired = { GK: 2, DEF: 5, MID: 5, FWD: 3 };

export function squadRoleProfiles(club) {
  const avg = averageOverall(club);
  return Object.keys(desired).reduce((profiles, position) => {
    const players = club.players
      .filter(p => p.position === position && p.available !== false)
      .sort((a, b) => b.overall - a.overall);
    const best = players[0]?.overall || 0;
    const rotation = players[1]?.overall || best;
    const depth = players[Math.min(players.length - 1, desired[position] - 1)]?.overall || rotation || best;
    const avgPosition = players.length
      ? players.reduce((sum, player) => sum + player.overall, 0) / players.length
      : 0;
    const expiring = club.players.filter(p => p.position === position && (p.contractYears ?? 2) <= 1).length;
    const oldCore = players.filter(p => p.age >= 31).length;
    const desiredCount = desired[position];
    const needType = positionNeedType({ players, avg, best, rotation, depth, desiredCount, expiring, oldCore });
    profiles[position] = {
      position,
      desired: desiredCount,
      count: players.length,
      bestOverall: best,
      rotationOverall: rotation,
      depthOverall: depth,
      squadAverage: Math.round(avgPosition || avg),
      roleAverage: avg,
      needType,
      label: needLabel(needType),
      reason: needReason(needType, position, players.length, desiredCount, best, rotation, depth, expiring, oldCore),
    };
    return profiles;
  }, {});
}

function positionNeedType({ players, avg, best, rotation, depth, desiredCount, expiring, oldCore }) {
  if (!players.length || best < avg - 4) return 'starter';
  if (players.length < desiredCount) return 'depth';
  if (rotation < avg - 5 || depth < avg - 7) return 'rotation';
  if (expiring >= 2 || oldCore >= Math.max(2, Math.ceil(desiredCount / 2))) return 'future';
  return 'covered';
}

function needLabel(type) {
  return {
    starter: 'Needs starter',
    rotation: 'Needs rotation',
    depth: 'Needs depth',
    future: 'Future planning',
    covered: 'Covered',
  }[type] || 'Covered';
}

function needReason(type, position, count, desiredCount, best, rotation, depth, expiring, oldCore) {
  if (type === 'starter') return `${position} lacks a strong first-choice option.`;
  if (type === 'depth') return `${position} has ${count}/${desiredCount} usable players.`;
  if (type === 'rotation') return `${position} first choice is fine, but rotation cover drops to ${rotation || depth} OVR.`;
  if (type === 'future') return `${position} is stable now, but contracts or age profile need planning.`;
  return `${position} has enough starter and squad cover.`;
}

function playerSquadRole(player, profile) {
  const ageUpside = player.age <= 22 && player.potential >= player.overall + 5;
  const best = profile?.bestOverall || 0;
  const rotation = profile?.rotationOverall || best;
  const depth = profile?.depthOverall || rotation || best;
  if (player.overall >= best + 2) return { type: 'starter', label: 'Improves first XI', benchmark: best };
  if (player.overall >= rotation + 2) return { type: 'rotation', label: 'Strengthens squad', benchmark: rotation };
  if (ageUpside && player.overall >= depth - 2) return { type: 'prospect', label: 'Future option', benchmark: depth };
  if (player.overall >= depth) return { type: 'depth', label: 'Useful cover', benchmark: depth };
  return { type: 'poor', label: 'Poor fit', benchmark: depth };
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
