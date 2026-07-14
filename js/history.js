// js/history.js
// Club memory: season history, honours, records, fan mood, and identity.

export function createClubHistory(club) {
  return {
    foundedSeason: 1,
    startingDivision: club.division,
    seasons: [],
    honours: [],
    records: {
      highestFinish: null,
      bestPoints: null,
      biggestWin: null,
      biggestLoss: null,
      recordSigning: null,
      recordSale: null,
      highestReputation: club.reputation,
      highestBalance: club.cash,
    },
  };
}

export function buildSeasonMemory({ season, club, divisionName, finalPos, divisionSize, objective, grading, move, pnl }) {
  const champion = finalPos === 1;
  const promoted = move?.type === 'promoted';
  const relegated = move?.type === 'relegated';
  const honour = champion ? `Won ${divisionName}` : promoted ? `Promoted from ${divisionName}` : null;

  return {
    season,
    division: club.division,
    divisionName,
    finalPos,
    divisionSize,
    played: club.played,
    won: club.won,
    drawn: club.drawn,
    lost: club.lost,
    gf: club.gf,
    ga: club.ga,
    points: club.points,
    objective: objective?.label || 'No objective',
    grade: grading.grade,
    gradeMessage: grading.message,
    move: move?.type || null,
    profit: pnl.profit,
    balance: pnl.balance,
    reputation: club.reputation,
    honour,
    summary: seasonSummary(finalPos, divisionSize, divisionName, grading.grade, move),
  };
}

export function applySeasonMemory(history, memory, lastResults = []) {
  const next = history || { seasons: [], honours: [], records: {} };
  next.seasons = [...(next.seasons || []), memory];
  if (memory.honour) {
    next.honours = [...(next.honours || []), { season: memory.season, label: memory.honour }];
  }
  next.records = updateRecords(next.records || {}, memory, lastResults);
  return next;
}

export function fanMood(history, confidence, lastMemory = null) {
  const latest = lastMemory || history?.seasons?.at(-1);
  if (!latest) return { label: 'Curious', band: 'ok', text: 'Supporters are waiting to see what this ownership era becomes.' };
  if (latest.move === 'promoted' || latest.grade === 'exceeded') {
    return { label: 'Buzzing', band: 'safe', text: 'Supporters believe the club is moving in the right direction.' };
  }
  if (latest.move === 'relegated' || latest.grade === 'badly' || confidence < 30) {
    return { label: 'Restless', band: 'danger', text: 'Supporters want a response after a difficult season.' };
  }
  if (latest.grade === 'missed' || confidence < 50) {
    return { label: 'Concerned', band: 'warning', text: 'Supporters can see progress, but patience is not unlimited.' };
  }
  return { label: 'Content', band: 'ok', text: 'Supporters feel the club is being run sensibly.' };
}

export function clubIdentity(history, club) {
  const seasons = history?.seasons || [];
  const promotions = seasons.filter(s => s.move === 'promoted').length;
  const profitSeasons = seasons.filter(s => s.profit >= 0).length;
  const honours = history?.honours?.length || 0;
  if (honours >= 3 || club.reputation >= 8) return 'Elite force';
  if (promotions >= 1) return 'Fast climber';
  if (profitSeasons >= Math.max(2, seasons.length - 1) && seasons.length >= 2) return 'Sustainable builder';
  if (club.academy >= 4) return 'Talent factory';
  if (club.training >= 4) return 'Development club';
  return 'Ambitious project';
}

function updateRecords(records, memory, results) {
  const next = { ...records };
  const finishScore = { division: memory.division, finalPos: memory.finalPos, season: memory.season, divisionName: memory.divisionName };
  if (!next.highestFinish || memory.division < next.highestFinish.division ||
      (memory.division === next.highestFinish.division && memory.finalPos < next.highestFinish.finalPos)) {
    next.highestFinish = finishScore;
  }
  if (!next.bestPoints || memory.points > next.bestPoints.points) {
    next.bestPoints = { season: memory.season, points: memory.points, divisionName: memory.divisionName };
  }
  next.highestReputation = Math.max(next.highestReputation || 0, memory.reputation);
  next.highestBalance = Math.max(next.highestBalance || 0, memory.balance);

  for (const r of results || []) {
    const margin = Math.abs(r.homeGoals - r.awayGoals);
    if (!margin) continue;
    const userHome = r.home.isUser;
    const userAway = r.away.isUser;
    if (!userHome && !userAway) continue;
    const userGoals = userHome ? r.homeGoals : r.awayGoals;
    const oppGoals = userHome ? r.awayGoals : r.homeGoals;
    const opponent = userHome ? r.away.name : r.home.name;
    const record = { season: memory.season, score: `${userGoals}-${oppGoals}`, opponent, margin };
    if (userGoals > oppGoals && (!next.biggestWin || margin > next.biggestWin.margin)) next.biggestWin = record;
    if (userGoals < oppGoals && (!next.biggestLoss || margin > next.biggestLoss.margin)) next.biggestLoss = record;
  }

  return next;
}

function seasonSummary(finalPos, divisionSize, divisionName, grade, move) {
  if (move?.type === 'promoted') return `Promotion secured from ${divisionName}.`;
  if (move?.type === 'relegated') return `Relegated after finishing ${ordinal(finalPos)} in ${divisionName}.`;
  if (finalPos === 1) return `Champions of ${divisionName}.`;
  if (finalPos <= Math.ceil(divisionSize / 2)) return `Top-half finish in ${divisionName}.`;
  if (grade === 'met') return `Objective met with a steady ${divisionName} campaign.`;
  return `Finished ${ordinal(finalPos)} in ${divisionName}.`;
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
