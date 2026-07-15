// js/objectives.js
// Board & manager objectives — transparent, fair season targets set by the board.
//
// Design principles (matching the project's fairness pillars):
//   - The target is ALWAYS visible, division-aware, and explained in plain words.
//   - Grading is transparent: Exceeded / Met / Missed / Badly missed, with the
//     exact finishing position vs the target shown.
//   - Job security is NEVER a surprise: board confidence is a visible 0–100 bar.
//     One bad season warns; it takes TWO consecutive "badly missed" seasons to
//     trigger forced-out pressure, and the warning is signposted a full season ahead.
//   - No death spiral: a good recovery season immediately restores confidence.

import { DIVISIONS, TOP_DIVISION, BOTTOM_DIVISION } from './data.js';
import { divisionStandings } from './pyramid.js';

export const START_CONFIDENCE = 60;   // board confidence at game start (0–100)
export const SACK_THRESHOLD = 15;     // below this after a bad season → forced-out pressure

// Objective "kinds" — each maps a division context to a target finishing rank.
// targetPos = the WORST acceptable finishing position (<= means success).
const KIND = {
  survive:      { key: 'survive',      label: 'Avoid relegation',      tone: 'defensive' },
  consolidate:  { key: 'consolidate',  label: 'Consolidate mid-table', tone: 'steady' },
  topHalf:      { key: 'topHalf',      label: 'Finish in the top half', tone: 'steady' },
  promotion:    { key: 'promotion',    label: 'Push for promotion',    tone: 'ambitious' },
  title:        { key: 'title',        label: 'Win the division',      tone: 'ambitious' },
  compete:      { key: 'compete',      label: 'Compete near the top',  tone: 'ambitious' },
};

/**
 * Decide this season's league objective from the club's situation.
 * @param {Club} club              the user's club
 * @param {boolean} justMoved      true if promoted/relegated into this division last rollover
 * @param {number} divisionSize    clubs in the division (usually 8)
 */
export function setLeagueObjective(club, justMoved, divisionSize = 8) {
  const div = club.division;
  const rep = club.reputation;
  const relegZone = divisionSize - 1; // bottom 2 relegate; "safe" means <= size-2

  let kind, targetPos, reason;

  if (justMoved === 'relegated') {
    // Freshly relegated: the board just wants a stable rebuild.
    kind = KIND.consolidate;
    targetPos = Math.ceil(divisionSize / 2) + 1; // roughly mid-table or better
    reason = 'After the drop, the board wants a solid, stable season.';
  } else if (justMoved === 'promoted') {
    // Freshly promoted: survival is the honest goal after stepping up.
    kind = KIND.survive;
    targetPos = divisionSize - 2; // stay out of the bottom 2
    reason = 'Newly promoted — the board simply wants to stay up.';
  } else if (div === BOTTOM_DIVISION) {
    // Bottom tier: ambition scales with reputation.
    if (rep >= 4) { kind = KIND.promotion; targetPos = 2; reason = 'Strong squad — the board expects promotion.'; }
    else if (rep >= 2.5) { kind = KIND.topHalf; targetPos = Math.ceil(divisionSize / 2); reason = 'The board wants a top-half push.'; }
    else { kind = KIND.consolidate; targetPos = Math.ceil(divisionSize / 2) + 1; reason = 'A modest, steady season is expected.'; }
  } else if (div === TOP_DIVISION) {
    // Top tier: no promotion above, so target the honours / European-style places.
    if (rep >= 7) { kind = KIND.title; targetPos = 1; reason = 'A giant of the game — the board demands the title.'; }
    else if (rep >= 5) { kind = KIND.compete; targetPos = 3; reason = 'The board wants a top-3 challenge.'; }
    else { kind = KIND.survive; targetPos = divisionSize - 2; reason = 'Among the elite — survival is the first goal.'; }
  } else {
    // Middle division(s): reputation-driven ambition.
    if (rep >= 5) { kind = KIND.promotion; targetPos = 2; reason = 'The board expects a promotion charge.'; }
    else if (rep >= 3) { kind = KIND.topHalf; targetPos = Math.ceil(divisionSize / 2); reason = 'A top-half finish is the target.'; }
    else { kind = KIND.consolidate; targetPos = Math.ceil(divisionSize / 2) + 1; reason = 'Consolidate and build for the future.'; }
  }

  return {
    kind: kind.key,
    label: kind.label,
    tone: kind.tone,
    targetPos,
    relegZone,
    reason,
    divisionName: DIVISIONS[div].name,
    divisionSize,
  };
}

