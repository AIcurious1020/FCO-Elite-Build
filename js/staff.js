// js/staff.js
// Chairman-facing staff, budget, recruitment, and pressure model.

const FIRST = ['Alex', 'Brian', 'Colin', 'David', 'Eddie', 'Frank', 'Graham', 'Kevin', 'Nigel', 'Simon', 'Trevor', 'Victor'];
const LAST = ['Abbott', 'Barker', 'Collins', 'Davies', 'Edwards', 'Fleming', 'Hardy', 'Mason', 'Nolan', 'Phillips', 'Sinclair', 'Watts'];

export const RECRUITMENT_POLICIES = {
  balanced: {
    label: 'Balanced Squad Build',
    text: 'The Director of Football looks for value, squad needs, and sensible wages.',
  },
  prospects: {
    label: 'Young Prospects',
    text: 'Prioritise younger players with resale upside and room to develop.',
  },
  experience: {
    label: 'Proven Experience',
    text: 'Prioritise older, reliable players who can lift the squad immediately.',
  },
  bargains: {
    label: 'Bargain Market',
    text: 'Prioritise affordable deals and lower wages to protect cash flow.',
  },
  promotion_push: {
    label: 'Promotion Push',
    text: 'Prioritise clear upgrades, even if they cost more.',
  },
  wage_control: {
    label: 'Wage Control',
    text: 'Prioritise lower wage impact and avoid expensive contracts.',
  },
};

export const BUDGET_PRIORITIES = {
  balanced: {
    label: 'Balanced Plan',
    text: 'Keep money moving across transfers, wages, and facilities.',
    transfer: 0.38,
    wage: 0.42,
    facilities: 0.20,
  },
  squad: {
    label: 'Squad Investment',
    text: 'Tilt the budget towards recruitment and short-term squad strength.',
    transfer: 0.52,
    wage: 0.36,
    facilities: 0.12,
  },
  facilities: {
    label: 'Facilities First',
    text: 'Protect funds for academy, training, and stadium progress.',
    transfer: 0.26,
    wage: 0.34,
    facilities: 0.40,
  },
  cautious: {
    label: 'Cash Protection',
    text: 'Keep a larger reserve and slow down risky spending.',
    transfer: 0.24,
    wage: 0.30,
    facilities: 0.16,
  },
};

export function createDirectorForClub(club, seed = 1) {
  const rand = makeRng(hash(`${club.id}-${seed}-director`));
  const policyKeys = Object.keys(RECRUITMENT_POLICIES);
  const rating = clamp(Math.round(36 + club.reputation * 5 + rand() * 18), 35, 88);
  return {
    id: `dof-${club.id}-${seed}`,
    name: `${FIRST[Math.floor(rand() * FIRST.length)]} ${LAST[Math.floor(rand() * LAST.length)]}`,
    rating,
    age: 38 + Math.floor(rand() * 24),
    speciality: policyKeys[Math.floor(rand() * policyKeys.length)],
    wage: Math.round((rating * rating * 1.35) / 25) * 25,
    confidence: 60,
  };
}

export function directorMarketForClub(club, season = 1, count = 3) {
  const rand = makeRng(hash(`${club.id}-director-market-${season}-${club.reputation}`));
  const policyKeys = Object.keys(RECRUITMENT_POLICIES);
  return Array.from({ length: count }, (_, i) => {
    const rating = clamp(Math.round(34 + club.reputation * 6 + rand() * 22), 35, 90);
    return {
      id: `dof-cand-${season}-${club.id}-${i}`,
      name: `${FIRST[Math.floor(rand() * FIRST.length)]} ${LAST[Math.floor(rand() * LAST.length)]}`,
      rating,
      age: 36 + Math.floor(rand() * 26),
      speciality: policyKeys[(i + Math.floor(rand() * policyKeys.length)) % policyKeys.length],
      wage: Math.round((rating * rating * 1.45) / 25) * 25,
      confidence: 60,
      compensation: Math.round(rating * 900 * (club.reputation <= 2 ? 0.45 : 0.7) / 1000) * 1000,
    };
  }).sort((a, b) => b.rating - a.rating);
}

