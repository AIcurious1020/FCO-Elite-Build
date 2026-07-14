// js/manager.js
// Chairman-facing manager model. The chairman hires and directs; the manager's
// style turns that broad direction into match tactics.

const FIRST = ['Alan', 'Chris', 'Darren', 'Lee', 'Martin', 'Neil', 'Paul', 'Steve', 'Tony', 'Gareth', 'Mark', 'Ian'];
const LAST = ['Cooper', 'Hughes', 'Bennett', 'Foster', 'Dawson', 'Morris', 'Reid', 'Walsh', 'Turner', 'Lowe', 'Grant', 'Parker'];

export const MANAGER_STYLES = {
  balanced: {
    label: 'Balanced',
    text: 'Keeps the side structured without ignoring attacking chances.',
    tactics: { mentality: 'balanced', pressing: 'medium' },
  },
  pragmatic: {
    label: 'Pragmatic',
    text: 'Prioritises points, defensive shape, and sensible risk.',
    tactics: { mentality: 'defensive', pressing: 'medium' },
  },
  attacking: {
    label: 'Attacking',
    text: 'Wants front-foot football and accepts defensive trade-offs.',
    tactics: { mentality: 'attacking', pressing: 'medium' },
  },
  high_press: {
    label: 'High Press',
    text: 'Aggressive pressing, more chances created, more space conceded.',
    tactics: { mentality: 'attacking', pressing: 'high' },
  },
  youth: {
    label: 'Youth Developer',
    text: 'Patient coach who favours development and squad value growth.',
    tactics: { mentality: 'balanced', pressing: 'medium' },
  },
};

export const CHAIRMAN_DIRECTIVES = {
  trust: {
    label: 'Trust the Manager',
    text: 'Let the manager use their preferred football identity.',
  },
  cautious: {
    label: 'Protect Results',
    text: 'Ask for a little more caution when the club needs stability.',
  },
  ambitious: {
    label: 'Push for Promotion',
    text: 'Encourage more attacking intent when the squad can handle it.',
  },
  youth: {
    label: 'Prioritise Youth',
    text: 'Accept some short-term patience for development upside.',
  },
};

export function createManagerForClub(club, seed = 1) {
  const rand = makeRng(hash(`${club.id}-${seed}-manager`));
  const styleKeys = Object.keys(MANAGER_STYLES);
  const style = styleKeys[Math.floor(rand() * styleKeys.length)];
  const rating = clamp(Math.round(38 + club.reputation * 5 + rand() * 16), 35, 86);
  return {
    id: `mgr-${club.id}-${seed}`,
    name: `${FIRST[Math.floor(rand() * FIRST.length)]} ${LAST[Math.floor(rand() * LAST.length)]}`,
    age: 35 + Math.floor(rand() * 25),
    style,
    rating,
    personality: personalityFor(rand()),
    contractYears: 2 + Math.floor(rand() * 3),
    wage: Math.round((rating * rating * 1.8) / 25) * 25,
    confidence: 60,
    directive: 'trust',
  };
}

export function availableManagersForClub(club, season = 1, count = 4) {
  const rand = makeRng(hash(`${club.id}-market-${season}-${club.reputation}`));
  const styles = Object.keys(MANAGER_STYLES);
  const list = [];
  for (let i = 0; i < count; i++) {
    const style = styles[(i + Math.floor(rand() * styles.length)) % styles.length];
    const rating = clamp(Math.round(34 + club.reputation * 6 + rand() * 20), 35, 90);
    const manager = {
      id: `mgr-cand-${season}-${club.id}-${i}`,
      name: `${FIRST[Math.floor(rand() * FIRST.length)]} ${LAST[Math.floor(rand() * LAST.length)]}`,
      age: 33 + Math.floor(rand() * 28),
      style,
      rating,
      personality: personalityFor(rand()),
      contractYears: 2 + Math.floor(rand() * 3),
      wage: Math.round((rating * rating * 1.9) / 25) * 25,
      confidence: 60,
      directive: 'trust',
    };
    manager.compensation = managerCompensation(manager, club);
    list.push(manager);
  }
  return list.sort((a, b) => b.rating - a.rating);
}

export function managerTactics(manager) {
  const style = MANAGER_STYLES[manager?.style] || MANAGER_STYLES.balanced;
  const directive = manager?.directive || 'trust';
  const base = { ...style.tactics };

  if (directive === 'cautious') {
    base.mentality = base.mentality === 'attacking' ? 'balanced' : 'defensive';
    base.pressing = base.pressing === 'high' ? 'medium' : base.pressing;
  }
  if (directive === 'ambitious') {
    base.mentality = base.mentality === 'defensive' ? 'balanced' : 'attacking';
  }
  if (directive === 'youth') {
    base.pressing = base.pressing === 'high' ? 'medium' : base.pressing;
  }
  return base;
}

export function applyManagerTactics(club) {
  club.tactics = managerTactics(club.manager);
  return club.tactics;
}

export function managerCompensation(manager, club) {
  const annualWage = (manager?.wage || 0) * 52;
  const contractCost = annualWage * Math.max(1, manager?.contractYears || 1) * 0.35;
  const scale = club.reputation <= 2 ? 0.45 : club.reputation <= 4 ? 0.65 : 1;
  return Math.round(contractCost * scale / 1000) * 1000;
}

export function managerFit(manager, club) {
  if (!manager) return 50;
  const avgAge = club.players.reduce((s, p) => s + p.age, 0) / Math.max(1, club.players.length);
  let score = manager.rating;
  if (manager.style === 'youth' && (club.academy >= 2 || avgAge <= 25)) score += 8;
  if (manager.style === 'pragmatic' && club.reputation <= 2) score += 6;
  if (manager.style === 'attacking' && avgOverall(club) >= 48) score += 5;
  if (manager.style === 'high_press' && club.training >= 3) score += 6;
  return clamp(Math.round(score), 1, 100);
}

export function managerStatus(manager, club) {
  const fit = managerFit(manager, club);
  if (!manager) return { label: 'Interim', band: 'warning', text: 'The club needs to confirm a permanent head coach.' };
  if (manager.confidence < 35) return { label: 'Under pressure', band: 'danger', text: 'Results and confidence are putting the manager at risk.' };
  if (fit >= 75) return { label: 'Strong fit', band: 'safe', text: 'The manager profile fits the squad and club direction.' };
  if (fit >= 58) return { label: 'Stable', band: 'ok', text: 'The manager is a workable fit for the current stage.' };
  return { label: 'Questionable fit', band: 'warning', text: 'The style may not fully suit the squad or facilities.' };
}

function avgOverall(club) {
  if (!club.players.length) return 0;
  return club.players.reduce((s, p) => s + p.overall, 0) / club.players.length;
}

function personalityFor(n) {
  if (n < 0.2) return 'Calm';
  if (n < 0.4) return 'Demanding';
  if (n < 0.6) return 'Developer';
  if (n < 0.8) return 'Ambitious';
  return 'Pragmatic';
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