/**
 * The finance objective is a simple, advisory guardrail: don't end the season
 * bankrupt and keep the wage bill from spiralling. Never an instant game-over.
 */
export function setFinanceObjective() {
  return {
    label: 'Stay financially healthy',
    detail: 'Finish the season with positive cash and wages under control.',
  };
}

/**
 * Grade the league objective after the season, given the final position.
 * Returns { grade, delta, message } where delta adjusts board confidence.
 *   grade ∈ 'exceeded' | 'met' | 'missed' | 'badly'
 */
export function gradeLeagueObjective(objective, finalPos) {
  const { targetPos, label, divisionSize } = objective;
  let grade, delta, message;

  if (finalPos <= Math.max(1, targetPos - 2)) {
    grade = 'exceeded';
    delta = +18;
    message = `Objective smashed — "${label}" (finished ${ordinal(finalPos)}, target ${ordinal(targetPos)} or better).`;
  } else if (finalPos <= targetPos) {
    grade = 'met';
    delta = +8;
    message = `Objective met — "${label}" (finished ${ordinal(finalPos)}).`;
  } else if (finalPos <= targetPos + 2 && finalPos < divisionSize - 1) {
    grade = 'missed';
    delta = -12;
    message = `Objective missed — "${label}" (finished ${ordinal(finalPos)}, needed ${ordinal(targetPos)}).`;
  } else {
    grade = 'badly';
    delta = -28;
    message = `Objective badly missed — "${label}" (finished ${ordinal(finalPos)}).`;
  }

  return { grade, delta, message };
}

/**
 * Apply a confidence change (clamped 0–100) and compute the resulting chairman status.
 * badlyMissedStreak tracks consecutive "badly" grades for the two-strike rule.
 */
export function applyConfidence(confidence, delta, grade, badlyStreak) {
  const next = Math.max(0, Math.min(100, Math.round(confidence + delta)));
  const streak = grade === 'badly' ? badlyStreak + 1 : 0;

  let status = 'secure';
  let jobMessage = '';
  let sacked = false;

  if (streak >= 2 || next < SACK_THRESHOLD) {
    // Two consecutive disasters, OR confidence collapsed — ownership pressure escalates.
    sacked = true;
    status = 'forced_out';
    jobMessage = 'Your position as chairman is under formal pressure after a prolonged failure to improve.';
  } else if (next < 30 || grade === 'badly') {
    status = 'at_risk';
    jobMessage = 'The board is unhappy. Deliver next season or your chairmanship is at risk.';
  } else if (next < 50) {
    status = 'watch';
    jobMessage = 'The board expects improvement.';
  } else {
    status = 'secure';
    jobMessage = 'The board backs you.';
  }

  return { confidence: next, badlyStreak: streak, status, jobMessage, sacked };
}

/**
 * Live "on track" check DURING a season: compares current position with target.
 * Used for the dashboard's traffic-light indicator.
 */
export function trackStatus(objective, currentPos, played) {
  if (!objective) return { state: 'unknown', text: 'No objective set.' };
  if (played === 0) return { state: 'pending', text: 'Season not started.' };
  if (currentPos <= objective.targetPos) {
    return { state: 'ontrack', text: `On track — ${ordinal(currentPos)}, target ${ordinal(objective.targetPos)} or better.` };
  }
  if (currentPos <= objective.targetPos + 2) {
    return { state: 'close', text: `Just off target — ${ordinal(currentPos)}, need ${ordinal(objective.targetPos)}.` };
  }
  return { state: 'offtrack', text: `Off track — ${ordinal(currentPos)}, target ${ordinal(objective.targetPos)}.` };
}

/** Confidence descriptor for the UI. */
export function confidenceLabel(c) {
  if (c >= 75) return { label: 'Full backing', band: 'safe' };
  if (c >= 50) return { label: 'Supportive', band: 'ok' };
  if (c >= 30) return { label: 'Concerned', band: 'warning' };
  return { label: 'Losing faith', band: 'danger' };
}

// Small local ordinal helper (kept here so the module is self-contained).
function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