export function defaultBoardPlan() {
  return {
    recruitmentPolicy: 'balanced',
    budgetPriority: 'balanced',
    lastManagerMeeting: null,
  };
}

export function recruitmentScore(player, club, fit, policy = 'balanced') {
  const affordable = fit.affordable ? 12 : -24;
  const need = fit.need?.priority === 'urgent' ? 18 : fit.need?.priority === 'upgrade' ? 9 : 0;
  const improvement = Math.max(-8, Math.min(20, fit.improvement)) * 1.4;
  const wageRatioPenalty = fit.wageRatioAfter > 0.8 ? (fit.wageRatioAfter - 0.8) * 45 : 0;
  const value = player.value ? (player.overall * 1000) / player.value : 0;
  let score = 50 + affordable + need + improvement + value * 4 - wageRatioPenalty;

  if (policy === 'prospects') score += player.age <= 23 ? 18 : player.age >= 30 ? -12 : 0;
  if (policy === 'experience') score += player.age >= 26 && player.age <= 32 ? 14 : player.age <= 21 ? -8 : 0;
  if (policy === 'bargains') score += fit.askingPrice <= club.cash * 0.22 ? 18 : -10;
  if (policy === 'promotion_push') score += fit.improvement >= 5 ? 20 : fit.improvement <= 0 ? -12 : 0;
  if (policy === 'wage_control') score += fit.wageRatioAfter < 0.7 ? 16 : -18;
  if (club.director?.speciality === policy) score += 5;

  return clamp(Math.round(score), 1, 100);
}

export function policyRecommendation(score) {
  if (score >= 82) return { label: 'DoF priority', band: 'safe' };
  if (score >= 64) return { label: 'Recommended', band: 'ok' };
  if (score >= 45) return { label: 'Consider', band: 'warning' };
  return { label: 'Avoid', band: 'danger' };
}

export function pressureSnapshot({ club, position, objective, track, fanMood }) {
  let score = 35;
  if (track?.state === 'ontrack') score -= 10;
  if (track?.state === 'close') score += 8;
  if (track?.state === 'offtrack') score += 24;
  if (position <= Math.max(1, (objective?.targetPos || 4) - 1)) score -= 8;
  if (position >= (objective?.divisionSize || 8) - 1) score += 16;
  if (club.played === 0) score = 25;
  if (fanMood?.band === 'danger') score += 14;
  if (fanMood?.band === 'safe') score -= 8;
  score = clamp(score, 0, 100);

  if (score >= 75) return { score, label: 'High pressure', band: 'danger', text: 'Supporters and media expect a visible response.' };
  if (score >= 52) return { score, label: 'Building pressure', band: 'warning', text: 'The mood is watchful, but still manageable.' };
  if (score >= 30) return { score, label: 'Normal scrutiny', band: 'ok', text: 'The club is under ordinary week-to-week attention.' };
  return { score, label: 'Calm', band: 'safe', text: 'Results and expectations are giving the board room to plan.' };
}

export function budgetGuidance(plan, forecast) {
  const priority = BUDGET_PRIORITIES[plan?.budgetPriority || 'balanced'] || BUDGET_PRIORITIES.balanced;
  const spendable = Math.max(0, forecast.transferBudget);
  return {
    priority,
    transferPot: Math.round(spendable * priority.transfer),
    weeklyWageRoom: Math.round(forecast.weeklyWageBudget * priority.wage),
    facilitiesReserve: Math.round(spendable * priority.facilities),
  };
}

