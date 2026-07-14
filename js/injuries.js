// js/injuries.js
// Lightweight injury and availability system. Injuries are bounded and visible:
// they reduce selection depth without creating harsh random spirals.

const INJURIES = [
  { name: 'minor knock', min: 1, max: 1 },
  { name: 'muscle strain', min: 2, max: 3 },
  { name: 'ankle sprain', min: 2, max: 4 },
  { name: 'hamstring issue', min: 3, max: 5 },
];

export function processWeeklyInjuries(results) {
  const stories = [];
  const involved = new Set();
  results.forEach(r => {
    involved.add(r.home);
    involved.add(r.away);
  });

  involved.forEach(club => {
    recoverPlayers(club, stories);
  });

  results.forEach(r => {
    maybeInjureFromMatch(r.home, stories);
    maybeInjureFromMatch(r.away, stories);
  });

  return stories;
}

export function availablePlayers(club) {
  return club.players.filter(p => p.available !== false);
}

export function injuredPlayers(club) {
  return club.players.filter(p => p.available === false);
}

export function availabilityByPosition(club) {
  const positions = ['GK', 'DEF', 'MID', 'FWD'];
  return positions.map(position => ({
    position,
    available: availablePlayers(club).filter(p => p.position === position).length,
    total: club.players.filter(p => p.position === position).length,
  }));
}

export function missingStarters(club) {
  return club.players
    .filter(p => p.available === false)
    .sort((a, b) => b.overall - a.overall)
    .slice(0, 3);
}

function recoverPlayers(club, stories) {
  club.players.forEach(player => {
    if (player.available !== false) return;
    const recoveryBoost = club.training >= 4 && Math.random() < 0.25 ? 2 : 1;
    player.injuryWeeks = Math.max(0, player.injuryWeeks - recoveryBoost);
    if (player.injuryWeeks === 0) {
      const injury = player.injury;
      player.injury = null;
      stories.push({
        club,
        player,
        kind: 'return',
        injury,
      });
    }
  });
}

function maybeInjureFromMatch(club, stories) {
  const eligible = availablePlayers(club);
  if (eligible.length <= 13) return;
  const baseChance = 0.055;
  const trainingReduction = Math.max(0, club.training - 1) * 0.006;
  if (Math.random() > Math.max(0.025, baseChance - trainingReduction)) return;

  const player = eligible[Math.floor(Math.random() * eligible.length)];
  const injury = INJURIES[Math.floor(Math.random() * INJURIES.length)];
  const weeks = injury.min + Math.floor(Math.random() * (injury.max - injury.min + 1));
  player.injuryWeeks = weeks;
  player.injury = injury.name;
  player.form = Math.max(0.85, +(player.form - 0.04).toFixed(3));
  stories.push({
    club,
    player,
    kind: 'injury',
    injury: injury.name,
    weeks,
  });
}
