// js/contracts.js
// Simple transparent player contract model for chairman retention decisions.

export function contractDemand(player, club) {
  const status = contractStatus(player);
  const leverage = status.key === 'expires_now' ? 1.18 : status.key === 'expiring' ? 1.10 : 1.02;
  const quality = player.overall >= avgOverall(club) + 5 ? 1.12 : 1;
  const age = player.age <= 23 ? 1.08 : player.age >= 31 ? 0.92 : 1;
  const newWage = Math.round((player.wage * leverage * quality * age) / 25) * 25;
  const signingFee = Math.round(Math.max(0, newWage - player.wage) * 26 / 1000) * 1000;
  const years = player.age >= 31 ? 2 : player.age <= 23 ? 4 : 3;
  return { newWage, signingFee, years, weeklyIncrease: newWage - player.wage };
}

export function renewPlayerContract(player, demand = null) {
  const next = demand || contractDemand(player, { players: [player] });
  player.wage = next.newWage;
  player.contractYears = next.years;
  player.morale = Math.min(1.15, (player.morale || 1) + 0.04);
  return next;
}

export function expiringPlayers(club, limit = 4) {
  return club.players
    .filter(p => (p.contractYears ?? 2) <= 1)
    .sort((a, b) => (a.contractYears ?? 0) - (b.contractYears ?? 0) || b.overall - a.overall)
    .slice(0, limit);
}

export function tickContracts(club) {
  const changed = [];
  club.players.forEach(player => {
    player.contractYears = Math.max(0, (player.contractYears ?? 2) - 1);
    if (player.contractYears === 0) {
      player.morale = Math.max(0.85, (player.morale || 1) - 0.04);
      changed.push(player);
    }
  });
  return changed;
}

export function contractStatus(player) {
  const years = player.contractYears ?? 2;
  if (years <= 0) return { key: 'expires_now', label: 'Expires now', band: 'danger' };
  if (years === 1) return { key: 'expiring', label: '1 year left', band: 'warning' };
  return { key: 'secure', label: `${years} yrs`, band: 'safe' };
}

function avgOverall(club) {
  if (!club.players?.length) return 50;
  return club.players.reduce((s, p) => s + p.overall, 0) / club.players.length;
}