export function createStaffReports({ club, market = [], forecast, pressure, track, boardPlan, season = 1, week = 0 }) {
  const reports = [];
  const policy = boardPlan?.recruitmentPolicy || 'balanced';
  const bestTarget = market[0] || null;
  const cashTight = forecast?.risk === 'danger' || forecast?.risk === 'warning' || forecast?.remainingWeeklyWage < 0;
  const expiring = club.players
    .filter(p => (p.contractYears ?? 2) <= 1)
    .sort((a, b) => (a.contractYears ?? 0) - (b.contractYears ?? 0) || b.overall - a.overall)
    .slice(0, 3);

  expiring.forEach(player => {
    const urgent = (player.contractYears ?? 0) <= 0;
    const title = urgent ? `${player.name} contract expires now` : `${player.name} enters final year`;
    reports.push({
      id: `S${season}-contract-${player.id}-${player.contractYears ?? 0}`,
      type: 'renew_contract',
      source: 'Club Secretary',
      title,
      body: `${player.position} ${player.name} is ${player.overall} OVR and worth around £${fmt(player.value)}. Decide whether to renew or sell before leverage slips.`,
      actionLabel: 'Renew contract',
      dismissLabel: 'Defer talks',
      impact: 'Approves a transparent wage rise and extends the player contract.',
      importance: urgent ? 3 : 2,
      payload: { playerId: player.id },
    });
  });

  if (bestTarget) {
    reports.push({
      id: `S${season}-transfer-${bestTarget.id}`,
      type: 'greenlight_transfer',
      source: 'Director of Football',
      title: `${club.director?.name || 'DoF'} recommends ${bestTarget.name}`,
      body: `${bestTarget.position} ${bestTarget.name} fits the current ${RECRUITMENT_POLICIES[policy]?.label || 'balanced'} brief. Approving this opens the transfer list with staff filters ready.`,
      actionLabel: 'Review target list',
      impact: 'Sets transfer filters to affordable targets and opens Transfers.',
      importance: 2,
      payload: { playerId: bestTarget.id },
    });
  }

  if (track?.state === 'offtrack' || pressure?.band === 'danger') {
    reports.push({
      id: `S${season}-manager-backing`,
      type: 'back_manager',
      source: 'Board Secretary',
      title: 'Manager backing requested',
      body: `${club.manager?.name || 'The head coach'} is working under pressure. A public statement can steady the dressing room without changing tactics.`,
      actionLabel: 'Back manager',
      impact: 'Raises manager confidence and creates a boardroom story.',
      importance: 2,
      payload: {},
    });
  }

  if (cashTight) {
    reports.push({
      id: `S${season}-spending-control`,
      type: 'tighten_spending',
      source: 'Finance Director',
      title: 'Spending control advised',
      body: `${forecast.label}. Moving to cash protection reduces short-term risk without forcing emergency sales.`,
      actionLabel: 'Tighten spending',
      impact: 'Switches budget priority to Cash Protection.',
      importance: 2,
      payload: { priority: 'cautious' },
    });
  }

  if (pressure?.band === 'warning' || pressure?.band === 'danger') {
    reports.push({
      id: `S${season}-pressure-response`,
      type: 'pressure_response',
      source: 'Media Officer',
      title: 'Supporter message recommended',
      body: `${pressure.label}: ${pressure.text} A calm chairman statement can buy time for the current plan.`,
      actionLabel: 'Address supporters',
      impact: 'Slightly improves board confidence and records a media story.',
      importance: pressure.band === 'danger' ? 3 : 1,
      payload: {},
    });
  }

  if (policy === 'balanced' && club.played >= 4) {
    const suggested = track?.state === 'ontrack' ? 'promotion_push' : cashTight ? 'wage_control' : 'bargains';
    reports.push({
      id: `S${season}-scout-focus-${suggested}`,
      type: 'scout_policy',
      source: 'Recruitment Team',
      title: `${RECRUITMENT_POLICIES[suggested].label} scouting focus`,
      body: `The current season trend suggests a more specific recruitment brief than Balanced Squad Build.`,
      actionLabel: 'Approve focus',
      impact: `Changes recruitment policy to ${RECRUITMENT_POLICIES[suggested].label}.`,
      importance: 1,
      payload: { policy: suggested },
    });
  }

  return reports;
}

function fmt(n) {
  return Math.round(n).toLocaleString('en-GB');
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
