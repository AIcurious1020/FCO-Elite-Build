// js/app.js
// Main controller: global state, tab routing, rendering, game loop, save/load.

import { createLeague, DIVISIONS, TOP_DIVISION, BOTTOM_DIVISION } from './data.js';
import { Club, teamRatings } from './club.js';
import { Player } from './player.js';
import { simulateMatch, HOME_BONUS, outcomeProbabilities } from './match.js';
import { generateFixtures, playMatchweek, recordResult, standings } from './league.js';
import {
  financialHealth, applySeasonFinances,
  financeForecast, stadiumExpansionPlan, ticketPricePlan, infrastructureUpgradePlan,
} from './finance.js';
import {
  generateMarket, evaluateBid, completeTransferIn, sellPlayer,
  squadNeeds, transferFit, projectedWageRatio,
} from './transfers.js';
import {
  clubsInDivision, divisionStandings, autoSimulateDivision,
  applyPromotionRelegation, PROMOTE, RELEGATE,
} from './pyramid.js';
import {
  setLeagueObjective, setFinanceObjective, gradeLeagueObjective,
  applyConfidence, trackStatus, confidenceLabel,
  START_CONFIDENCE,
} from './objectives.js';
import {
  developSquad, generateAcademyIntake, summariseDevelopment,
} from './development.js';
import {
  createClubHistory, buildSeasonMemory, applySeasonMemory, fanMood, clubIdentity,
} from './history.js';
import {
  matchStory, divisionStory, transferMarketStory, transferCompletedStory,
  infrastructureStory, seasonReviewStories, objectiveStory, injuryStory,
  cupStory, cupRoundStory, cupDrawStory, rivalTransferStory, clubsToWatchStory,
  managerAppointmentStory, managerDirectiveStory,
  boardroomPolicyStory, directorAppointmentStory, pressureStory,
  staffDecisionStory,
} from './news.js';
import {
  processWeeklyInjuries, injuredPlayers, availabilityByPosition, missingStarters,
} from './injuries.js';
import {
  createCup, cupCurrentRound, cupStatus, playCupRound, cupRoundFixture,
} from './cup.js';
import {
  availableManagersForClub, applyManagerTactics, CHAIRMAN_DIRECTIVES,
  MANAGER_STYLES, managerCompensation, managerFit, managerStatus,
} from './manager.js';
import {
  createDirectorForClub, directorMarketForClub, defaultBoardPlan,
  RECRUITMENT_POLICIES, BUDGET_PRIORITIES, recruitmentScore,
  policyRecommendation, pressureSnapshot, budgetGuidance, createStaffReports,
} from './staff.js';
import {
  contractDemand, contractStatus, expiringPlayers, renewPlayerContract, tickContracts,
} from './contracts.js';

// v3 save schema (multi-division + board objectives). Older saves are
// incompatible, so they are simply ignored and a fresh pyramid game starts.
const SAVE_KEY = 'fco-elite-save-v3';

const state = {
  league: null,
  fixtures: [],
  currentWeek: 0,   // index into fixtures
  season: 1,
  market: [],
  transferFilters: { position: 'ALL', affordableOnly: false },
  currentTab: 'dashboard',
  lastResults: [],
  // Board & manager objectives
  objective: null,        // current league objective (see objectives.js)
  financeObjective: null, // advisory finance guardrail
  confidence: START_CONFIDENCE, // board confidence 0–100
  badlyStreak: 0,         // consecutive "badly missed" seasons (two-strike forced-out rule)
  jobStatus: 'secure',    // secure | watch | at_risk | forced_out
  fanTrust: 60,           // supporter trust in the chairman, 0-100
  lastReview: null,       // last end-of-season board review (for the dashboard)
  lastMove: null,         // 'promoted' | 'relegated' | null — how we arrived this season
  inbox: [],              // season hub messages shown on the dashboard
  developmentReport: null,
  financeReport: null,
  clubHistory: null,
  cup: null,
  lastCupResults: [],
  seasonCalendar: [],
  currentEvent: 0,
  resultMemory: [],
  worldActivity: [],
  managerMarket: [],
  directorMarket: [],
  boardPlan: defaultBoardPlan(),
  decisions: [],
  chairmanProfile: null,
  transferRecommendations: null,
  outgoingOffers: [],
};

/* ------------------------------------------------------------------ */
/* Bootstrap                                                          */
/* ------------------------------------------------------------------ */
function init() {
  setupTabs();
  setupGlobalButtons();
  if (load()) {
    setNavEnabled(true);
    render();
  } else {
    showClubSelection();
  }
}

function newGame(userClubId = 'solihull') {
  const lg = createLeague(userClubId);
  state.league = lg;
  const uc = lg.clubsById[lg.userClubId];
  // Only the user's own division plays interactively; other divisions are
  // auto-simulated at season end.
  state.fixtures = generateFixtures(clubsInDivision(lg.clubs, uc.division));
  state.currentWeek = 0;
  state.season = 1;
  state.boardPlan = defaultBoardPlan();
  state.chairmanProfile = defaultChairmanProfile();
  ensureClubStaff(lg.clubs, state.season);
  state.market = guidedMarket(uc);
  state.transferRecommendations = null;
  state.lastResults = [];
  // Board objectives for the opening season.
  state.confidence = START_CONFIDENCE;
  state.badlyStreak = 0;
  state.jobStatus = 'secure';
  state.fanTrust = 60;
  state.lastMove = null;
  state.lastReview = null;
  state.developmentReport = null;
  state.financeReport = null;
  state.clubHistory = createClubHistory(uc);
  state.cup = createCup(lg.clubs, state.season);
  state.lastCupResults = [];
  state.seasonCalendar = buildSeasonCalendar(state.fixtures, state.cup, state.season);
  state.currentEvent = 0;
  state.resultMemory = [];
  state.worldActivity = [];
  state.managerMarket = availableManagersForClub(uc, state.season);
  state.directorMarket = directorMarketForClub(uc, state.season);
  state.decisions = [];
  state.outgoingOffers = [];
  state.objective = setLeagueObjective(uc, null, clubsInDivision(lg.clubs, uc.division).length);
  state.financeObjective = setFinanceObjective();
  state.inbox = [];
  addStory(objectiveStory(state.objective));
  addStory({ title: 'Finance guardrail agreed', body: state.financeObjective.detail, type: 'finance', category: 'Finance', importance: 1 });
  addStory(transferMarketStory(state.market, uc));
  refreshDealRoomRecommendations(uc, 'season-start');
  generateDecisionReports('season-start');
}

function showClubSelection() {
  const previewLeague = createLeague(null);
  const candidates = clubsInDivision(previewLeague.clubs, BOTTOM_DIVISION);
  state.league = null;
  state.currentTab = 'dashboard';
  setNavEnabled(false);
  document.querySelectorAll('.tab-content').forEach(s => { s.hidden = s.id !== 'dashboard'; });
  updateNavDecisionBadge();
  document.getElementById('headerClubName').textContent = 'Choose your club';
  document.getElementById('headerCash').textContent = 'New career';
  document.getElementById('dashboard').innerHTML = `
    <div class="card">
      <h2>Start New Career</h2>
      <p class="muted small">Choose a National League club to build from the lower tiers into a global force. Every option starts with different cash, reputation, stadium size, and squad strength.</p>
    </div>
    <div class="club-select-grid">
      ${candidates.map(club => renderClubChoice(club)).join('')}
    </div>`;

  document.querySelectorAll('[data-start-club]').forEach(btn => {
    btn.addEventListener('click', () => {
      newGame(btn.dataset.startClub);
      setNavEnabled(true);
      switchTab('dashboard');
    });
  });
}

function renderClubChoice(club) {
  const avg = avgOverall(club);
  return `<article class="card club-choice">
    <div class="flex-between">
      <div>
        <h2 class="mb0">${club.name}</h2>
        <p class="muted small">${DIVISIONS[club.division].name} · Reputation ${club.reputation}/10</p>
      </div>
      <span class="pill obj-${club.reputation <= 1 ? 'pending' : 'close'}">${club.short}</span>
    </div>
    <div class="stat-row mt">
      <div class="stat"><strong>Cash</strong><span>£${fmt(club.cash)}</span></div>
      <div class="stat"><strong>Stadium</strong><span>${fmt(club.stadiumCapacity)}</span></div>
      <div class="stat"><strong>Squad Avg</strong><span>${avg}</span></div>
    </div>
    <p class="muted small mt">${careerDifficultyText(club, avg)}</p>
    <button class="btn btn-lg mt" data-start-club="${club.id}">Start with ${club.short}</button>
  </article>`;
}

function careerDifficultyText(club, avg) {
  if (club.cash <= 300_000 || avg <= 43) return 'Hard build: limited funds and a squad that needs careful development.';
  if (club.cash >= 800_000 || avg >= 47) return 'Strong platform: more resources, but expectations will rise quickly.';
  return 'Balanced project: enough stability to plan, still plenty to improve.';
}

function ensureClubManagers(clubs, season = state.season || 1) {
  clubs.forEach((club, i) => {
    if (!club.manager) {
      club.manager = availableManagersForClub(club, season, 1)[0];
      club.manager.id = `mgr-${club.id}-retro-${i}`;
    }
    club.manager.directive = club.manager.directive || 'trust';
    applyManagerTactics(club);
  });
}

function ensureClubStaff(clubs, season = state.season || 1) {
  clubs.forEach((club, i) => {
    if (!club.director) {
      club.director = createDirectorForClub(club, season + i);
    }
  });
}

function userClub() {
  return state.league.clubsById[state.league.userClubId];
}

function userDivision() {
  return userClub().division;
}

// Clubs in the user's current division (for tables, fixtures, dashboard).
function myDivisionClubs() {
  return clubsInDivision(state.league.clubs, userDivision());
}

function buildSeasonCalendar(fixtures, cup, season) {
  const events = [];
  const seasonStart = new Date(Date.UTC(2026 + season - 1, 7, 3));
  fixtures.forEach((week, i) => {
    events.push({
      id: `S${season}-L${week.week}`,
      type: 'league',
      label: `League Matchweek ${week.week}`,
      week: week.week,
      date: formatGameDate(addDays(seasonStart, i * 7 + 3)),
      sort: i * 10 + 3,
      played: !!week.played,
    });
  });
  (cup?.rounds || []).forEach((round, i) => {
    const slot = Math.max(0, round.unlockWeek - 1) * 10 + 1;
    events.push({
      id: `S${season}-C${i}`,
      type: 'cup',
      label: round.name,
      roundIndex: i,
      date: formatGameDate(addDays(seasonStart, Math.max(0, round.unlockWeek - 1) * 7 + 1)),
      sort: slot,
      played: !!round.played,
    });
  });
  return events.sort((a, b) => a.sort - b.sort);
}

function syncSeasonCalendar() {
  if (!state.seasonCalendar?.length) {
    state.seasonCalendar = buildSeasonCalendar(state.fixtures, state.cup, state.season);
  }
  state.seasonCalendar.forEach(event => {
    if (event.type === 'league') {
      event.played = !!state.fixtures.find(w => w.week === event.week)?.played;
    } else if (event.type === 'cup') {
      event.played = !!state.cup?.rounds?.[event.roundIndex]?.played;
    }
    if (event.played && !event.result) {
      const memory = state.resultMemory.find(r => r.date === event.date && r.round === event.label);
      if (memory) event.result = calendarResultSummary(memory);
    }
  });
}

function nextCalendarIndex() {
  syncSeasonCalendar();
  const idx = state.seasonCalendar.findIndex(e => !e.played);
  return idx === -1 ? state.seasonCalendar.length : idx;
}

function nextCalendarEvent() {
  state.currentEvent = nextCalendarIndex();
  return state.seasonCalendar[state.currentEvent] || null;
}

function rememberResult(event, result, context = {}) {
  const uc = userClub();
  const isHome = result.home === uc;
  const involved = result.home === uc || result.away === uc;
  const userGoals = isHome ? result.homeGoals : result.awayGoals;
  const oppGoals = isHome ? result.awayGoals : result.homeGoals;
  const opponent = isHome ? result.away : result.home;
  const won = context.cup ? result.winner === uc : userGoals > oppGoals;
  const drew = !context.cup && userGoals === oppGoals;
  const memory = {
    id: `${event.id}-${Date.now()}`,
    season: state.season,
    date: event.date,
    type: event.type,
    competition: context.competition || (event.type === 'cup' ? state.cup.name : 'League'),
    round: context.roundName || event.label,
    home: result.home.id,
    away: result.away.id,
    homeGoals: result.homeGoals,
    awayGoals: result.awayGoals,
    winner: result.winner?.id || null,
    opponent: involved ? opponent.id : null,
    involved,
    outcome: involved ? won ? 'W' : drew ? 'D' : 'L' : null,
    xg: result.xg,
    tiebreak: result.tiebreak || null,
  };
  state.resultMemory.unshift(memory);
  state.resultMemory = state.resultMemory.slice(0, 60);
  event.result = calendarResultSummary(memory);
  event.played = true;
  return memory;
}

function calendarResultSummary(memory) {
  const home = state.league.clubsById[memory.home];
  const away = state.league.clubsById[memory.away];
  const score = `${home.short} ${memory.homeGoals}-${memory.awayGoals} ${away.short}`;
  const pens = memory.tiebreak ? `, pens ${memory.tiebreak.penaltyScore}` : '';
  return {
    text: `${score}${pens}`,
    outcome: memory.outcome,
    involved: memory.involved,
    winner: memory.winner,
  };
}

function rememberRoundSummary(event, played) {
  event.result = {
    text: `${played.round.short}: ${played.results.length} ties played`,
    outcome: null,
    involved: false,
    winner: played.championId || null,
  };
  event.played = true;
}

function processWorldActivity(event) {
  if (!event || event.type !== 'league') return;
  const uc = userClub();
  const table = divisionStandings(state.league.clubs, uc.division);

  if (event.week % 2 === 0) {
    const activity = runRivalTransfer(table, event);
    if (activity) addStory(rivalTransferStory(activity));
  }

  if (event.week % 3 === 0 || event.week === 1) {
    const leader = table[0];
    const chaser = table[1] || null;
    const pressureClub = table.at(-1);
    addStory(clubsToWatchStory({
      leader,
      chaser,
      pressureClub: pressureClub !== uc ? pressureClub : null,
      userClub: uc,
    }));
  }
}

function runRivalTransfer(table, event) {
  const uc = userClub();
  const candidates = table
    .filter(c => c !== uc && c.cash > Math.max(120_000, projectedRivalFee(c)))
    .sort((a, b) => transferUrgency(b) - transferUrgency(a) || a.name.localeCompare(b.name));
  const club = candidates[0];
  if (!club) return null;
  const need = squadNeeds(club).sort((a, b) => needScore(b) - needScore(a))[0];
  if (!need || need.priority === 'covered') return null;

  const pool = generateMarket(club, 4).filter(p => p.position === need.position || need.priority === 'urgent');
  const target = (pool.length ? pool : generateMarket(club, 2))
    .sort((a, b) => b.overall - a.overall)[0];
  if (!target) return null;

  const fee = Math.min(Math.round(target.value * 0.9), Math.round(club.cash * 0.18));
  if (fee <= 0 || fee > club.cash) return null;
  club.cash -= fee;
  club.players.push(target);
  const activity = {
    season: state.season,
    week: event.week,
    club,
    player: target,
    fee,
    needLabel: need.label,
    userDivision: uc.division,
  };
  state.worldActivity.unshift({
    season: activity.season,
    week: activity.week,
    club: club.id,
    player: serialisePlayer(target),
    fee,
    needLabel: activity.needLabel,
  });
  state.worldActivity = state.worldActivity.slice(0, 25);
  return activity;
}

function transferUrgency(club) {
  return squadNeeds(club).reduce((score, need) => score + needScore(need), 0);
}

function needScore(need) {
  return need.priority === 'urgent' ? 3 : need.priority === 'upgrade' ? 2 : 0;
}

function projectedRivalFee(club) {
  const avg = avgOverall(club);
  return Math.round(Math.pow(avg / 10, 3) * 650);
}

/* ------------------------------------------------------------------ */
/* Persistence (localStorage) — plain-object serialisation           */
/* ------------------------------------------------------------------ */
function save() {
  try {
    const data = {
      season: state.season,
      currentWeek: state.currentWeek,
      userClubId: state.league.userClubId,
      clubs: state.league.clubs.map(serialiseClub),
      fixtures: state.fixtures,
      market: state.market.map(serialisePlayer),
      transferFilters: state.transferFilters,
      lastResults: state.lastResults.map(r => ({
        home: r.home.id, away: r.away.id,
        homeGoals: r.homeGoals, awayGoals: r.awayGoals,
      })),
      objective: state.objective,
      financeObjective: state.financeObjective,
      confidence: state.confidence,
      badlyStreak: state.badlyStreak,
      jobStatus: state.jobStatus,
      fanTrust: state.fanTrust,
      lastReview: state.lastReview,
      lastMove: state.lastMove,
      inbox: state.inbox,
      developmentReport: state.developmentReport,
      financeReport: state.financeReport,
      clubHistory: state.clubHistory,
      cup: state.cup,
      lastCupResults: state.lastCupResults.map(serialiseCupResult),
      seasonCalendar: state.seasonCalendar,
      currentEvent: state.currentEvent,
      resultMemory: state.resultMemory,
      worldActivity: state.worldActivity,
      managerMarket: state.managerMarket,
      directorMarket: state.directorMarket,
      boardPlan: state.boardPlan,
      decisions: state.decisions,
      chairmanProfile: state.chairmanProfile,
      transferRecommendations: state.transferRecommendations,
      outgoingOffers: state.outgoingOffers,
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  } catch (e) { /* storage may be blocked; game still runs in-memory */ }
}

function load() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    const clubs = data.clubs.map(deserialiseClub);
    const clubsById = {};
    clubs.forEach(c => { clubsById[c.id] = c; });
    state.league = { clubs, clubsById, userClubId: data.userClubId };
    state.fixtures = data.fixtures;
    state.currentWeek = data.currentWeek;
    state.season = data.season;
    ensureClubManagers(clubs, state.season || 1);
    ensureClubStaff(clubs, state.season || 1);
    state.market = (data.market || []).map(p => Object.assign(new Player(p), p));
    state.transferFilters = data.transferFilters ?? { position: 'ALL', affordableOnly: false };
    state.lastResults = (data.lastResults || []).map(r => ({
      home: clubsById[r.home], away: clubsById[r.away],
      homeGoals: r.homeGoals, awayGoals: r.awayGoals,
    }));
    state.objective = data.objective ?? null;
    state.financeObjective = data.financeObjective ?? setFinanceObjective();
    state.confidence = data.confidence ?? START_CONFIDENCE;
    state.badlyStreak = data.badlyStreak ?? 0;
    state.jobStatus = data.jobStatus ?? 'secure';
    state.fanTrust = data.fanTrust ?? 60;
    state.lastReview = data.lastReview ?? null;
    state.lastMove = data.lastMove ?? null;
    state.inbox = data.inbox ?? [];
    state.developmentReport = data.developmentReport ?? null;
    state.financeReport = data.financeReport ?? null;
    state.clubHistory = data.clubHistory ?? createClubHistory(clubsById[data.userClubId]);
    state.cup = data.cup ?? createCup(clubs, data.season || 1);
    state.lastCupResults = (data.lastCupResults || []).map(r => hydrateCupResult(r, clubsById));
    state.seasonCalendar = data.seasonCalendar ?? buildSeasonCalendar(state.fixtures, state.cup, state.season);
    state.resultMemory = data.resultMemory ?? [];
    state.worldActivity = data.worldActivity ?? [];
    state.managerMarket = data.managerMarket ?? availableManagersForClub(clubsById[data.userClubId], data.season || 1);
    state.directorMarket = data.directorMarket ?? directorMarketForClub(clubsById[data.userClubId], data.season || 1);
    state.boardPlan = { ...defaultBoardPlan(), ...(data.boardPlan || {}) };
    state.chairmanProfile = normaliseChairmanProfile(data.chairmanProfile);
    state.transferRecommendations = data.transferRecommendations ?? null;
    state.outgoingOffers = data.outgoingOffers ?? [];
    state.decisions = dedupeDecisions((data.decisions ?? []).map(enrichDecisionReport));
    syncSeasonCalendar();
    state.currentEvent = nextCalendarIndex();
    if (state.currentTab === 'tactics') state.currentTab = 'manager';
    // Safety: if an objective is missing (older-but-compatible save), set one.
    if (!state.objective) {
      const uc = clubsById[data.userClubId];
      state.objective = setLeagueObjective(uc, null, clubsInDivision(clubs, uc.division).length);
    }
    if (!state.inbox.length) {
      addStory({ title: 'Save loaded', body: 'Your club is ready. Review the next match and board objective before advancing.', type: 'system', category: 'Club', importance: 1 });
    }
    return true;
  } catch (e) { return false; }
}

function serialisePlayer(p) { return { ...p }; }
function serialiseClub(c) {
  return {
    id: c.id, name: c.name, short: c.short, division: c.division,
    reputation: c.reputation, cash: c.cash, baseCommercial: c.baseCommercial,
    ticketPrice: c.ticketPrice, stadiumCapacity: c.stadiumCapacity,
    isUser: c.isUser, tactics: c.tactics, academy: c.academy, training: c.training,
    manager: c.manager,
    director: c.director,
    played: c.played, won: c.won, drawn: c.drawn, lost: c.lost,
    gf: c.gf, ga: c.ga, points: c.points,
    players: c.players.map(serialisePlayer),
  };
}
function serialiseCupResult(r) {
  return {
    home: r.home.id, away: r.away.id, winner: r.winner.id,
    homeGoals: r.homeGoals, awayGoals: r.awayGoals, result: r.result,
    xg: r.xg, ratings: r.ratings, timeline: r.timeline, tiebreak: r.tiebreak,
  };
}
function hydrateCupResult(r, clubsById) {
  return {
    ...r,
    home: clubsById[r.home],
    away: clubsById[r.away],
    winner: clubsById[r.winner],
  };
}
function deserialiseClub(d) {
  const club = new Club({
    id: d.id, name: d.name, short: d.short, division: d.division,
    reputation: d.reputation, cash: d.cash, baseCommercial: d.baseCommercial,
    ticketPrice: d.ticketPrice, stadiumCapacity: d.stadiumCapacity,
    players: d.players.map(p => Object.assign(new Player(p), p)),
    isUser: d.isUser,
  });
  club.tactics = d.tactics || club.tactics;
  club.academy = d.academy ?? 1;
  club.training = d.training ?? 1;
  club.manager = d.manager || null;
  if (club.manager) applyManagerTactics(club);
  club.director = d.director || null;
  Object.assign(club, {
    played: d.played, won: d.won, drawn: d.drawn, lost: d.lost,
    gf: d.gf, ga: d.ga, points: d.points,
  });
  return club;
}

/* ------------------------------------------------------------------ */
/* Navigation                                                         */
/* ------------------------------------------------------------------ */
function setupTabs() {
  const headerHome = document.getElementById('headerHome');
  if (headerHome) headerHome.addEventListener('click', () => switchTab('dashboard'));
}

function switchTab(tab) {
  if (!state.league) return;
  state.currentTab = tab;
  updateNavDecisionBadge();
  render();
}

function setNavEnabled(enabled) {
  const headerHome = document.getElementById('headerHome');
  if (headerHome) {
    headerHome.disabled = !enabled;
    headerHome.hidden = true;
  }
}

function updateNavDecisionBadge() {
  const btn = document.getElementById('headerHome');
  if (!btn) return;
  const count = state.league ? (state.decisions || []).length : 0;
  btn.classList.toggle('needs-attention', count > 0 && state.currentTab !== 'dashboard');
  btn.innerHTML = count > 0 && state.currentTab !== 'dashboard'
    ? `Dashboard <span class="nav-badge">${count}</span>`
    : 'Dashboard';
}

function setupGlobalButtons() {
  document.getElementById('resetGame').addEventListener('click', () => {
    if (confirm('Reset the game? This deletes your current save.')) {
      localStorage.removeItem(SAVE_KEY);
      showClubSelection();
    }
  });
  document.getElementById('closeMatchModal').addEventListener('click', () => {
    document.getElementById('matchModal').hidden = true;
  });
  document.getElementById('transferModal').addEventListener('click', e => {
    if (e.target.id === 'transferModal') closeTransferModal();
  });
}

/* ------------------------------------------------------------------ */
/* Rendering                                                          */
/* ------------------------------------------------------------------ */
function render() {
  if (!state.league) {
    showClubSelection();
    return;
  }
  const club = userClub();
  document.getElementById('headerClubName').textContent = club.name;
  document.getElementById('headerCash').textContent = '£' + fmt(club.cash);
  const headerHome = document.getElementById('headerHome');
  if (headerHome) headerHome.hidden = state.currentTab === 'dashboard';
  updateNavDecisionBadge();

  document.querySelectorAll('.tab-content').forEach(s => { s.hidden = s.id !== state.currentTab; });

  const renderers = {
    dashboard: renderDashboard,
    news: renderNews,
    club: renderClubProfile,
    boardroom: renderBoardroom,
    squad: renderSquad,
    manager: renderManager,
    fixtures: renderFixtures,
    cup: renderCup,
    table: renderTable,
    transfers: renderTransfers,
    finance: renderFinance,
    stadium: renderStadium,
  };
  (renderers[state.currentTab] || renderDashboard)();
  save();
}

/* ---------- Dashboard ---------- */
function renderDashboard() {
  const club = userClub();
  const table = divisionStandings(state.league.clubs, club.division);
  const pos = table.indexOf(club) + 1;
  const nextEvent = nextCalendarEvent();
  const health = financialHealth(club);
  const forecast = financeForecast(club);
  const contractRisks = expiringPlayers(club, 3);
  const injuries = injuredPlayers(club);

  // Board objective + live on-track status.
  const obj = state.objective;
  const track = trackStatus(obj, pos, club.played);
  const pressure = currentPressure(club, pos, track);
  const nextFixture = nextEvent ? fixtureForCalendarEvent(nextEvent) : null;
  const preview = nextFixture ? matchPreview(nextFixture, nextEvent) : null;

  document.getElementById('dashboard').innerHTML = `
    ${renderChairmanBrief({ club, pos, track, pressure, nextEvent, preview })}

    ${renderDashboardHub({ club, pos, track, forecast, health, contractRisks, injuries, nextEvent, preview })}
  `;

  const briefPlayBtn = document.getElementById('briefPlayNext');
  if (briefPlayBtn) briefPlayBtn.addEventListener('click', onPlayNext);
  const briefNewSeason = document.getElementById('briefNewSeason');
  if (briefNewSeason) {
    briefNewSeason.disabled = state.cup?.status === 'active';
    briefNewSeason.addEventListener('click', onNewSeason);
  }
  document.querySelectorAll('[data-dashboard-tab]').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.dashboardTab));
  });
}

function renderDashboardHub({ club, pos, track, forecast, health, contractRisks, injuries, nextEvent, preview }) {
  const dealCount = dealRoomTargets(club).length;
  const outgoingCount = (state.outgoingOffers || []).length;
  const transferActionCount = dealCount + outgoingCount;
  const cupLabel = state.cup?.status === 'complete' ? 'Complete' : cupCurrentRound(state.cup)?.name || 'Scheduled';
  const finance = financeHealthScore(club, forecast, health);
  const manager = managerHealthScore(club);
  const squad = squadHealthScore(club, injuries, contractRisks);
  const latestHeadline = normaliseStory((state.inbox || [])[0] || {});
  const nextSummary = dashboardEventSummary(nextEvent, preview);
  const pressure = currentPressure(club, pos, track);
  const areas = [
    { tab: 'boardroom', icon: '📋', label: 'Boardroom', value: state.decisions.length ? `${state.decisions.length} pending` : 'Clear', detail: state.decisions[0]?.title || 'No chairman action', summary: state.decisions[0]?.body || 'No decision required before the next fixture.', band: state.decisions.length ? 'danger' : 'safe' },
    { tab: 'squad', icon: '👕', label: 'Squad', value: `${squad.score}%`, detail: squad.label, summary: squadHubSummary(injuries, contractRisks), band: squad.band },
    { tab: 'fixtures', icon: '📅', label: 'Fixtures', value: nextSummary.value, detail: nextSummary.detail, summary: nextSummary.summary, band: nextEvent ? 'ok' : 'safe' },
    { tab: 'news', icon: '📰', label: 'News', value: `${state.inbox.length} stories`, detail: latestHeadline.title || 'No headline yet', summary: latestHeadline.body || 'Season stories will appear as events unfold.', band: latestHeadline.importance >= 3 ? 'warning' : 'ok' },
    { tab: 'table', icon: '🏆', label: 'League', value: `${pos}${ord(pos)}`, detail: trackWord(track.state), summary: track.text, band: track.state === 'ontrack' ? 'safe' : track.state === 'close' ? 'warning' : track.state === 'offtrack' ? 'danger' : 'ok' },
    { tab: 'finance', icon: '🏟', label: 'Finance', value: `${finance.score}%`, detail: health.label, summary: financeHubSummary(forecast), band: finance.band },
    { tab: 'manager', icon: '🧢', label: 'Manager', value: `${manager.score}%`, detail: manager.label, summary: managerHubSummary(club, track, pressure), band: manager.band },
    { tab: 'transfers', icon: '🤝', label: 'Deal Room', value: transferActionCount ? `${transferActionCount} live` : 'No approval', detail: outgoingCount ? `${outgoingCount} outgoing offer${outgoingCount === 1 ? '' : 's'}` : dealCount ? 'DoF review live' : 'DoF monitoring', summary: outgoingCount ? 'Review player sale offers before they expire.' : dealCount ? 'Review recommended targets before committing money.' : 'The DoF will return when a proper squad need is found.', band: transferActionCount ? 'warning' : 'ok' },
    { tab: 'club', icon: '💼', label: 'Club', value: `${state.confidence}%`, detail: confidenceLabel(state.confidence).label, summary: `Supporter trust ${state.fanTrust}/100. ${pressure.label}.`, band: scoreBand(state.confidence) },
    { tab: 'cup', icon: '🏅', label: 'Cup', value: cupLabel, detail: state.cup?.status === 'complete' ? 'Finished' : 'In calendar', summary: cupHubSummary(club), band: state.cup?.status === 'complete' ? 'safe' : 'ok' },
    { tab: 'stadium', icon: '🏗', label: 'Stadium', value: `${fmt(club.stadiumCapacity)} seats`, detail: `Academy ${club.academy} · Training ${club.training}`, summary: 'Review facilities, tickets, academy, and training investment.', band: 'ok' },
  ];
  return `<div class="dashboard-hub">
    ${areas.map(area => `<button class="hub-card ${bandClass(area.band)}" data-dashboard-tab="${area.tab}">
      <span class="hub-icon">${area.icon}</span>
      <span>
        <strong>${area.label}</strong>
        <small>${area.value}</small>
        ${area.detail ? `<em>${area.detail}</em>` : ''}
        <span class="hub-summary">${area.summary}</span>
      </span>
    </button>`).join('')}
  </div>`;
}

function dashboardEventSummary(event, preview) {
  if (!event) {
    return {
      value: 'Season complete',
      detail: 'Ready to review',
      summary: `Start Season ${state.season + 1} from the chairman brief when ready.`,
    };
  }
  if (preview) {
    return {
      value: event.date || 'Next date',
      detail: `${preview.home.short} vs ${preview.away.short}`,
      summary: `${preview.competition}${preview.roundName ? `, ${preview.roundName}` : ''}. Play this fixture from the chairman brief.`,
    };
  }
  if (event.type === 'cup') {
    return {
      value: event.date || 'Cup date',
      detail: event.label,
      summary: 'Cup round scheduled. Simulate it from the chairman brief to progress the draw.',
    };
  }
  return {
    value: event.date || 'Calendar',
    detail: event.label || 'Scheduled',
    summary: 'Open fixtures for the full season list.',
  };
}

function squadHubSummary(injuries, contractRisks) {
  const parts = [];
  if (injuries.length) parts.push(`${injuries.length} injured`);
  if (contractRisks.length) parts.push(`${contractRisks.length} contract${contractRisks.length === 1 ? '' : 's'} to review`);
  return parts.length ? parts.join(' · ') : 'No injuries or urgent contract warnings.';
}

function financeHubSummary(forecast) {
  if (forecast.risk === 'danger') return `Cash runway is tight. Protect spending before approving new commitments.`;
  if (forecast.risk === 'warning') return `${forecast.label}. Wage room: £${fmt(forecast.remainingWeeklyWage)}/wk.`;
  return `Transfer pot £${fmt(forecast.transferBudget)}. Wage room £${fmt(forecast.remainingWeeklyWage)}/wk.`;
}

function managerHubSummary(club, track, pressure) {
  if (!club.manager) return 'Hire a manager before the season can settle.';
  if ((club.manager.confidence ?? 60) <= 45) return 'Confidence is low. Consider a manager meeting.';
  if (track.state === 'offtrack' || pressure.band === 'danger') return 'Results pressure is rising. Review backing or expectations.';
  return 'No manager intervention needed this week.';
}

function cupHubSummary(club) {
  const status = cupStatus(state.cup, club.id);
  return status.text || 'Cup progress will update through scheduled calendar rounds.';
}

function renderChairmanBrief({ club, pos, track, pressure, nextEvent, preview }) {
  const pending = state.decisions || [];
  const latestResult = (state.resultMemory || []).find(item => item.involved);
  const objectiveLabel = state.objective?.label || 'No objective set';
  const objectiveText = `${objectiveLabel}. ${pos}${ord(pos)}: ${track.text}`;
  const action = pending.length
    ? {
      label: 'Review Boardroom',
      tab: 'boardroom',
      tone: 'danger',
      title: pending[0].type === 'chairman_agenda' ? pending[0].title : 'Chairman approval needed',
      text: pending[0].body,
    }
    : nextEvent
      ? {
        label: preview ? 'Play Next Fixture' : nextEvent.type === 'cup' ? 'Simulate Cup Round' : 'Continue Calendar',
        play: true,
        tone: pressure.band === 'danger' ? 'warning' : 'safe',
        title: preview ? `${preview.home.short} vs ${preview.away.short}` : nextEvent.label,
        text: preview
          ? `${preview.competition}${preview.roundName ? ` · ${preview.roundName}` : ''}. ${dashboardMatchWarning(preview).text}`
          : renderCalendarEventText(nextEvent),
      }
      : {
        label: `Start Season ${state.season + 1}`,
        newSeason: true,
        tone: 'safe',
        title: 'Season complete',
        text: 'Review the season outcome, then start the next campaign.',
      };
  const resultText = latestResult
    ? `${latestResult.competition || 'Latest'}: ${briefResultText(latestResult)}`
    : `You are ${pos}${ord(pos)} and ${trackWord(track.state).toLowerCase()} against the board objective.`;
  return `<div class="card chairman-brief">
    <div>
      <span class="story-kicker">Chairman Brief</span>
      <h2 class="mb0">${action.title}</h2>
      <p class="objective-tracker ${bandClass(track.state === 'offtrack' ? 'danger' : track.state === 'close' ? 'warning' : 'safe')}">${trackDot(track.state)} Board objective: ${objectiveText}</p>
      <p class="muted small mt">${action.text}</p>
      <p class="small ${bandClass(track.state === 'offtrack' ? 'danger' : pressure.band)} mt">${resultText}</p>
    </div>
    <button class="btn ${action.tone === 'danger' ? 'btn-danger' : ''}" ${action.play ? 'id="briefPlayNext"' : action.newSeason ? 'id="briefNewSeason"' : `data-dashboard-tab="${action.tab}"`}>
      ${action.label}
    </button>
  </div>`;
}

function renderCalendarEventText(event) {
  if (!event) return 'No event scheduled.';
  if (event.type === 'cup') return 'Your club may not be involved, but the cup round will progress and update the draw.';
  return event.label || 'Continue the season calendar.';
}

function briefResultText(memory) {
  const clubs = state.league?.clubsById || {};
  const home = clubs[memory.home]?.short || 'Home';
  const away = clubs[memory.away]?.short || 'Away';
  const score = `${home} ${memory.homeGoals}-${memory.awayGoals} ${away}`;
  return memory.involved && memory.outcome ? `${score} (${memory.outcome})` : `${memory.round || 'Round'}: ${score}`;
}

function dashboardMatchWarning(preview) {
  const missing = missingStarters(userClub());
  if (missing.length) return { tone: 'danger', text: `${missing.length} likely starter${missing.length === 1 ? '' : 's'} unavailable.` };
  if (preview.context.stakes.length) return { tone: 'warning', text: preview.context.stakes[0] };
  if (preview.userEdge < 0) return { tone: 'warning', text: `${preview.opponent.short} are rated stronger for this fixture.` };
  return { tone: 'success', text: 'No major selection warnings.' };
}

function financeHealthScore(club, forecast, health) {
  let score = 100;
  score -= Math.max(0, (health.ratio - 0.6) * 120);
  if (forecast.profit < 0) score -= Math.min(25, Math.abs(forecast.profit) / Math.max(1, forecast.revenue.total) * 80);
  if (club.cash < forecast.reserveTarget) score -= 15;
  score = clampScore(score);
  return { score, band: scoreBand(score) };
}

function managerHealthScore(club) {
  const confidence = club.manager?.confidence ?? 60;
  const fit = managerFit(club.manager, club);
  const score = clampScore(confidence * 0.6 + fit * 0.4);
  return { score, band: scoreBand(score), label: score >= 70 ? 'Strong' : score >= 45 ? 'Watch' : 'Risk' };
}

function squadHealthScore(club, injuries, contractRisks) {
  let score = 88;
  score -= injuries.length * 9;
  score -= contractRisks.length * 8;
  if (club.players.length < 16) score -= 8;
  score = clampScore(score);
  return { score, band: scoreBand(score), label: injuries.length ? `${injuries.length} out` : contractRisks.length ? 'Contracts' : 'Ready' };
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function scoreBand(score) {
  if (score >= 70) return 'safe';
  if (score >= 45) return 'warning';
  return 'danger';
}

function renderDevelopmentSummary() {
  const report = state.developmentReport;
  if (!report) return '';
  const summary = report.summary;
  const prospect = summary.topProspect;
  return `<div class="card">
    <div class="flex-between">
      <h2 class="mb0">Development Report</h2>
      <span class="muted small">End of season ${report.season}</span>
    </div>
    <div class="stat-row mt">
      <div class="stat"><strong>Improved</strong><span class="success">${summary.improved}</span></div>
      <div class="stat"><strong>Declined</strong><span class="danger">${summary.declined}</span></div>
      <div class="stat"><strong>Academy</strong><span class="gold">${report.intake.length}</span></div>
    </div>
    <p class="muted small mt">${summary.text}</p>
    ${prospect ? `<p class="small gold">Top prospect: ${prospect.name} · ${prospect.position} · ${prospect.overall} OVR / ${prospect.potential} POT</p>` : ''}
  </div>`;
}

function renderClubsToWatch() {
  const uc = userClub();
  const table = divisionStandings(state.league.clubs, uc.division);
  const leader = table[0];
  const chaser = table[1] || null;
  const danger = table.at(-1);
  const latestMove = state.worldActivity
    .map(a => ({ ...a, clubObj: state.league.clubsById[a.club] }))
    .find(a => a.clubObj?.division === uc.division);

  return `<div class="card">
    <div class="flex-between">
      <h2 class="mb0">Clubs to Watch</h2>
      <span class="muted small">${DIVISIONS[uc.division].name}</span>
    </div>
    <div class="grid mt">
      ${watchClubCard('Pace-setter', leader)}
      ${watchClubCard('Chaser', chaser)}
      ${watchClubCard('Under pressure', danger)}
    </div>
    ${latestMove ? `<p class="muted small mt">Latest rival move: ${latestMove.clubObj.short} signed ${latestMove.player.name} for £${fmt(latestMove.fee)}.</p>` : '<p class="muted small mt">Rival clubs will make occasional budget-limited moves as the season develops.</p>'}
  </div>`;
}

function watchClubCard(label, club) {
  if (!club) return '';
  const table = divisionStandings(state.league.clubs, club.division);
  const pos = table.indexOf(club) + 1;
  return `<div class="mini-panel">
    <span class="muted small">${label}</span>
    <strong>${club.short} · ${pos}${ord(pos)}</strong>
    <span class="muted small">${club.won}-${club.drawn}-${club.lost} · ${club.points} pts · Avg ${avgOverall(club)}</span>
  </div>`;
}

function defaultChairmanProfile() {
  return {
    patience: 50,
    ambition: 50,
    prudence: 50,
    youth: 50,
    supporter: 50,
    delegation: 50,
    actions: 0,
  };
}

function normaliseChairmanProfile(profile) {
  return { ...defaultChairmanProfile(), ...(profile || {}) };
}

function applyChairmanTrait(delta = {}) {
  state.chairmanProfile = normaliseChairmanProfile(state.chairmanProfile);
  Object.entries(delta).forEach(([key, value]) => {
    if (key === 'actions') return;
    state.chairmanProfile[key] = clampScore((state.chairmanProfile[key] ?? 50) + value);
  });
  state.chairmanProfile.actions = (state.chairmanProfile.actions || 0) + 1;
}

function chairmanProfileSummary(profile = state.chairmanProfile) {
  const p = normaliseChairmanProfile(profile);
  const pairs = [
    { key: 'ambition', high: 'Ambitious', low: 'Measured' },
    { key: 'prudence', high: 'Prudent', low: 'Aggressive spender' },
    { key: 'patience', high: 'Patient', low: 'Ruthless' },
    { key: 'youth', high: 'Developer', low: 'Short-term builder' },
    { key: 'supporter', high: 'Fan-first', low: 'Boardroom-first' },
    { key: 'delegation', high: 'Delegator', low: 'Hands-on' },
  ].map(item => {
    const value = p[item.key] ?? 50;
    return { ...item, value, lean: value >= 50 ? item.high : item.low, strength: Math.abs(value - 50) };
  }).sort((a, b) => b.strength - a.strength);
  const primary = pairs[0].strength >= 8 ? pairs[0].lean : 'Balanced';
  const secondary = pairs[1].strength >= 12 ? pairs[1].lean : 'Club-first';
  return {
    label: `${primary} ${secondary} Chairman`,
    text: p.actions
      ? `Your identity is emerging from ${p.actions} chairman decisions. Staff, supporters, and future stories will read these tendencies.`
      : 'Your ownership identity will emerge from decisions you make, not from a setup choice.',
    traits: pairs,
  };
}

function renderChairmanProfile() {
  const summary = chairmanProfileSummary();
  return `<div class="card">
    <div class="flex-between">
      <div>
        <h2 class="mb0">Chairman Profile</h2>
        <p class="muted small">${summary.text}</p>
      </div>
      <span class="pill obj-pending">${summary.label}</span>
    </div>
    <div class="grid mt">
      ${summary.traits.map(t => `<div class="mini-panel">
        <span class="muted small">${t.lean}</span>
        <strong>${t.value}/100</strong>
        <div class="bar mt"><div class="bar-fill ${t.value >= 65 ? 'green' : t.value <= 35 ? '' : 'blue'}" style="width:${t.value}%;${t.value <= 35 ? 'background:var(--warning)' : ''}"></div></div>
      </div>`).join('')}
    </div>
  </div>`;
}

/* ---------- Club Profile ---------- */
function renderClubProfile() {
  const club = userClub();
  const history = state.clubHistory || createClubHistory(club);
  const latest = history.seasons?.at(-1) || null;
  const mood = fanMood(history, state.confidence, latest);
  const identity = clubIdentity(history, club);
  const honours = history.honours || [];
  const records = history.records || {};

  document.getElementById('club').innerHTML = `
    <div class="card">
      <div class="flex-between">
        <div>
          <h2 class="mb0">${club.name}</h2>
          <p class="muted small">${identity} · Reputation ${club.reputation}/10 · Season ${state.season}</p>
        </div>
        <span class="pill obj-${mood.band === 'safe' ? 'ontrack' : mood.band === 'warning' ? 'close' : mood.band === 'danger' ? 'offtrack' : 'pending'}">${mood.label}</span>
      </div>
      <p class="muted mt">${mood.text}</p>
      <div class="stat-row mt">
        <div class="stat"><strong>Seasons</strong><span>${history.seasons?.length || 0}</span></div>
        <div class="stat"><strong>Honours</strong><span class="gold">${honours.length}</span></div>
        <div class="stat"><strong>Highest Rep</strong><span>${records.highestReputation || club.reputation}</span></div>
        <div class="stat"><strong>Record Balance</strong><span>£${fmt(records.highestBalance || club.cash)}</span></div>
      </div>
    </div>

    ${renderChairmanProfile()}

    <div class="grid">
      <div class="card mb0">
        <h3>Club Records</h3>
        <table><tbody>
          <tr><td>Highest finish</td><td class="num">${formatHighestFinish(records.highestFinish)}</td></tr>
          <tr><td>Best points season</td><td class="num">${records.bestPoints ? `${records.bestPoints.points} pts` : '—'}</td></tr>
          <tr><td>Biggest win</td><td class="num">${formatResultRecord(records.biggestWin)}</td></tr>
          <tr><td>Biggest loss</td><td class="num">${formatResultRecord(records.biggestLoss)}</td></tr>
        </tbody></table>
      </div>
      <div class="card mb0">
        <h3>Honours</h3>
        ${honours.length ? `<ul class="plain-list">${honours.slice().reverse().map(h => `<li><strong>S${h.season}</strong> ${h.label}</li>`).join('')}</ul>` : '<p class="muted small">No honours yet. The climb starts here.</p>'}
      </div>
    </div>

    <div class="card">
      <div class="flex-between">
        <h3 class="mb0">Season History</h3>
        <span class="muted small">${history.seasons?.length || 0} completed</span>
      </div>
      <div style="overflow-x:auto" class="mt">
        <table>
          <thead><tr><th>Season</th><th>Division</th><th class="num">Finish</th><th class="num">Pts</th><th>Objective</th><th>Outcome</th><th class="num">P&L</th></tr></thead>
          <tbody>${renderSeasonHistoryRows(history.seasons || [])}</tbody>
        </table>
      </div>
    </div>`;
}

function renderSeasonHistoryRows(seasons) {
  if (!seasons.length) return '<tr><td colspan="7" class="muted">No completed seasons yet.</td></tr>';
  return seasons.slice().reverse().map(s => `<tr>
    <td>S${s.season}</td>
    <td>${s.divisionName}</td>
    <td class="num">${s.finalPos}${ord(s.finalPos)}</td>
    <td class="num">${s.points}</td>
    <td>${s.objective}</td>
    <td>${s.summary}</td>
    <td class="num ${s.profit >= 0 ? 'success' : 'danger'}">${s.profit >= 0 ? '+' : '−'}£${fmt(Math.abs(s.profit))}</td>
  </tr>`).join('');
}

function renderInbox() {
  return renderNewsList(state.inbox.slice(0, 5), true);
}

function renderDecisionInbox(compact = false) {
  const pending = state.decisions || [];
  if (!pending.length) return compact ? '' : '<p class="muted small mt">No staff decisions pending.</p>';
  const items = compact ? pending.slice(0, 3) : pending;
  const hasAgenda = pending.some(decision => decision.type === 'chairman_agenda');
  return `<div class="card">
    <div class="flex-between">
      <h2 class="mb0">${hasAgenda ? 'Chairman Agenda' : 'Decision Inbox'}</h2>
      <span class="muted small">${pending.length} pending</span>
    </div>
    <div class="decision-list mt">
      ${items.map(decision => `
        <article class="decision-item ${decision.importance >= 3 ? 'major' : ''}">
          <div>
            <span class="story-kicker">${decision.source}</span>
            <strong>${decision.title}</strong>
            <p class="muted small">${decision.body}</p>
            ${decision.managerView ? `<p class="small ${bandClass(decision.managerView.band)}">Manager view: ${decision.managerView.label}</p>` : ''}
            ${decision.impact ? `<p class="small ${decision.importance >= 2 ? 'warning' : 'muted'}">${decision.impact}</p>` : ''}
          </div>
          <div class="decision-actions">
            ${decision.choices
              ? decision.choices.map((choice, i) => `<button class="${i === 0 ? 'btn' : 'btn-ghost'} btn-sm ${choice.risk === 'high' ? 'danger-action' : ''}" data-agenda-choice="${decision.id}:${choice.id}">${choice.label}</button>`).join('')
              : `<button class="btn btn-sm" data-decision-approve="${decision.id}">${decision.actionLabel || 'Approve'}</button>
                <button class="btn-ghost btn-sm" data-decision-dismiss="${decision.id}">${decision.dismissLabel || 'Dismiss'}</button>`}
          </div>
        </article>
      `).join('')}
    </div>
  </div>`;
}

function bindDecisionButtons() {
  document.querySelectorAll('[data-decision-approve]').forEach(btn => {
    btn.addEventListener('click', () => approveDecision(btn.dataset.decisionApprove));
  });
  document.querySelectorAll('[data-decision-dismiss]').forEach(btn => {
    btn.addEventListener('click', () => dismissDecision(btn.dataset.decisionDismiss));
  });
  document.querySelectorAll('[data-agenda-choice]').forEach(btn => {
    btn.addEventListener('click', () => {
      const [id, choiceId] = btn.dataset.agendaChoice.split(':');
      chooseAgendaOption(id, choiceId);
    });
  });
}

function renderNews() {
  document.getElementById('news').innerHTML = `
    <div class="card">
      <div class="flex-between">
        <h2 class="mb0">News Centre</h2>
        <span class="muted small">${state.inbox.length} stories this save</span>
      </div>
      <p class="muted small mt">Stories are generated from real club events: results, cup runs, board pressure, transfers, academy, finances, infrastructure, and league movement.</p>
      ${renderNewsList(state.inbox, false)}
    </div>`;
}

function renderNewsList(items, compact) {
  if (!items.length) return '<p class="muted small mt">No stories yet. Play a matchweek to build the season narrative.</p>';
  return `<div class="inbox-list mt ${compact ? 'compact' : ''}">${items.map(raw => {
    const item = normaliseStory(raw);
    return `
    <article class="inbox-item news-item ${item.importance >= 3 ? 'major' : ''}">
      <div class="inbox-dot ${item.type || 'system'}"></div>
      <div>
        <div class="flex-between inbox-title-row">
          <div>
            <span class="story-kicker">${item.category || 'Club'}</span>
            <strong>${item.title}</strong>
          </div>
          <span class="muted small">${item.meta}</span>
        </div>
        <p class="muted small">${item.body}</p>
      </div>
    </article>`;
  }).join('')}</div>`;
}

function fixtureForCalendarEvent(event) {
  if (!event) return null;
  const club = userClub();
  if (event.type === 'league') {
    const week = state.fixtures.find(w => w.week === event.week);
    const fixture = week?.matches.find(m => m.home === club.id || m.away === club.id);
    return fixture ? { ...fixture, competition: 'League', event, roundName: event.label } : null;
  }
  if (event.roundIndex !== state.cup?.roundIndex) return null;
  const fixture = cupRoundFixture(state.cup, club.id);
  const round = cupCurrentRound(state.cup);
  return fixture ? { ...fixture, competition: state.cup.name, event, roundName: round?.name || event.label } : null;
}

function matchPreview(fx, event = null) {
  const club = userClub();
  const home = state.league.clubsById[fx.home];
  const away = state.league.clubsById[fx.away];
  const homeRatings = teamRatings(home, HOME_BONUS);
  const awayRatings = teamRatings(away, 0);
  const probs = outcomeProbabilities(homeRatings, awayRatings);
  const isHome = home === club;
  const userWin = isHome ? probs.homeWin : probs.awayWin;
  const oppWin = isHome ? probs.awayWin : probs.homeWin;
  const userRatings = isHome ? homeRatings : awayRatings;
  const oppRatings = isHome ? awayRatings : homeRatings;
  const opponent = isHome ? away : home;
  const factors = previewFactors(club, opponent, userRatings, oppRatings, isHome);
  const context = fixtureContext({ club, opponent, event, competition: fx.competition || 'League' });

  return {
    home, away, opponent, isHome,
    competition: fx.competition || 'League',
    date: event?.date || fx.event?.date || '',
    roundName: fx.roundName || event?.label || '',
    context,
    ratings: { home: homeRatings, away: awayRatings, user: userRatings, opponent: oppRatings },
    probs, userWin, oppWin, userEdge: userWin - oppWin,
    factors,
  };
}

function fixtureContext({ club, opponent, event, competition }) {
  const table = divisionStandings(state.league.clubs, club.division);
  const oppPos = opponent.division === club.division ? table.indexOf(opponent) + 1 : null;
  const userPos = table.indexOf(club) + 1;
  const recent = recentForm(opponent.id);
  const stakes = [];
  if (event?.type === 'cup') stakes.push('Knockout tie: winner advances, loser exits.');
  if (competition === 'League') {
    const track = trackStatus(state.objective, userPos, club.played);
    stakes.push(`Board objective: ${trackWord(track.state)}.`);
    if (userPos <= 2) stakes.push('Promotion race fixture.');
    if (userPos >= table.length - 1) stakes.push('Relegation pressure fixture.');
  }
  if (missingStarters(opponent).length) stakes.push(`${opponent.short} have selection issues.`);

  return {
    opponentPosition: oppPos,
    opponentForm: recent.label,
    stakes,
  };
}

function recentForm(clubId, limit = 5) {
  const club = state.league.clubsById[clubId];
  const chars = state.resultMemory
    .filter(m => m.involved && (m.home === clubId || m.away === clubId || m.opponent === clubId))
    .slice(0, limit)
    .map(m => {
      const clubHome = m.home === clubId;
      const clubGoals = clubHome ? m.homeGoals : m.awayGoals;
      const oppGoals = clubHome ? m.awayGoals : m.homeGoals;
      if (m.type === 'cup' && m.winner) return m.winner === clubId ? 'W' : 'L';
      return clubGoals > oppGoals ? 'W' : clubGoals === oppGoals ? 'D' : 'L';
    });
  if (chars.length) return { label: chars.join(' ') };
  return { label: club?.played ? `${club.won}-${club.drawn}-${club.lost}` : 'season not started' };
}

function previewFactors(club, opponent, userRatings, oppRatings, isHome) {
  const factors = [];
  const attEdge = Math.round(userRatings.attack - oppRatings.defense);
  const defEdge = Math.round(userRatings.defense - oppRatings.attack);
  const avgGap = avgOverall(club) - avgOverall(opponent);

  factors.push(`${isHome ? `Home advantage adds +${HOME_BONUS} to attack and defence.` : 'Away match: no home bonus applied.'}`);
  factors.push(`${club.manager?.name || 'The head coach'}'s ${MANAGER_STYLES[club.manager?.style]?.label || 'balanced'} style sets the match approach.`);
  factors.push(attEdge >= 0
    ? `Your attack has a ${attEdge > 0 ? '+' : ''}${attEdge} edge against their defence.`
    : `Their defence has a ${Math.abs(attEdge)} point edge over your attack.`);
  factors.push(defEdge >= 0
    ? `Your defence has a ${defEdge > 0 ? '+' : ''}${defEdge} edge against their attack.`
    : `Their attack has a ${Math.abs(defEdge)} point edge over your defence.`);
  factors.push(avgGap >= 0
    ? `Squad average is ${avgGap} overall higher than ${opponent.short}.`
    : `Squad average is ${Math.abs(avgGap)} overall lower than ${opponent.short}.`);

  return factors;
}

function renderMatchPreview(preview) {
  const userProb = pct(preview.userWin);
  const drawProb = pct(preview.probs.draw);
  const oppProb = pct(preview.oppWin);
  const userXg = preview.isHome ? preview.probs.xg.home : preview.probs.xg.away;
  const oppXg = preview.isHome ? preview.probs.xg.away : preview.probs.xg.home;
  const missing = missingStarters(userClub());

  return `
    <p class="muted small">${preview.date ? `${preview.date} · ` : ''}${preview.competition}${preview.roundName ? ` · ${preview.roundName}` : ''}</p>
    <p class="fixture-line"><strong>${preview.home.name}</strong> vs <strong>${preview.away.name}</strong>
      <span class="muted small">(${preview.isHome ? 'Home' : 'Away'} for you)</span></p>
    <div class="prob-grid mt">
      ${probCell('Your win', userProb, 'green')}
      ${probCell('Draw', drawProb, 'gold')}
      ${probCell(`${preview.opponent.short} win`, oppProb, 'red')}
    </div>
    <div class="grid mt">
      <div class="mini-panel">
        <span class="muted small">Expected goals</span>
        <strong>${userXg} - ${oppXg}</strong>
      </div>
      <div class="mini-panel">
        <span class="muted small">Ratings</span>
        <strong>ATT ${Math.round(preview.ratings.user.attack)} / DEF ${Math.round(preview.ratings.user.defense)}</strong>
      </div>
    </div>
    <ul class="factor-list">
      ${preview.factors.map(f => `<li>${f}</li>`).join('')}
      ${preview.context.opponentPosition ? `<li>${preview.opponent.short} are ${preview.context.opponentPosition}${ord(preview.context.opponentPosition)} in your division.</li>` : ''}
      <li>${preview.opponent.short} recent form: ${preview.context.opponentForm}.</li>
      ${preview.context.stakes.map(s => `<li>${s}</li>`).join('')}
      ${missing.length ? `<li class="danger">Unavailable: ${missing.map(p => `${p.name} (${p.injuryWeeks}w)`).join(', ')}.</li>` : ''}
    </ul>`;
}

function renderCalendarMini() {
  const items = state.seasonCalendar.slice(state.currentEvent, state.currentEvent + 5);
  if (!items.length) return '<p class="muted small mt">All scheduled fixtures complete.</p>';
  return `<table class="mt"><tbody>${items.map((event, i) => {
    const fixture = fixtureForCalendarEvent(event);
    const detail = event.result?.text || (fixture ? `${state.league.clubsById[fixture.home].short} vs ${state.league.clubsById[fixture.away].short}` : event.label);
    const status = event.played ? resultLabel(event.result) : i === 0 ? 'Next' : 'Scheduled';
    return `<tr class="${i === 0 ? 'highlight-row' : ''}">
      <td>${event.date}</td>
      <td>${event.type === 'cup' ? 'Cup' : 'League'}</td>
      <td>${detail}</td>
      <td class="center">${status}</td>
    </tr>`;
  }).join('')}</tbody></table>`;
}

function renderCalendarEventPreview(event) {
  if (!event) return '<p class="muted">Season complete — advance to start the next one.</p>';
  if (event.type === 'cup') {
    return `<p class="muted small mt">${event.date} · ${state.cup.name}</p>
      <p><strong>${event.label}</strong></p>
      <p class="muted small">Your club is not scheduled in this cup round. Playing the next fixture will still simulate the round and update the draw, news, injuries, and cup story.</p>`;
  }
  return '<p class="muted">No fixture found for this calendar date.</p>';
}

function calendarFixtureContext(fx, event) {
  const preview = matchPreview(fx, event);
  const pos = preview.context.opponentPosition ? `${preview.opponent.short}: ${preview.context.opponentPosition}${ord(preview.context.opponentPosition)}` : preview.opponent.short;
  const stake = preview.context.stakes[0] || 'Scheduled fixture';
  return `<span class="small muted">${pos} · Form ${preview.context.opponentForm} · ${stake}</span>`;
}

function resultContext(result) {
  if (!result) return '';
  if (!result.involved) return '<span class="small muted">Round simulated</span>';
  return `<span class="small muted">Your result · xG stored</span>`;
}

function resultLabel(result) {
  if (!result) return 'Done';
  if (!result.involved || !result.outcome) return 'Done';
  return result.outcome;
}

function probCell(label, value, tone) {
  return `<div class="prob-cell">
    <span>${label}</span>
    <strong class="${toneClass(tone)}">${value}%</strong>
    <div class="bar"><div class="bar-fill ${tone === 'green' ? 'green' : tone === 'gold' ? 'gold' : ''}" style="width:${value}%;background:${tone === 'red' ? 'var(--danger)' : ''}"></div></div>
  </div>`;
}

function renderLastResults() {
  if (!state.lastResults.length) return '';
  const rows = state.lastResults.map(r => {
    const uc = userClub();
    const involved = r.home === uc || r.away === uc;
    return `<tr class="${involved ? 'highlight-row' : ''}">
      <td style="text-align:right">${r.home.name}</td>
      <td class="center"><strong>${r.homeGoals} – ${r.awayGoals}</strong></td>
      <td>${r.away.name}</td>
    </tr>`;
  }).join('');
  return `<div class="card"><h2>Latest Results</h2><table><tbody>${rows}</tbody></table></div>`;
}

/* ---------- Boardroom ---------- */
function renderBoardroom() {
  const club = userClub();
  if (!club.director) club.director = createDirectorForClub(club, state.season);
  const table = divisionStandings(state.league.clubs, club.division);
  const pos = table.indexOf(club) + 1;
  const track = trackStatus(state.objective, pos, club.played);
  const pressure = currentPressure(club, pos, track);
  const forecast = financeForecast(club);
  const guidance = budgetGuidance(state.boardPlan, forecast);
  const policy = RECRUITMENT_POLICIES[state.boardPlan.recruitmentPolicy] || RECRUITMENT_POLICIES.balanced;
  const priority = BUDGET_PRIORITIES[state.boardPlan.budgetPriority] || BUDGET_PRIORITIES.balanced;
  const candidates = state.directorMarket.length ? state.directorMarket : directorMarketForClub(club, state.season);
  const managerOptions = managerStatementOptions({ club, pos, track, pressure });
  const supporterOptions = supporterStatementOptions({ club, pos, track, pressure });
  const chairmanSummary = chairmanProfileSummary();
  const showManagerMeeting = shouldOfferManagerMeeting({ club, track, pressure });
  const showSupporterMessage = shouldOfferSupporterMessage({ track, pressure });
  state.directorMarket = candidates;

  document.getElementById('boardroom').innerHTML = `
    <div class="card">
      <div class="flex-between">
        <div>
          <h2 class="mb0">Boardroom</h2>
          <p class="muted small">Chairman controls: staff, budgets, recruitment direction, manager backing, and pressure management.</p>
        </div>
        <span class="pill obj-${pressure.band === 'safe' ? 'ontrack' : pressure.band === 'warning' ? 'close' : pressure.band === 'danger' ? 'offtrack' : 'pending'}">${pressure.label}</span>
      </div>
      <div class="grid mt">
        <div class="mini-panel"><span class="muted small">Director of Football</span><strong>${club.director.name}</strong><small class="muted">${club.director.rating}/100 · ${RECRUITMENT_POLICIES[club.director.speciality]?.label || 'Balanced'}</small></div>
        <div class="mini-panel"><span class="muted small">Recruitment Brief</span><strong>${policy.label}</strong><small class="muted">${policy.text}</small></div>
        <div class="mini-panel"><span class="muted small">Budget Plan</span><strong>${priority.label}</strong><small class="muted">${priority.text}</small></div>
        <div class="mini-panel"><span class="muted small">Supporter Trust</span><strong>${state.fanTrust}/100</strong><small class="muted">${supporterTrustLabel(state.fanTrust)}</small></div>
        <div class="mini-panel"><span class="muted small">Chairman Style</span><strong>${chairmanSummary.label}</strong><small class="muted">${state.chairmanProfile?.actions || 0} tracked decisions</small></div>
      </div>
      <p class="small ${bandClass(pressure.band)} mt">${pressure.text} Pressure score: ${pressure.score}/100.</p>
    </div>

    ${renderDecisionInbox(false)}

    <div class="grid">
      <div class="card mb0">
        <h2>Recruitment Policy</h2>
        <div class="form-row">
          <label>DoF brief</label>
          <select id="recruitmentPolicy">
            ${Object.entries(RECRUITMENT_POLICIES).map(([key, value]) => `<option value="${key}" ${key === state.boardPlan.recruitmentPolicy ? 'selected' : ''}>${value.label}</option>`).join('')}
          </select>
        </div>
        <p class="muted small">${policy.text}</p>
      </div>
      <div class="card mb0">
        <h2>Budget Planning</h2>
        <div class="form-row">
          <label>Priority</label>
          <select id="budgetPriority">
            ${Object.entries(BUDGET_PRIORITIES).map(([key, value]) => `<option value="${key}" ${key === state.boardPlan.budgetPriority ? 'selected' : ''}>${value.label}</option>`).join('')}
          </select>
        </div>
        <div class="grid mt">
          <div class="mini-panel"><span class="muted small">Transfer pot</span><strong>£${fmt(guidance.transferPot)}</strong></div>
          <div class="mini-panel"><span class="muted small">Wage ceiling</span><strong>£${fmt(guidance.weeklyWageRoom)}/wk</strong></div>
          <div class="mini-panel"><span class="muted small">Facilities reserve</span><strong>£${fmt(guidance.facilitiesReserve)}</strong></div>
        </div>
      </div>
    </div>

    ${(showManagerMeeting || showSupporterMessage) ? `<div class="grid">
      ${showManagerMeeting ? renderManagerMeetingPanel(club, managerOptions) : ''}
      ${showSupporterMessage ? renderSupporterMessagePanel(pressure, supporterOptions) : ''}
    </div>` : `<div class="card">
      <div class="flex-between">
        <h2 class="mb0">Chairman Interventions</h2>
        <span class="pill obj-ontrack">No meeting needed</span>
      </div>
      <p class="muted small mt">The manager and supporters are not calling for a public intervention this week. Keep routine controls light and advance the season when ready.</p>
    </div>`}

    <div class="card">
      <div class="flex-between">
        <h2 class="mb0">Director of Football Shortlist</h2>
        <button class="btn-ghost btn-sm" id="refreshDirectors">Refresh shortlist</button>
      </div>
      <table class="mt">
        <thead><tr><th>Name</th><th>Speciality</th><th class="num">Rating</th><th class="num">Wage</th><th class="num">Cost</th><th></th></tr></thead>
        <tbody>${candidates.map(candidate => `
          <tr>
            <td>${candidate.name}<br><span class="muted small">${candidate.age} years old</span></td>
            <td>${RECRUITMENT_POLICIES[candidate.speciality]?.label || 'Balanced'}</td>
            <td class="num">${candidate.rating}</td>
            <td class="num">£${fmt(candidate.wage)}/wk</td>
            <td class="num">£${fmt(candidate.compensation)}</td>
            <td><button class="btn btn-sm" data-hire-director="${candidate.id}" ${club.cash < candidate.compensation ? 'disabled' : ''}>Hire</button></td>
          </tr>`).join('')}</tbody>
      </table>
    </div>`;

  document.getElementById('recruitmentPolicy').addEventListener('change', e => {
    state.boardPlan.recruitmentPolicy = e.target.value;
    applyChairmanTrait(traitsForRecruitmentPolicy(e.target.value));
    state.market = guidedMarket(club);
    addStory(boardroomPolicyStory(club, RECRUITMENT_POLICIES[state.boardPlan.recruitmentPolicy], BUDGET_PRIORITIES[state.boardPlan.budgetPriority]));
    render();
  });
  document.getElementById('budgetPriority').addEventListener('change', e => {
    state.boardPlan.budgetPriority = e.target.value;
    applyChairmanTrait(traitsForBudgetPriority(e.target.value));
    addStory(boardroomPolicyStory(club, RECRUITMENT_POLICIES[state.boardPlan.recruitmentPolicy], BUDGET_PRIORITIES[state.boardPlan.budgetPriority]));
    render();
  });
  document.querySelectorAll('[data-manager-meeting]').forEach(btn => {
    btn.addEventListener('click', () => holdManagerMeeting(btn.dataset.managerMeeting, { club, pos, track, pressure }));
  });
  document.querySelectorAll('[data-supporter-message]').forEach(btn => {
    btn.addEventListener('click', () => addressSupporters(btn.dataset.supporterMessage, { club, pos, track, pressure }));
  });
  document.getElementById('refreshDirectors').addEventListener('click', () => {
    state.directorMarket = directorMarketForClub(club, state.season);
    render();
  });
  document.querySelectorAll('[data-hire-director]').forEach(btn => {
    btn.addEventListener('click', () => hireDirector(btn.dataset.hireDirector));
  });
  bindDecisionButtons();
}

function shouldOfferManagerMeeting({ club, track, pressure }) {
  if ((club.manager?.confidence ?? 60) <= 45) return true;
  if (track.state === 'offtrack') return true;
  if (pressure.band === 'danger') return true;
  if (club.played > 0 && club.played % 8 === 0) return true;
  return false;
}

function shouldOfferSupporterMessage({ track, pressure }) {
  if (pressure.band === 'warning' || pressure.band === 'danger') return true;
  if (track.state === 'offtrack') return true;
  if ((state.fanTrust ?? 60) <= 45) return true;
  return false;
}

function renderManagerMeetingPanel(club, managerOptions) {
  return `<div class="card mb0">
    <div class="flex-between">
      <h2 class="mb0">Manager Meeting</h2>
      <span class="muted small">${club.manager.name} · confidence ${club.manager.confidence ?? 60}/100</span>
    </div>
    <p class="muted small mt">Use this when form, confidence, or pressure makes a chairman conversation worthwhile.</p>
    <div class="grid mt">
      ${managerOptions.map(opt => `<div class="mini-panel">
        <span class="muted small">${opt.tone}</span>
        <strong>${opt.label}</strong>
        <small class="muted">${opt.preview}</small>
        <button class="btn-ghost btn-sm mt ${opt.risk === 'high' ? 'danger-action' : ''}" data-manager-meeting="${opt.id}">Say this</button>
      </div>`).join('')}
    </div>
  </div>`;
}

function renderSupporterMessagePanel(pressure, supporterOptions) {
  return `<div class="card mb0">
    <div class="flex-between">
      <h2 class="mb0">Supporter Message</h2>
      <span class="muted small">Trust ${state.fanTrust}/100 · ${pressure.label}</span>
    </div>
    <p class="muted small mt">Use public statements when pressure needs a visible chairman response.</p>
    <div class="grid mt">
      ${supporterOptions.map(opt => `<div class="mini-panel">
        <span class="muted small">${opt.tone}</span>
        <strong>${opt.label}</strong>
        <small class="muted">${opt.preview}</small>
        <button class="btn-ghost btn-sm mt ${opt.risk === 'high' ? 'danger-action' : ''}" data-supporter-message="${opt.id}">Release statement</button>
      </div>`).join('')}
    </div>
  </div>`;
}

function managerStatementOptions({ club, pos, track, pressure }) {
  const played = club.played;
  const size = state.objective?.divisionSize || divisionStandings(state.league.clubs, club.division).length;
  const targetPos = state.objective?.targetPos || Math.ceil(size / 2);
  const nearTop = pos <= Math.max(2, Math.ceil(size * 0.35));
  const early = played <= 5;
  const offTrack = track.state === 'offtrack';
  const options = [
    {
      id: 'fully_behind',
      tone: 'Backing',
      label: 'I am fully behind you.',
      preview: 'Calms the coach and dressing room, but supporters may judge you if form is poor.',
      managerDelta: 8,
      boardDelta: offTrack ? -2 : 1,
      fanDelta: offTrack ? -3 : 2,
      traits: { patience: 5, supporter: 1 },
    },
    {
      id: 'keep_it_up',
      tone: 'Praise',
      label: 'Keep it up, this is the standard.',
      preview: 'Rewards good work without changing expectations.',
      managerDelta: 5,
      boardDelta: 1,
      fanDelta: 1,
      traits: { patience: 3, delegation: 2 },
      show: track.state === 'ontrack' || pos <= targetPos,
    },
    {
      id: 'need_improvement',
      tone: 'Challenge',
      label: 'We need to see improvement.',
      preview: 'Fair pressure when results are drifting.',
      managerDelta: offTrack ? -3 : 1,
      boardDelta: 2,
      fanDelta: 1,
      traits: { ambition: 2, patience: -1 },
    },
    {
      id: 'promotion_push',
      tone: 'Ambition',
      label: 'We should be pushing for promotion.',
      preview: 'Raises ambition if the table makes it credible.',
      managerDelta: nearTop || early ? 2 : -5,
      boardDelta: nearTop ? 2 : -1,
      fanDelta: nearTop ? 3 : -2,
      traits: { ambition: 5, prudence: -1 },
      show: nearTop || early || targetPos <= 3,
    },
    {
      id: 'title_push',
      tone: 'High ambition',
      label: 'We should be pushing for the league.',
      preview: 'Only realistic when you are in the race or it is very early.',
      managerDelta: pos <= 2 ? 3 : -6,
      boardDelta: pos <= 2 ? 2 : -2,
      fanDelta: pos <= 2 ? 4 : -3,
      risk: pos > 2 ? 'high' : 'normal',
      traits: { ambition: 7, prudence: -2 },
      show: pos <= 3 || (early && targetPos <= 2),
    },
  ];
  return options.filter(opt => opt.show !== false && !(pressure.band === 'danger' && opt.id === 'keep_it_up'));
}

function supporterStatementOptions({ club, pos, track, pressure }) {
  const offTrack = track.state === 'offtrack';
  const options = [
    {
      id: 'trust_plan',
      tone: 'Calm',
      label: 'Trust the plan.',
      preview: 'Asks for patience and slightly steadies board confidence.',
      fanDelta: offTrack ? -1 : 4,
      boardDelta: 2,
      managerDelta: 1,
      traits: { patience: 2, supporter: 4 },
    },
    {
      id: 'back_manager_public',
      tone: 'Backing',
      label: 'I fully back the manager.',
      preview: 'Protects the coach, but puts your judgement in the spotlight.',
      fanDelta: offTrack ? -4 : 2,
      boardDelta: offTrack ? -1 : 1,
      managerDelta: 6,
      risk: offTrack ? 'high' : 'normal',
      traits: { patience: 4, delegation: 2 },
    },
    {
      id: 'own_results',
      tone: 'Accountability',
      label: 'Results must improve and I take responsibility.',
      preview: 'Usually lands well with supporters during poor runs.',
      fanDelta: pressure.band === 'danger' ? 6 : 3,
      boardDelta: 1,
      managerDelta: -1,
      traits: { supporter: 5, patience: 1 },
    },
    {
      id: 'demand_support',
      tone: 'Confrontational',
      label: 'Support your team and stop complaining.',
      preview: 'May briefly project authority, but can inflame a restless fanbase.',
      fanDelta: pressure.band === 'danger' ? -10 : -5,
      boardDelta: -2,
      managerDelta: 2,
      risk: 'high',
      traits: { supporter: -7, patience: -4 },
      show: pressure.band !== 'safe',
    },
  ];
  return options.filter(opt => opt.show !== false);
}

function holdManagerMeeting(action, context) {
  const club = userClub();
  const manager = club.manager;
  if (!manager) return;
  const option = managerStatementOptions(context).find(opt => opt.id === action);
  if (!option) return;
  manager.confidence = clampScore((manager.confidence ?? 60) + option.managerDelta);
  state.confidence = clampScore(state.confidence + option.boardDelta);
  state.fanTrust = clampScore((state.fanTrust ?? 60) + option.fanDelta);
  applyChairmanTrait(option.traits || {});
  state.boardPlan.lastManagerMeeting = { action, week: state.currentWeek, season: state.season };
  const reaction = managerReactionText(option, manager);
  addStory({
    title: `${club.short}: chairman speaks with ${manager.name}`,
    body: `"${option.label}" ${reaction} Manager confidence is now ${manager.confidence}/100.`,
    type: option.managerDelta < 0 ? 'result-bad' : 'board',
    category: 'Manager',
    importance: option.risk === 'high' ? 2 : 1,
  });
  alert(`${manager.name}: ${reaction}\n\nManager confidence ${manager.confidence}/100\nBoard confidence ${state.confidence}/100\nSupporter trust ${state.fanTrust}/100`);
  render();
}

function addressSupporters(action, context) {
  const club = userClub();
  const manager = club.manager;
  const option = supporterStatementOptions(context).find(opt => opt.id === action);
  if (!option) return;
  state.fanTrust = clampScore((state.fanTrust ?? 60) + option.fanDelta);
  state.confidence = clampScore(state.confidence + option.boardDelta);
  if (manager) manager.confidence = clampScore((manager.confidence ?? 60) + option.managerDelta);
  applyChairmanTrait(option.traits || {});
  const reaction = supporterReactionText(option, context.pressure);
  addStory({
    title: `${club.short} chairman addresses supporters`,
    body: `"${option.label}" ${reaction} Supporter trust is now ${state.fanTrust}/100.`,
    type: option.fanDelta < 0 ? 'result-bad' : 'board',
    category: 'Supporters',
    importance: option.risk === 'high' ? 2 : 1,
  });
  alert(`Supporter reaction: ${reaction}\n\nSupporter trust ${state.fanTrust}/100\nBoard confidence ${state.confidence}/100`);
  render();
}

function managerReactionText(option, manager) {
  if (option.managerDelta >= 6) return `${manager.name} welcomes the backing and feels trusted to continue the work.`;
  if (option.managerDelta >= 2) return `${manager.name} accepts the ambition as realistic and useful.`;
  if (option.managerDelta >= 0) return `${manager.name} sees it as a fair chairman message.`;
  if (option.managerDelta <= -6) return `${manager.name} feels the demand is unrealistic and privately pushes back.`;
  return `${manager.name} accepts the challenge, but pressure in the office rises.`;
}

function supporterReactionText(option, pressure) {
  if (option.fanDelta >= 5) return 'The message lands well because it acknowledges the mood and asks for improvement.';
  if (option.fanDelta > 0) return 'Most supporters accept the tone for now.';
  if (option.fanDelta <= -8) return 'The statement angers supporters and increases pressure on the chairman.';
  if (pressure.band === 'danger') return 'Supporters remain unconvinced while results are poor.';
  return 'The fanbase is split, but the statement does not create a major backlash.';
}

function supporterTrustLabel(score) {
  if (score >= 75) return 'Strong backing';
  if (score >= 50) return 'Patient';
  if (score >= 30) return 'Restless';
  return 'Revolt risk';
}

function traitsForRecruitmentPolicy(policy) {
  return {
    prospects: { youth: 6, prudence: 2, ambition: -1 },
    experience: { youth: -4, ambition: 2 },
    bargains: { prudence: 5, ambition: -1 },
    promotion_push: { ambition: 6, prudence: -3 },
    wage_control: { prudence: 6, ambition: -2 },
    balanced: { prudence: 1, delegation: 1 },
  }[policy] || {};
}

function traitsForBudgetPriority(priority) {
  return {
    squad: { ambition: 5, prudence: -3 },
    facilities: { youth: 4, prudence: 2, ambition: -1 },
    cautious: { prudence: 7, ambition: -3 },
    balanced: { prudence: 1, patience: 1 },
  }[priority] || {};
}

function hireDirector(id) {
  const club = userClub();
  const candidate = state.directorMarket.find(d => d.id === id);
  if (!candidate) return;
  const cost = candidate.compensation || 0;
  if (club.cash < cost) { alert('You cannot afford this staff package.'); return; }
  if (!confirm(`Hire ${candidate.name} as Director of Football for £${fmt(cost)}?`)) return;
  club.cash -= cost;
  club.director = { ...candidate, confidence: 60 };
  state.directorMarket = directorMarketForClub(club, state.season);
  applyChairmanTrait({ delegation: 5, prudence: candidate.speciality === 'wage_control' || candidate.speciality === 'bargains' ? 2 : 0 });
  addStory(directorAppointmentStory(club, club.director, cost));
  render();
}

function approveDecision(id) {
  const decision = state.decisions.find(d => d.id === id);
  if (!decision) return;
  const club = userClub();

  if (decision.type === 'scout_policy') {
    state.boardPlan.recruitmentPolicy = decision.payload.policy;
    applyChairmanTrait({ ...traitsForRecruitmentPolicy(decision.payload.policy), delegation: 2 });
    state.market = guidedMarket(club);
  }
  if (decision.type === 'back_manager' && club.manager) {
    club.manager.confidence = Math.min(95, (club.manager.confidence ?? 60) + 6);
    applyChairmanTrait({ patience: 4, delegation: 1 });
  }
  if (decision.type === 'tighten_spending' || decision.type === 'delay_facilities') {
    state.boardPlan.budgetPriority = decision.payload.priority || 'cautious';
    applyChairmanTrait({ ...traitsForBudgetPriority(state.boardPlan.budgetPriority), delegation: 1 });
  }
  if (decision.type === 'greenlight_transfer') {
    state.transferFilters = { ...(state.transferFilters || {}), affordableOnly: true };
    state.currentTab = 'transfers';
    applyChairmanTrait({ delegation: 3 });
  }
  if (decision.type === 'pressure_response') {
    state.confidence = Math.min(100, state.confidence + 3);
    state.fanTrust = clampScore((state.fanTrust ?? 60) + 3);
    applyChairmanTrait({ supporter: 3, patience: 1 });
  }
  if (decision.type === 'renew_contract') {
    const player = club.players.find(p => p.id === decision.payload.playerId);
    if (!player) return;
    const demand = contractDemand(player, club);
    if (club.cash < demand.signingFee) {
      alert(`You need £${fmt(demand.signingFee)} for the signing fee.`);
      return;
    }
    club.cash -= demand.signingFee;
    renewPlayerContract(player, demand);
    const view = managerPlayerView(player, club);
    applyChairmanTrait(view.band === 'safe' ? { patience: 2, delegation: 1 } : view.band === 'danger' ? { patience: 1, prudence: -1 } : { prudence: 1 });
    decision.impact = `${player.name} signs for ${demand.years} years at £${fmt(demand.newWage)}/wk. Signing fee: £${fmt(demand.signingFee)}.`;
  }

  addStory(staffDecisionStory(club, decision));
  state.decisions = state.decisions.filter(d => d.id !== id);
  render();
}

function chooseAgendaOption(id, choiceId) {
  const decision = state.decisions.find(d => d.id === id);
  const choice = decision?.choices?.find(c => c.id === choiceId);
  if (!decision || !choice) return;
  const club = userClub();
  const manager = club.manager;
  const applyManager = delta => {
    if (manager) manager.confidence = clampScore((manager.confidence ?? 60) + delta);
  };

  if (choice.effect === 'manager_back') {
    applyManager(7);
    state.fanTrust = clampScore((state.fanTrust ?? 60) - 2);
    applyChairmanTrait({ patience: 5, delegation: 2 });
  }
  if (choice.effect === 'manager_demand') {
    applyManager(-3);
    state.confidence = clampScore(state.confidence + 2);
    applyChairmanTrait({ ambition: 3, patience: -1 });
  }
  if (choice.effect === 'manager_shortlist') {
    state.managerMarket = availableManagersForClub(club, state.season);
    applyManager(-6);
    state.confidence = clampScore(state.confidence - 1);
    applyChairmanTrait({ patience: -5, ambition: 2 });
  }
  if (choice.effect === 'finance_protect') {
    state.boardPlan.budgetPriority = 'cautious';
    state.confidence = clampScore(state.confidence + 3);
    applyChairmanTrait({ prudence: 6, ambition: -2 });
  }
  if (choice.effect === 'finance_hold') {
    state.confidence = clampScore(state.confidence + 1);
    applyChairmanTrait({ patience: 2, prudence: 1 });
  }
  if (choice.effect === 'finance_push') {
    state.boardPlan.budgetPriority = 'squad';
    state.confidence = clampScore(state.confidence - 2);
    state.fanTrust = clampScore((state.fanTrust ?? 60) + 2);
    applyChairmanTrait({ ambition: 6, prudence: -5 });
  }
  if (choice.effect === 'recruitment_fund') {
    state.currentTab = 'transfers';
    state.transferFilters = { ...(state.transferFilters || {}), affordableOnly: false };
    applyChairmanTrait({ ambition: 3, delegation: 2 });
  }
  if (choice.effect === 'recruitment_value') {
    state.boardPlan.recruitmentPolicy = 'bargains';
    state.transferFilters = { ...(state.transferFilters || {}), affordableOnly: true };
    refreshDealRoomRecommendations(club, 'agenda-value');
    applyChairmanTrait({ prudence: 4, delegation: 1 });
  }
  if (choice.effect === 'recruitment_pause') {
    state.transferRecommendations = { ...(state.transferRecommendations || {}), ids: [] };
    applyChairmanTrait({ prudence: 3, patience: 2, ambition: -2 });
  }
  if (choice.effect === 'supporter_own') {
    state.fanTrust = clampScore((state.fanTrust ?? 60) + 5);
    state.confidence = clampScore(state.confidence + 1);
    applyChairmanTrait({ supporter: 5, patience: 1 });
  }
  if (choice.effect === 'supporter_quiet') {
    state.fanTrust = clampScore((state.fanTrust ?? 60) - 2);
    applyChairmanTrait({ prudence: 1, supporter: -1 });
  }
  if (choice.effect === 'supporter_staff') {
    applyManager(-4);
    state.fanTrust = clampScore((state.fanTrust ?? 60) + 1);
    applyChairmanTrait({ ambition: 2, patience: -3, supporter: -1 });
  }

  addStory({
    title: `${club.short}: ${decision.title}`,
    body: `Chairman choice: ${choice.label}. ${agendaChoiceSummary(choice.effect)}`,
    type: choice.risk === 'high' ? 'result-bad' : 'board',
    category: 'Boardroom',
    importance: decision.importance || 1,
  });
  state.decisions = state.decisions.filter(d => d.id !== id);
  render();
}

function agendaChoiceSummary(effect) {
  return {
    manager_back: 'The club chose stability and gave the manager breathing room.',
    manager_demand: 'The club raised expectations without changing personnel.',
    manager_shortlist: 'The club quietly opened a succession route.',
    finance_protect: 'Cash protection became the priority.',
    finance_hold: 'The club stayed balanced while monitoring risk.',
    finance_push: 'The chairman accepted financial risk to chase progress.',
    recruitment_fund: 'The recruitment brief moved to the front of the agenda.',
    recruitment_value: 'The DoF was asked to find a cheaper route.',
    recruitment_pause: 'The market was paused until the case is stronger.',
    supporter_own: 'Supporters heard a direct accountability message.',
    supporter_quiet: 'The chairman chose not to feed the noise.',
    supporter_staff: 'Pressure shifted toward the football staff.',
  }[effect] || 'The club direction shifted.';
}

function dismissDecision(id) {
  state.decisions = state.decisions.filter(d => d.id !== id);
  render();
}

function currentPressure(club, pos, track) {
  const history = state.clubHistory || createClubHistory(club);
  const latest = history.seasons?.at(-1) || null;
  const base = pressureSnapshot({
    club,
    position: pos,
    objective: state.objective,
    track,
    fanMood: fanMood(history, state.confidence, latest),
  });
  const trust = state.fanTrust ?? 60;
  const score = clampScore(base.score + (trust < 30 ? 14 : trust < 50 ? 7 : trust >= 75 ? -6 : 0));
  if (score >= 75) return { score, label: 'High pressure', band: 'danger', text: 'Supporters and media expect a visible response.' };
  if (score >= 52) return { score, label: 'Building pressure', band: 'warning', text: 'The mood is watchful, but still manageable.' };
  if (score >= 30) return { score, label: 'Normal scrutiny', band: 'ok', text: 'The club is under ordinary week-to-week attention.' };
  return { score, label: 'Calm', band: 'safe', text: 'Results, expectations, and supporter trust are giving the board room to plan.' };
}

function generateDecisionReports(reason = 'routine') {
  if (!state.league) return;
  const club = userClub();
  const table = divisionStandings(state.league.clubs, club.division);
  const pos = table.indexOf(club) + 1;
  const track = trackStatus(state.objective, pos, club.played);
  const pressure = currentPressure(club, pos, track);
  const forecast = financeForecast(club);
  const reports = createStaffReports({
    club,
    market: state.market,
    forecast,
    pressure,
    track,
    boardPlan: state.boardPlan,
    season: state.season,
    week: state.currentWeek,
    reason,
  });
  const actionReports = reports.filter(report => report.type === 'renew_contract');
  const agenda = createChairmanAgenda({ club, pos, track, pressure, forecast, reason });
  const enriched = [...actionReports.map(enrichDecisionReport), ...agenda];
  const existing = new Set((state.decisions || []).map(decisionKey));
  const fresh = enriched.filter(d => !existing.has(decisionKey(d)));
  state.decisions = dedupeDecisions([...(state.decisions || []), ...fresh])
    .sort((a, b) => (b.importance || 1) - (a.importance || 1))
    .slice(0, 8);
}

function createChairmanAgenda({ club, pos, track, pressure, forecast }) {
  const agenda = [];
  const period = Math.max(0, Math.floor((state.currentWeek || 0) / 4));
  if (club.played >= 4 && (track.state === 'offtrack' || pressure.band === 'danger')) {
    agenda.push({
      id: `S${state.season}-P${period}-agenda-manager-path`,
      type: 'chairman_agenda',
      source: 'Chairman Agenda',
      title: 'Manager path',
      body: 'Results are drifting. Do you protect stability or force a change in tone?',
      importance: pressure.band === 'danger' ? 3 : 2,
      choices: [
        { id: 'back', label: 'Back him', effect: 'manager_back' },
        { id: 'demand', label: 'Demand response', effect: 'manager_demand' },
        { id: 'shortlist', label: 'Review alternatives', effect: 'manager_shortlist', risk: 'high' },
      ],
    });
  }
  if (forecast?.risk === 'danger' || forecast?.risk === 'warning' || forecast?.remainingWeeklyWage < 0) {
    agenda.push({
      id: `S${state.season}-P${period}-agenda-finance-path`,
      type: 'chairman_agenda',
      source: 'Chairman Agenda',
      title: 'Money or momentum',
      body: 'Finance is tightening. Do you protect the club or keep backing the sporting push?',
      importance: forecast.risk === 'danger' ? 3 : 2,
      choices: [
        { id: 'protect', label: 'Protect cash', effect: 'finance_protect' },
        { id: 'hold', label: 'Hold course', effect: 'finance_hold' },
        { id: 'push', label: 'Keep pushing', effect: 'finance_push', risk: 'high' },
      ],
    });
  }
  if (state.transferRecommendations?.ids?.length) {
    agenda.push({
      id: `S${state.season}-P${period}-agenda-recruitment-path`,
      type: 'chairman_agenda',
      source: 'Chairman Agenda',
      title: 'Recruitment direction',
      body: 'The DoF has a live brief. Do you fund it, seek value, or pause the market?',
      importance: 2,
      choices: [
        { id: 'fund', label: 'Fund brief', effect: 'recruitment_fund' },
        { id: 'value', label: 'Find value', effect: 'recruitment_value' },
        { id: 'pause', label: 'Pause market', effect: 'recruitment_pause' },
      ],
    });
  }
  if (pressure.band === 'warning' || pressure.band === 'danger') {
    agenda.push({
      id: `S${state.season}-P${period}-agenda-supporter-path`,
      type: 'chairman_agenda',
      source: 'Chairman Agenda',
      title: 'Public message',
      body: 'The mood is getting louder. Do you speak, stay quiet, or put pressure on football staff?',
      importance: pressure.band === 'danger' ? 3 : 2,
      choices: [
        { id: 'own', label: 'Own it', effect: 'supporter_own' },
        { id: 'quiet', label: 'Stay quiet', effect: 'supporter_quiet' },
        { id: 'staff', label: 'Pressure staff', effect: 'supporter_staff', risk: 'high' },
      ],
    });
  }
  return agenda.sort((a, b) => (b.importance || 1) - (a.importance || 1)).slice(0, 1);
}

function dedupeDecisions(decisions) {
  const seen = new Set();
  return decisions.filter(decision => {
    const key = decisionKey(decision);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function decisionKey(decision) {
  if (!decision) return '';
  if (decision.type === 'chairman_agenda') return decision.id;
  if (decision.type === 'renew_contract') {
    return `${state.season}:renew_contract:${decision.payload?.playerId || ''}`;
  }
  if (decision.type === 'greenlight_transfer') {
    return `${state.season}:greenlight_transfer:${decision.payload?.playerId || ''}`;
  }
  if (decision.type === 'scout_policy') {
    return `${state.season}:scout_policy:${decision.payload?.policy || ''}`;
  }
  return `${state.season}:${decision.type}`;
}

function enrichDecisionReport(decision) {
  if (decision.type !== 'renew_contract') return decision;
  const player = userClub().players.find(p => p.id === decision.payload?.playerId);
  if (!player) return decision;
  const view = managerPlayerView(player, userClub());
  const hasViewText = decision.body?.includes('Manager view:');
  return {
    ...decision,
    body: hasViewText ? decision.body : `${decision.body} Manager view: ${view.contractText}.`,
    managerView: view,
  };
}

function managerPlayerView(player, club) {
  const xi = new Set(club.bestEleven().map(p => p.id));
  const samePosition = club.players.filter(p => p.position === player.position).sort((a, b) => b.overall - a.overall);
  const rank = samePosition.findIndex(p => p.id === player.id) + 1;
  const avg = avgOverall(club);
  const isStarter = xi.has(player.id);
  const thinPosition = samePosition.length <= ({ GK: 2, DEF: 5, MID: 5, FWD: 3 }[player.position] || 4);
  if (isStarter && (player.overall >= avg || rank === 1)) {
    return {
      band: 'safe',
      label: 'Key player',
      contractText: 'the manager wants this key player kept',
      saleText: 'this is a key player the manager wants to keep',
    };
  }
  if (isStarter || rank <= 2 || thinPosition) {
    return {
      band: 'warning',
      label: 'Keep if sensible',
      contractText: 'the manager sees him as useful, but only on sensible wages',
      saleText: 'the manager would prefer to keep him unless the fee funds a clear upgrade',
    };
  }
  if (player.age <= 23 && player.potential >= avg + 5) {
    return {
      band: 'warning',
      label: 'Development player',
      contractText: 'the manager sees development value, but not as a guaranteed starter',
      saleText: 'the manager is open to a sale only if the price reflects his potential',
    };
  }
  return {
    band: 'danger',
    label: 'Not in plans',
    contractText: 'he is not central to the manager plans',
    saleText: 'the manager is comfortable selling',
  };
}

/* ---------- Squad ---------- */
function renderSquad() {
  const club = userClub();
  const availability = availabilityByPosition(club);
  const injuries = injuredPlayers(club);
  const players = club.players.slice().sort((a, b) =>
    (a.available === false) - (b.available === false) ||
    posOrder(a.position) - posOrder(b.position) || b.overall - a.overall);
  const xi = new Set(club.bestEleven().map(p => p.id));

  const rows = players.map(p => {
    const contract = contractStatus(p);
    const view = managerPlayerView(p, club);
    return `
    <tr class="${xi.has(p.id) ? 'highlight-row' : ''} ${p.available === false ? 'unavailable-row' : ''}">
      <td>${p.name} ${xi.has(p.id) ? '<span class="small success">●</span>' : ''}</td>
      <td><span class="pill ${p.position.toLowerCase()}">${p.position}</span></td>
      <td class="num">${p.age}</td>
      <td class="num"><strong>${p.overall}</strong></td>
      <td class="num">${p.attack}</td>
      <td class="num">${p.defense}</td>
      <td class="num">${p.passing}</td>
      <td class="num">${p.finish}</td>
      <td class="num small">${p.form.toFixed(2)}</td>
      <td class="${p.available === false ? 'danger' : 'success'} small">${p.available === false ? `${p.injury} · ${p.injuryWeeks}w` : 'Available'}</td>
      <td class="num">£${fmt(p.wage)}</td>
      <td class="${bandClass(contract.band)} small">${contract.label}</td>
      <td class="${bandClass(view.band)} small">${view.label}</td>
      <td class="num">£${fmt(p.value)}</td>
      <td><button class="btn-ghost btn-sm" data-sell="${p.id}">${outgoingOfferForPlayer(p.id) ? 'Offer live' : 'Invite offers'}</button></td>
    </tr>
  `;
  }).join('');

  document.getElementById('squad').innerHTML = `
    ${renderSquadDevelopmentReport()}
    <div class="card">
      <div class="flex-between">
        <h2 class="mb0">Availability</h2>
        <span class="${injuries.length ? 'danger' : 'success'} small">${injuries.length ? `${injuries.length} unavailable` : 'Full squad available'}</span>
      </div>
      <div class="need-grid mt">
        ${availability.map(a => `<div class="need-card ${a.available < Math.min(a.total, { GK: 1, DEF: 3, MID: 3, FWD: 1 }[a.position]) ? 'urgent' : 'covered'}">
          <span>${a.position}</span>
          <strong>${a.available}/${a.total}</strong>
          <small>Available</small>
        </div>`).join('')}
      </div>
    </div>
    <div class="card">
      <h2>Squad · ${players.length} players <span class="muted small">(● = starting XI)</span></h2>
      <div style="overflow-x:auto">
      <table>
        <thead><tr>
          <th>Name</th><th>Pos</th><th class="num">Age</th><th class="num">OVR</th>
          <th class="num">Att</th><th class="num">Def</th><th class="num">Pas</th><th class="num">Fin</th>
          <th class="num">Form</th><th>Status</th><th class="num">Wage</th><th>Contract</th><th>Manager view</th><th class="num">Value</th><th></th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      </div>
    </div>`;

  document.querySelectorAll('[data-sell]').forEach(btn => {
    btn.addEventListener('click', () => {
      const p = club.players.find(x => x.id === btn.dataset.sell);
      if (!p) return;
      if (club.players.length <= 11) { alert('You need at least 11 players.'); return; }
      const existing = outgoingOfferForPlayer(p.id);
      if (existing) {
        state.currentTab = 'transfers';
        render();
        return;
      }
      const offer = createOutgoingOffer(p, club);
      state.outgoingOffers = [...(state.outgoingOffers || []), offer];
      applyChairmanTrait({ prudence: 1, delegation: 1 });
      addStory({
        title: `${club.short} receive offer for ${p.name}`,
        body: `${offer.buyerName} have offered £${fmt(offer.fee)}. The offer expires in ${offer.expiresEvent - state.currentEvent} calendar events.`,
        type: 'transfer',
        category: 'Transfers',
        importance: offer.managerBand === 'danger' ? 2 : 1,
      });
      state.currentTab = 'transfers';
      render();
    });
  });
}

function outgoingOfferForPlayer(playerId) {
  return (state.outgoingOffers || []).find(offer => offer.playerId === playerId);
}

function createOutgoingOffer(player, club) {
  const buyer = state.league.clubs
    .filter(c => c.id !== club.id && c.division <= club.division + 1)
    .sort(() => Math.random() - 0.5)[0] || null;
  const view = managerPlayerView(player, club);
  const cover = squadSaleCover(player, club);
  const premium = view.band === 'danger' ? 1.15 : view.band === 'safe' ? 0.96 : 1.05;
  const fee = Math.round(player.value * premium);
  return {
    id: `out-${state.season}-${state.currentEvent}-${player.id}`,
    playerId: player.id,
    playerName: player.name,
    position: player.position,
    buyerName: buyer?.name || 'Interested club',
    fee,
    originalFee: fee,
    createdEvent: state.currentEvent,
    expiresEvent: Math.min((state.seasonCalendar?.length || 46) + 1, state.currentEvent + 3),
    holdCount: 0,
    negotiationCount: 0,
    replacementSearch: false,
    managerBand: view.band,
    managerText: view.saleText,
    coverText: cover.text,
    coverBand: cover.band,
  };
}

function squadSaleCover(player, club) {
  const samePosition = club.players.filter(p => p.id !== player.id && p.position === player.position && p.available !== false);
  const minimum = { GK: 1, DEF: 3, MID: 3, FWD: 1 }[player.position] || 1;
  if (samePosition.length < minimum) {
    return { band: 'danger', text: `Selling leaves only ${samePosition.length} available ${player.position}. Replacement needed.` };
  }
  if (samePosition.length === minimum) {
    return { band: 'warning', text: `${player.position} cover becomes thin. Replacement search recommended.` };
  }
  return { band: 'safe', text: `${player.position} cover remains acceptable after sale.` };
}

function renderSquadDevelopmentReport() {
  const report = state.developmentReport;
  if (!report) return '';
  const changeRows = report.changes.length
    ? report.changes.map(c => `<tr>
        <td>${c.name}</td>
        <td><span class="pill ${c.position.toLowerCase()}">${c.position}</span></td>
        <td class="num">${c.age}</td>
        <td class="num">${c.before}</td>
        <td class="num ${c.delta > 0 ? 'success' : 'danger'}">${signed(c.delta)}</td>
        <td class="num"><strong>${c.after}</strong></td>
        <td class="small muted">${c.reason}</td>
      </tr>`).join('')
    : '<tr><td colspan="7" class="muted">No rating changes last season.</td></tr>';
  const intakeRows = report.intake.length
    ? report.intake.map(p => `<tr>
        <td>${p.name}</td>
        <td><span class="pill ${p.position.toLowerCase()}">${p.position}</span></td>
        <td class="num">${p.age}</td>
        <td class="num"><strong>${Player.overallOf(p)}</strong></td>
        <td class="num gold">${p.potential}</td>
        <td class="num">£${fmt(p.wage)}</td>
      </tr>`).join('')
    : '<tr><td colspan="6" class="muted">No academy intake recorded.</td></tr>';

  return `<div class="card">
    <div class="flex-between">
      <h2 class="mb0">Development Report</h2>
      <span class="muted small">Season ${report.season}</span>
    </div>
    <p class="muted small mt">${report.summary.text}</p>
    <div class="grid mt">
      <div class="mini-panel">
        <span class="muted small">Training impact</span>
        <strong>Level ${userClub().training}</strong>
      </div>
      <div class="mini-panel">
        <span class="muted small">Academy pathway</span>
        <strong>Level ${userClub().academy}</strong>
      </div>
    </div>
    <h3 class="mt">Player Changes</h3>
    <div style="overflow-x:auto">
      <table>
        <thead><tr><th>Name</th><th>Pos</th><th class="num">Age</th><th class="num">Before</th><th class="num">Change</th><th class="num">Now</th><th>Reason</th></tr></thead>
        <tbody>${changeRows}</tbody>
      </table>
    </div>
    <h3 class="mt">Academy Intake</h3>
    <div style="overflow-x:auto">
      <table>
        <thead><tr><th>Name</th><th>Pos</th><th class="num">Age</th><th class="num">OVR</th><th class="num">POT</th><th class="num">Wage</th></tr></thead>
        <tbody>${intakeRows}</tbody>
      </table>
    </div>
  </div>`;
}

/* ---------- Manager ---------- */
function renderManager() {
  const club = userClub();
  if (!club.manager) {
    club.manager = availableManagersForClub(club, state.season, 1)[0];
  }
  applyManagerTactics(club);
  const manager = club.manager;
  const status = managerStatus(manager, club);
  const style = MANAGER_STYLES[manager.style] || MANAGER_STYLES.balanced;
  const directive = CHAIRMAN_DIRECTIVES[manager.directive || 'trust'];
  const r = teamRatings(club);
  const candidates = state.managerMarket.length ? state.managerMarket : availableManagersForClub(club, state.season);
  state.managerMarket = candidates;

  document.getElementById('manager').innerHTML = `
    <div class="card">
      <div class="flex-between">
        <div>
          <h2 class="mb0">Head Coach</h2>
          <p class="muted small">As chairman, you set direction. The manager turns that into the tactical plan.</p>
        </div>
        <span class="pill obj-${status.band === 'safe' ? 'ontrack' : status.band === 'warning' ? 'close' : status.band === 'danger' ? 'offtrack' : 'pending'}">${status.label}</span>
      </div>
      <div class="grid mt">
        <div class="mini-panel"><span class="muted small">Manager</span><strong>${manager.name}</strong></div>
        <div class="mini-panel"><span class="muted small">Style</span><strong>${style.label}</strong></div>
        <div class="mini-panel"><span class="muted small">Rating</span><strong>${manager.rating}/100</strong></div>
        <div class="mini-panel"><span class="muted small">Confidence</span><strong>${manager.confidence ?? 60}/100</strong></div>
        <div class="mini-panel"><span class="muted small">Contract</span><strong>${manager.contractYears} yrs · £${fmt(manager.wage)}/wk</strong></div>
      </div>
      <p class="muted mt">${style.text}</p>
      <p class="small ${bandClass(status.band)}">${status.text} Fit score: ${managerFit(manager, club)}/100.</p>
      <div class="form-row">
        <label>Chairman instruction</label>
        <select id="managerDirective">
          ${Object.entries(CHAIRMAN_DIRECTIVES).map(([key, value]) => `<option value="${key}" ${key === (manager.directive || 'trust') ? 'selected' : ''}>${value.label}</option>`).join('')}
        </select>
      </div>
      <p class="muted small">${directive.text}</p>
    </div>
    <div class="card">
      <h2>Manager Tactical Output</h2>
      <p class="muted small">This is not direct touchline control. It shows how the manager and chairman instruction translate into the transparent match ratings.</p>
      <div class="grid mt">
        <div class="mini-panel"><span class="muted small">Mentality</span><strong>${labelText(club.tactics.mentality)}</strong></div>
        <div class="mini-panel"><span class="muted small">Pressing</span><strong>${labelText(club.tactics.pressing)}</strong></div>
      </div>
      <div class="attr-bar"><span class="val">ATT</span><div class="bar"><div class="bar-fill blue" style="width:${Math.min(100, r.attack)}%"></div></div><span class="val">${Math.round(r.attack)}</span></div>
      <div class="attr-bar mt"><span class="val">DEF</span><div class="bar"><div class="bar-fill green" style="width:${Math.min(100, r.defense)}%"></div></div><span class="val">${Math.round(r.defense)}</span></div>
    </div>
    <div class="card">
      <div class="flex-between">
        <h2 class="mb0">Available Managers</h2>
        <button class="btn-ghost btn-sm" id="refreshManagers">Refresh shortlist</button>
      </div>
      <p class="muted small mt">Hiring a new head coach replaces the current manager and pays the listed compensation package.</p>
      <table class="mt">
        <thead><tr><th>Name</th><th>Style</th><th class="num">Rating</th><th class="num">Fit</th><th class="num">Cost</th><th></th></tr></thead>
        <tbody>${candidates.map(candidate => `
          <tr>
            <td>${candidate.name}<br><span class="muted small">${candidate.age} · ${candidate.personality}</span></td>
            <td>${MANAGER_STYLES[candidate.style]?.label || 'Balanced'}</td>
            <td class="num">${candidate.rating}</td>
            <td class="num">${managerFit(candidate, club)}</td>
            <td class="num">£${fmt(managerCompensation(candidate, club))}</td>
            <td><button class="btn btn-sm" data-hire-manager="${candidate.id}" ${club.cash < managerCompensation(candidate, club) ? 'disabled' : ''}>Hire</button></td>
          </tr>`).join('')}</tbody>
      </table>
    </div>`;

  document.getElementById('managerDirective').addEventListener('change', e => {
    manager.directive = e.target.value;
    applyManagerTactics(club);
    addStory(managerDirectiveStory(club, manager));
    render();
  });
  document.getElementById('refreshManagers').addEventListener('click', () => {
    state.managerMarket = availableManagersForClub(club, state.season);
    render();
  });
  document.querySelectorAll('[data-hire-manager]').forEach(btn => {
    btn.addEventListener('click', () => hireManager(btn.dataset.hireManager));
  });
}

function hireManager(id) {
  const club = userClub();
  const candidate = state.managerMarket.find(m => m.id === id);
  if (!candidate) return;
  const cost = managerCompensation(candidate, club);
  if (club.cash < cost) { alert('You cannot afford the compensation package.'); return; }
  if (!confirm(`Hire ${candidate.name} for £${fmt(cost)} compensation?`)) return;
  const previousRating = club.manager?.rating || 0;
  club.cash -= cost;
  club.manager = { ...candidate, confidence: 60, directive: 'trust' };
  applyManagerTactics(club);
  state.managerMarket = availableManagersForClub(club, state.season);
  applyChairmanTrait({ ambition: candidate.rating >= previousRating ? 3 : 1, patience: -3, delegation: 2 });
  addStory(managerAppointmentStory(club, club.manager, cost));
  render();
}

function labelText(value) {
  return String(value || '').replace('_', ' ').replace(/^\w/, c => c.toUpperCase());
}

/* ---------- Fixtures ---------- */
function renderFixtures() {
  syncSeasonCalendar();
  const rows = state.seasonCalendar.map((event, i) => {
    const fx = fixtureForCalendarEvent(event);
    const home = fx ? state.league.clubsById[fx.home] : null;
    const away = fx ? state.league.clubsById[fx.away] : null;
    const status = event.played ? 'played' : (i === state.currentEvent ? 'next' : 'scheduled');
    const detail = event.result?.text || (fx
      ? `${home.name} vs ${away.name}`
      : event.type === 'cup' ? `${event.label} draw to be confirmed` : event.label);
    const context = !event.played && fx ? calendarFixtureContext(fx, event) : event.result ? resultContext(event.result) : '';
    return `<tr class="${status === 'next' ? 'highlight-row' : ''}">
      <td>${event.date}</td>
      <td>${event.type === 'cup' ? state.cup.name : 'League'}</td>
      <td>${event.label}</td>
      <td>${detail}</td>
      <td>${context}</td>
      <td class="center">${event.played ? resultLabel(event.result) : (status === 'next' ? 'Next' : 'Scheduled')}</td>
    </tr>`;
  }).join('');

  document.getElementById('fixtures').innerHTML = `
    <div class="card">
      <h2>Game Day Calendar · Season ${state.season}</h2>
      <p class="muted small mt">League matchweeks and cup rounds are pre-scheduled here. Cup draws populate as each previous round is completed.</p>
      <table>
        <thead><tr><th>Date</th><th>Competition</th><th>Round</th><th>Fixture / Result</th><th>Context</th><th class="center">Status</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

/* ---------- Cup ---------- */
function renderCup() {
  const club = userClub();
  const cup = state.cup || createCup(state.league.clubs, state.season);
  const current = cupCurrentRound(cup);
  const status = cupStatus(cup, club.id);
  const rounds = cup.rounds.map((r, i) => `
    <tr class="${i === cup.roundIndex && cup.status === 'active' ? 'highlight-row' : ''}">
      <td>${r.name}</td>
      <td>${calendarDateForCupRound(i)}</td>
      <td class="num">£${fmt(r.prize)}</td>
      <td>${r.played ? 'Played' : i === cup.roundIndex ? 'Next draw' : 'Scheduled'}</td>
    </tr>`).join('');

  document.getElementById('cup').innerHTML = `
    <div class="card">
      <div class="flex-between">
        <div>
          <h2 class="mb0">${cup.name}</h2>
          <p class="muted small">Season ${cup.season} · knockout cup across the full pyramid</p>
        </div>
        <span class="pill obj-${status.band}">${status.label}</span>
      </div>
      <p class="muted mt">${status.text}</p>
      <div class="stat-row mt">
        <div class="stat"><strong>Current Round</strong><span>${current ? current.short : 'Done'}</span></div>
        <div class="stat"><strong>Prize</strong><span>${current ? `£${fmt(current.prize)}` : '—'}</span></div>
        <div class="stat"><strong>Champion</strong><span>${cup.championId ? state.league.clubsById[cup.championId].short : '—'}</span></div>
      </div>
      <button class="btn-ghost mt" id="cupCalendar">View calendar</button>
    </div>

    <div class="grid">
      <div class="card mb0">
        <h3>Current Draw</h3>
        ${renderCupFixtures(current)}
      </div>
      <div class="card mb0">
        <h3>Round Schedule</h3>
        <table><thead><tr><th>Round</th><th>Date</th><th class="num">Prize</th><th>Status</th></tr></thead><tbody>${rounds}</tbody></table>
      </div>
    </div>

    <div class="card">
      <h3>Latest Cup Results</h3>
      ${renderCupResults(state.lastCupResults)}
    </div>`;

  const calBtn = document.getElementById('cupCalendar');
  if (calBtn) calBtn.addEventListener('click', () => switchTab('fixtures'));
}

function renderCupFixtures(round) {
  if (!round) return '<p class="muted small">Competition complete.</p>';
  const rows = round.fixtures.map(f => {
    const home = state.league.clubsById[f.home];
    const away = state.league.clubsById[f.away];
    const involved = home === userClub() || away === userClub();
    const preview = cupFixturePreview(home, away);
    return `<tr class="${involved ? 'highlight-row' : ''}">
      <td>${home.name}</td>
      <td class="center">vs</td>
      <td>${away.name}</td>
      <td class="num small">${preview.home}% / ${preview.draw}% / ${preview.away}%</td>
    </tr>`;
  }).join('');
  return `<table><thead><tr><th>Home</th><th></th><th>Away</th><th class="num">H/D/A</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderCupResults(results) {
  if (!results.length) return '<p class="muted small">No cup round played yet.</p>';
  const rows = results.map(r => {
    const involved = r.home === userClub() || r.away === userClub();
    const tie = r.tiebreak ? `<span class="muted small"> · pens ${r.tiebreak.penaltyScore}</span>` : '';
    return `<tr class="${involved ? 'highlight-row' : ''}">
      <td>${r.home.name}</td>
      <td class="center"><strong>${r.homeGoals} – ${r.awayGoals}</strong>${tie}</td>
      <td>${r.away.name}</td>
      <td>${r.winner.short}</td>
    </tr>`;
  }).join('');
  return `<table><thead><tr><th>Home</th><th class="center">Score</th><th>Away</th><th>Advances</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function cupFixturePreview(home, away) {
  const probs = outcomeProbabilities(teamRatings(home, HOME_BONUS), teamRatings(away, 0));
  return { home: pct(probs.homeWin), draw: pct(probs.draw), away: pct(probs.awayWin) };
}

/* ---------- Table (full pyramid) ---------- */
function renderTable() {
  const club = userClub();
  let html = '';

  for (let d = TOP_DIVISION; d <= BOTTOM_DIVISION; d++) {
    const divInfo = DIVISIONS[d];
    const table = divisionStandings(state.league.clubs, d);
    const size = table.length;

    const rows = table.map((c, i) => {
      const rank = i + 1;
      // Promotion zone (green) / relegation zone (red) markers.
      const promo = d > TOP_DIVISION && rank <= PROMOTE;
      const releg = d < BOTTOM_DIVISION && rank > size - RELEGATE;
      const zone = promo ? 'zone-promo' : releg ? 'zone-releg' : '';
      return `<tr class="${c === club ? 'highlight-row' : ''} ${zone}">
        <td class="num">${rank}</td>
        <td>${c.name}${c === club ? ' <span class="small gold">(you)</span>' : ''}</td>
        <td class="num">${c.played}</td>
        <td class="num">${c.won}</td>
        <td class="num">${c.drawn}</td>
        <td class="num">${c.lost}</td>
        <td class="num">${c.gf}</td>
        <td class="num">${c.ga}</td>
        <td class="num">${c.goalDiff > 0 ? '+' : ''}${c.goalDiff}</td>
        <td class="num"><strong>${c.points}</strong></td>
      </tr>`;
    }).join('');

    const legend = [];
    if (d > TOP_DIVISION) legend.push('<span class="dot-promo"></span> Promotion');
    if (d < BOTTOM_DIVISION) legend.push('<span class="dot-releg"></span> Relegation');

    html += `
      <div class="card">
        <div class="flex-between">
          <h2 class="mb0">${divInfo.name} <span class="muted small">(${divInfo.short})</span></h2>
          <span class="small muted">${legend.join(' &nbsp; ')}</span>
        </div>
        <div style="overflow-x:auto">
        <table>
          <thead><tr>
            <th class="num">#</th><th>Club</th><th class="num">P</th><th class="num">W</th>
            <th class="num">D</th><th class="num">L</th><th class="num">GF</th><th class="num">GA</th>
            <th class="num">GD</th><th class="num">Pts</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
        </div>
      </div>`;
  }

  html += `<p class="muted small">Top ${PROMOTE} of each division promoted · Bottom ${RELEGATE} relegated (applied at season end). Other divisions are auto-simulated.</p>`;
  document.getElementById('table').innerHTML = html;
}

/* ---------- Transfers ---------- */
function renderTransfers() {
  const club = userClub();
  const positionFilter = state.transferFilters?.position || 'ALL';
  const affordableOnly = !!state.transferFilters?.affordableOnly;
  const needs = squadNeeds(club);
  const filtered = state.market.filter(p => {
    const fit = transferFit(p, club);
    if (positionFilter !== 'ALL' && p.position !== positionFilter) return false;
    if (affordableOnly && !fit.affordable) return false;
    return true;
  });

  const needCards = needs.map(n => `
    <div class="need-card ${n.priority}">
      <span>${n.position}</span>
      <strong>${n.count}/${n.desired}</strong>
      <small>${n.label}${n.bestOverall ? ` · Best ${n.bestOverall}` : ''}</small>
    </div>
  `).join('');

  const rows = filtered
    .slice()
    .sort((a, b) => transferPolicyScore(b, club).score - transferPolicyScore(a, club).score)
    .map(p => {
    const fit = transferFit(p, club);
    const policyFit = transferPolicyScore(p, club, fit);
    const rec = policyRecommendation(policyFit.score);
    const fitClass = bandClass(fit.clubFit?.band || 'warning');
    return `
    <tr>
      <td>${p.name}</td>
      <td><span class="pill ${p.position.toLowerCase()}">${p.position}</span></td>
      <td class="num">${p.age}</td>
      <td class="num"><strong>${p.overall}</strong></td>
      <td><span class="${fitClass} small">${fit.clubFit?.label || 'Club fit'}</span></td>
      <td class="num">£${fmt(p.wage)}/wk</td>
      <td class="num">£${fmt(fit.askingPrice)}</td>
      <td><span class="muted small">${fit.clubFit?.reason || fit.recommendation}</span></td>
      <td><span class="${bandClass(rec.band)} small">${rec.label}</span></td>
      <td><button class="btn btn-sm" data-buy="${p.id}">Bid</button></td>
    </tr>`;
  }).join('');

  document.getElementById('transfers').innerHTML = `
    ${renderOutgoingOffers(club)}
    ${renderDealRoom(club)}
    <div class="card">
      <div class="flex-between">
        <h2 class="mb0">Transfer Market</h2>
        <span class="success"><strong>£${fmt(club.cash)}</strong> available</span>
      </div>
      <p class="muted small mt">Bids are judged transparently. ${club.director?.name || 'Your staff'} sort targets against the board's ${RECRUITMENT_POLICIES[state.boardPlan.recruitmentPolicy]?.label || 'Balanced'} recruitment brief.</p>
      <div class="need-grid mt">${needCards}</div>
      <div class="transfer-toolbar mt">
        <label>
          Position
          <select id="transferPositionFilter">
            ${transferFilterOption('ALL', 'All', positionFilter)}
            ${transferFilterOption('GK', 'GK', positionFilter)}
            ${transferFilterOption('DEF', 'DEF', positionFilter)}
            ${transferFilterOption('MID', 'MID', positionFilter)}
            ${transferFilterOption('FWD', 'FWD', positionFilter)}
          </select>
        </label>
        <label class="checkbox-row">
          <input type="checkbox" id="transferAffordableOnly" ${affordableOnly ? 'checked' : ''} />
          Affordable only
        </label>
        <button class="btn-ghost" id="refreshMarket">Scout new targets</button>
      </div>
      <table>
        <thead><tr><th>Name</th><th>Pos</th><th class="num">Age</th><th class="num">OVR</th><th>Club Fit</th><th class="num">Wage</th><th class="num">Fee</th><th>Reason</th><th>DoF View</th><th></th></tr></thead>
        <tbody>${rows || '<tr><td colspan="10" class="muted">No targets match these filters.</td></tr>'}</tbody>
      </table>
    </div>`;

  document.querySelectorAll('[data-buy]').forEach(btn => {
    btn.addEventListener('click', () => openBid(btn.dataset.buy));
  });
  document.querySelectorAll('[data-offer-accept]').forEach(btn => {
    btn.addEventListener('click', () => acceptOutgoingOffer(btn.dataset.offerAccept));
  });
  document.querySelectorAll('[data-offer-reject]').forEach(btn => {
    btn.addEventListener('click', () => rejectOutgoingOffer(btn.dataset.offerReject));
  });
  document.querySelectorAll('[data-offer-hold]').forEach(btn => {
    btn.addEventListener('click', () => holdOutgoingOffer(btn.dataset.offerHold));
  });
  document.querySelectorAll('[data-offer-negotiate]').forEach(btn => {
    btn.addEventListener('click', () => negotiateOutgoingOffer(btn.dataset.offerNegotiate));
  });
  document.querySelectorAll('[data-offer-replace]').forEach(btn => {
    btn.addEventListener('click', () => scoutReplacementForOffer(btn.dataset.offerReplace));
  });
  document.querySelectorAll('[data-deal-approve]').forEach(btn => {
    btn.addEventListener('click', () => approveDealRoomTarget(btn.dataset.dealApprove));
  });
  document.querySelectorAll('[data-deal-cheaper]').forEach(btn => {
    btn.addEventListener('click', () => askForCheaperOption(btn.dataset.dealCheaper));
  });
  document.querySelectorAll('[data-deal-defer]').forEach(btn => {
    btn.addEventListener('click', () => deferDealRoomTarget(btn.dataset.dealDefer));
  });
  document.querySelectorAll('[data-deal-reject]').forEach(btn => {
    btn.addEventListener('click', () => rejectDealRoomTarget(btn.dataset.dealReject));
  });
  document.getElementById('transferPositionFilter').addEventListener('change', e => {
    state.transferFilters = { ...(state.transferFilters || {}), position: e.target.value };
    render();
  });
  document.getElementById('transferAffordableOnly').addEventListener('change', e => {
    state.transferFilters = { ...(state.transferFilters || {}), affordableOnly: e.target.checked };
    render();
  });
  document.getElementById('refreshMarket').addEventListener('click', () => {
    state.market = guidedMarket(club);
    refreshDealRoomRecommendations(club, 'scout-refresh');
    addStory(transferMarketStory(state.market, club));
    render();
  });
}

function renderOutgoingOffers(club) {
  const offers = (state.outgoingOffers || [])
    .map(offer => ({ offer, player: club.players.find(p => p.id === offer.playerId) }))
    .filter(item => item.player);
  if (!offers.length) return `<div class="card">
    <div class="flex-between">
      <h2 class="mb0">Outgoing Offers</h2>
      <span class="muted small">No live bids</span>
    </div>
    <p class="muted small mt">Player sales appear here first, so you can delay, negotiate, or ask the DoF to find cover before accepting.</p>
  </div>`;
  return `<div class="card">
    <div class="flex-between">
      <h2 class="mb0">Outgoing Offers</h2>
      <span class="warning small">${offers.length} live</span>
    </div>
    <div class="grid mt">
      ${offers.map(({ offer, player }) => renderOutgoingOfferCard(offer, player)).join('')}
    </div>
  </div>`;
}

function renderOutgoingOfferCard(offer, player) {
  const expiresIn = Math.max(0, (offer.expiresEvent ?? state.currentEvent) - state.currentEvent);
  return `<div class="mini-panel">
    <span class="story-kicker">${offer.buyerName}</span>
    <span class="muted small">${player.position} · ${player.age} yrs · ${player.overall} OVR</span>
    <strong>${player.name}</strong>
    <span class="success small">Offer £${fmt(offer.fee)}</span>
    <span class="${bandClass(offer.managerBand)} small">Manager: ${offer.managerText}</span>
    <span class="${bandClass(offer.coverBand)} small">${offer.coverText}</span>
    <span class="muted small">Expires in ${expiresIn} event${expiresIn === 1 ? '' : 's'}${offer.replacementSearch ? ' · replacement search active' : ''}</span>
    <div class="flex mt action-row">
      <button class="btn btn-sm" data-offer-accept="${offer.id}">Accept</button>
      <button class="btn-ghost btn-sm" data-offer-replace="${offer.id}">Find replacement</button>
      <button class="btn-ghost btn-sm" data-offer-hold="${offer.id}">Hold</button>
      <button class="btn-ghost btn-sm" data-offer-negotiate="${offer.id}">Negotiate</button>
      <button class="btn-ghost btn-sm danger-action" data-offer-reject="${offer.id}">Reject</button>
    </div>
  </div>`;
}

function acceptOutgoingOffer(id) {
  const club = userClub();
  const offer = (state.outgoingOffers || []).find(o => o.id === id);
  const player = offer ? club.players.find(p => p.id === offer.playerId) : null;
  if (!offer || !player) return;
  if (club.players.length <= 11) { alert('You need at least 11 players.'); return; }
  const fee = sellPlayer(player, club);
  const finalFee = Math.max(fee, offer.fee);
  club.cash += finalFee - fee;
  state.outgoingOffers = state.outgoingOffers.filter(o => o.id !== id);
  state.market = guidedMarket(club);
  applyChairmanTrait(offer.managerBand === 'danger' ? { prudence: 4, delegation: -3, supporter: -1 } : { prudence: 3, delegation: 1 });
  addStory({
    title: `${club.short} sell ${player.name}`,
    body: `${offer.buyerName} completed the deal for £${fmt(finalFee)}. ${offer.coverText}`,
    type: 'transfer',
    category: 'Transfers',
    importance: offer.coverBand === 'danger' ? 2 : 1,
  });
  alert(`${player.name} sold to ${offer.buyerName} for £${fmt(finalFee)}.`);
  render();
}

function rejectOutgoingOffer(id) {
  const offer = (state.outgoingOffers || []).find(o => o.id === id);
  if (!offer) return;
  state.outgoingOffers = state.outgoingOffers.filter(o => o.id !== id);
  applyChairmanTrait({ patience: 1, prudence: -1 });
  addStory({
    title: `${userClub().short} reject ${offer.playerName} offer`,
    body: `${offer.buyerName}'s £${fmt(offer.fee)} offer was rejected by the chairman.`,
    type: 'transfer',
    category: 'Transfers',
    importance: 1,
  });
  render();
}

function holdOutgoingOffer(id) {
  const offer = (state.outgoingOffers || []).find(o => o.id === id);
  if (!offer) return;
  if ((offer.holdCount || 0) >= 2) {
    alert('The buying club will not wait any longer.');
    return;
  }
  offer.holdCount = (offer.holdCount || 0) + 1;
  offer.expiresEvent = Math.min((state.seasonCalendar?.length || 46) + 1, (offer.expiresEvent || state.currentEvent) + 1);
  offer.fee = Math.round(offer.fee * 0.97);
  applyChairmanTrait({ patience: 2, prudence: 1 });
  addStory({
    title: `${userClub().short} delay ${offer.playerName} sale`,
    body: `${offer.buyerName} will wait, but the offer has softened to £${fmt(offer.fee)}.`,
    type: 'transfer',
    category: 'Transfers',
    importance: 1,
  });
  render();
}

function negotiateOutgoingOffer(id) {
  const offer = (state.outgoingOffers || []).find(o => o.id === id);
  if (!offer) return;
  if ((offer.negotiationCount || 0) >= 1) {
    state.outgoingOffers = state.outgoingOffers.filter(o => o.id !== id);
    addStory({
      title: `${offer.buyerName} walk away`,
      body: `The second counter-offer for ${offer.playerName} was rejected and the bid was withdrawn.`,
      type: 'transfer',
      category: 'Transfers',
      importance: 1,
    });
    alert(`${offer.buyerName} walked away from the deal.`);
    render();
    return;
  }
  offer.negotiationCount = 1;
  offer.fee = Math.round(offer.fee * 1.08);
  offer.expiresEvent = Math.max(state.currentEvent + 1, Math.min(offer.expiresEvent || state.currentEvent + 1, state.currentEvent + 2));
  applyChairmanTrait({ ambition: 1, prudence: 2 });
  addStory({
    title: `${userClub().short} negotiate ${offer.playerName} fee`,
    body: `${offer.buyerName} improved the bid to £${fmt(offer.fee)}, but patience on the deal is shorter.`,
    type: 'transfer',
    category: 'Transfers',
    importance: 1,
  });
  render();
}

function scoutReplacementForOffer(id) {
  const club = userClub();
  const offer = (state.outgoingOffers || []).find(o => o.id === id);
  if (!offer) return;
  offer.replacementSearch = true;
  state.transferFilters = { ...(state.transferFilters || {}), position: offer.position, affordableOnly: true };
  const positionTargets = generateMarket(club, 16).filter(p => p.position === offer.position);
  state.market = [
    ...positionTargets,
    ...guidedMarket(club, 10),
  ].slice(0, 16);
  refreshDealRoomRecommendations(club, 'replacement-search');
  applyChairmanTrait({ prudence: 2, delegation: 3 });
  addStory({
    title: `${club.short} seek ${offer.position} cover`,
    body: `The DoF was asked to find a replacement before deciding on ${offer.playerName}'s offer.`,
    type: 'transfer',
    category: 'Transfers',
    importance: 1,
  });
  render();
}

function processOutgoingOffers() {
  const offers = state.outgoingOffers || [];
  const expired = offers.filter(offer => (offer.expiresEvent ?? 0) <= state.currentEvent);
  if (!expired.length) return;
  state.outgoingOffers = offers.filter(offer => !expired.includes(offer));
  expired.forEach(offer => {
    addStory({
      title: `${offer.buyerName} withdraw ${offer.playerName} bid`,
      body: `The £${fmt(offer.fee)} offer expired after the chairman waited too long.`,
      type: 'transfer',
      category: 'Transfers',
      importance: 1,
    });
  });
}

function renderDealRoom(club) {
  ensureDealRoomReview(club);
  const targets = dealRoomTargets(club);
  const review = state.transferRecommendations;
  const latest = state.worldActivity
    .slice(0, 3)
    .map(activity => ({
      ...activity,
      clubObj: state.league.clubsById[activity.club],
    }))
    .filter(activity => activity.clubObj);
  return `<div class="card">
    <div class="flex-between">
      <div>
        <h2 class="mb0">Deal Room</h2>
        <p class="muted small">Director of Football review pack with manager input before you approve spending.</p>
      </div>
      <span class="muted small">Review MW ${review?.week ?? state.currentWeek} · next ${review?.nextReviewWeek ?? state.currentWeek + 4}</span>
    </div>
    ${targets.length
      ? `<div class="grid mt">${targets.map(target => renderDealRoomTarget(target)).join('')}</div>`
      : `<p class="muted small mt">No live deal requires chairman approval. The DoF will only bring you players who match a squad gap, manager request, or clear upgrade brief. Next scheduled recruitment review: MW ${review?.nextReviewWeek ?? state.currentWeek + 4}.</p>`}
    ${latest.length ? `<h3 class="mt">Rival Movement</h3>
      <div class="headline-list mt">
        ${latest.map(activity => `<article>
          <span class="story-kicker">Transfers</span>
          <strong>${activity.clubObj.short} signed ${activity.player.name}</strong>
          <span class="muted small">£${fmt(activity.fee)} · ${activity.needLabel}</span>
        </article>`).join('')}
      </div>` : ''}
  </div>`;
}

function dealRoomTargets(club) {
  const ids = state.transferRecommendations?.ids || [];
  if (!ids.length) return [];
  const briefs = recruitmentBriefs(club);
  const used = new Set();
  const reviewedTargets = ids.map(id => state.market.find(player => player.id === id)).filter(Boolean);
  return briefs.map(brief => {
    const options = state.market
      .filter(player => reviewedTargets.includes(player) && !used.has(player.id) && player.position === brief.position)
      .map(player => {
        const fit = transferFit(player, club);
        const policyFit = transferPolicyScore(player, club, fit);
        const manager = managerTargetView(player, club, fit, brief);
        return { player, fit, policyFit, manager, brief, briefScore: dealBriefScore(player, fit, policyFit, manager, brief) };
      })
      .filter(target => target.briefScore >= 58 && target.manager.label !== 'Not a priority')
      .sort((a, b) => b.briefScore - a.briefScore || b.policyFit.score - a.policyFit.score);
    const best = options[0];
    if (best) used.add(best.player.id);
    return best || null;
  }).filter(Boolean).slice(0, 2);
}

function ensureDealRoomReview(club) {
  const review = state.transferRecommendations;
  const due = !review
    || review.season !== state.season
    || state.currentWeek >= (review.nextReviewWeek ?? 0);
  if (due) refreshDealRoomRecommendations(club, review ? 'scheduled-review' : 'first-review');
}

function refreshDealRoomRecommendations(club, reason = 'manual-review') {
  const candidates = dealRoomCandidateTargets(club);
  const ids = candidates.map(target => target.player.id);
  state.transferRecommendations = {
    season: state.season,
    week: state.currentWeek,
    reason,
    ids,
    nextReviewWeek: Math.min((state.fixtures?.length || 46) + 1, state.currentWeek + 4),
  };
  return state.transferRecommendations;
}

function removeTransferRecommendation(id) {
  if (!state.transferRecommendations?.ids) return;
  state.transferRecommendations = {
    ...state.transferRecommendations,
    ids: state.transferRecommendations.ids.filter(playerId => playerId !== id),
  };
}

function dealRoomCandidateTargets(club) {
  const briefs = recruitmentBriefs(club);
  const used = new Set();
  return briefs.map(brief => {
    const options = state.market
      .filter(player => !used.has(player.id) && player.position === brief.position)
      .map(player => {
        const fit = transferFit(player, club);
        const policyFit = transferPolicyScore(player, club, fit);
        const manager = managerTargetView(player, club, fit, brief);
        return { player, fit, policyFit, manager, brief, briefScore: dealBriefScore(player, fit, policyFit, manager, brief) };
      })
      .filter(target => target.briefScore >= 58 && target.manager.label !== 'Not a priority')
      .sort((a, b) => b.briefScore - a.briefScore || b.policyFit.score - a.policyFit.score);
    const best = options[0];
    if (best) used.add(best.player.id);
    return best || null;
  }).filter(Boolean).slice(0, 2);
}

function renderDealRoomTarget(target) {
  const { player, fit, policyFit, manager, brief } = target;
  const rec = policyRecommendation(policyFit.score);
  const affordableClass = fit.affordable ? 'success' : 'danger';
  const fitClass = bandClass(fit.clubFit?.band || 'warning');
  return `<div class="mini-panel">
    <span class="story-kicker">${brief.source}</span>
    <span class="muted small">${player.position} · ${player.age} yrs · ${player.overall} OVR</span>
    <strong>${player.name}</strong>
    <span class="small">${brief.label}</span>
    <span class="${fitClass} small">Club fit: ${fit.clubFit?.label || 'Useful cover'} - ${fit.clubFit?.reason || fit.recommendation}</span>
    <span class="${bandClass(rec.band)} small">DoF: ${rec.label}</span>
    <span class="${bandClass(manager.band)} small">Manager: ${manager.label}</span>
    <span class="muted small">${manager.text}</span>
    <span class="${affordableClass} small">Ask £${fmt(fit.askingPrice)} · wage £${fmt(player.wage)}/wk</span>
    <div class="flex mt action-row">
      <button class="btn btn-sm" data-deal-approve="${player.id}" ${fit.affordable ? '' : 'disabled'}>Approve bid</button>
      <button class="btn-ghost btn-sm" data-deal-cheaper="${player.id}">Cheaper option</button>
      <button class="btn-ghost btn-sm" data-deal-defer="${player.id}">Defer</button>
      <button class="btn-ghost btn-sm danger-action" data-deal-reject="${player.id}">Reject</button>
    </div>
  </div>`;
}

function recruitmentBriefs(club) {
  const avg = avgOverall(club);
  const needs = squadNeeds(club)
    .filter(need => need.priority !== 'covered')
    .map(need => ({
      position: need.position,
      priority: need.priority === 'urgent' ? 3 : 2,
      source: need.roleNeed === 'starter' ? 'Starter Need' : need.roleNeed === 'rotation' ? 'Rotation Need' : need.roleNeed === 'future' ? 'Succession Planning' : 'Squad Need',
      label: need.reason || need.label,
      minRole: need.roleNeed,
      minImprovement: need.roleNeed === 'starter' ? 2 : need.roleNeed === 'rotation' ? 0 : -2,
    }));

  const style = club.manager?.style || 'balanced';
  const directive = club.manager?.directive || 'trust';
  const stylePositions = {
    attacking: ['FWD', 'MID'],
    high_press: ['MID', 'FWD'],
    pragmatic: ['DEF', 'GK'],
    youth: ['MID', 'FWD', 'DEF'],
    balanced: ['MID', 'DEF'],
  }[directive === 'youth' ? 'youth' : style] || ['MID', 'DEF'];

  stylePositions.forEach(position => {
    const best = club.players.filter(p => p.position === position).sort((a, b) => b.overall - a.overall)[0];
    const alreadyCovered = needs.some(need => need.position === position);
    const wantsUpgrade = !best || best.overall < avg + (style === 'youth' || directive === 'youth' ? 0 : 2);
    if (!alreadyCovered && wantsUpgrade) {
      needs.push({
        position,
        priority: 2,
        source: 'Manager Request',
        label: `${club.manager?.name || 'The manager'} wants a ${position} profile for the current style`,
        minImprovement: style === 'youth' || directive === 'youth' ? 0 : 2,
        youth: style === 'youth' || directive === 'youth',
      });
    }
  });

  return needs.sort((a, b) => b.priority - a.priority).slice(0, 4);
}

function dealBriefScore(player, fit, policyFit, manager, brief) {
  let score = Math.round(policyFit.score * 0.55);
  score += brief.priority * 8;
  score += fit.affordable ? 10 : -18;
  score += { starter: 16, rotation: 12, prospect: 9, depth: 7, poor: -18 }[fit.role?.type] || 0;
  score += Math.max(-8, Math.min(12, fit.improvement * 1.2));
  if (brief.youth) score += player.age <= 23 ? 12 : player.age >= 29 ? -12 : 0;
  if (fit.improvement < brief.minImprovement) score -= 16;
  if (!roleMeetsBrief(fit.role?.type, brief.minRole)) score -= 12;
  if (manager.band === 'safe') score += 10;
  if (manager.band === 'danger') score -= 14;
  return clampScore(score);
}

function roleMeetsBrief(role, need) {
  const ranks = { poor: 0, depth: 1, prospect: 2, rotation: 3, starter: 4 };
  const required = { depth: 1, future: 2, rotation: 3, starter: 4 };
  return (ranks[role] || 0) >= (required[need] || 1);
}

function managerTargetView(player, club, fit = transferFit(player, club), brief = null) {
  const samePosition = club.players.filter(p => p.position === player.position);
  const best = samePosition.slice().sort((a, b) => b.overall - a.overall)[0];
  const academyBlock = player.age >= 29 && samePosition.some(p => p.age <= 22 && p.potential >= player.overall - 2);
  if (brief?.source === 'Manager Request' && fit.improvement >= brief.minImprovement) {
    return { band: 'safe', label: 'Manager requested profile', text: 'The manager asked staff to find this type of player.' };
  }
  if (academyBlock) {
    return { band: 'warning', label: 'Blocks academy pathway', text: 'The manager worries this signing slows a young player route.' };
  }
  if (fit.role?.type === 'starter') {
    return { band: 'safe', label: 'Improves first XI', text: 'The manager sees him improving the starting side.' };
  }
  if (fit.role?.type === 'rotation') {
    return { band: 'safe', label: 'Strengthens squad', text: 'The manager sees stronger matchday options and better cover.' };
  }
  if (fit.role?.type === 'prospect') {
    return { band: 'warning', label: 'Future option', text: 'The manager likes the upside, but he is not an immediate fix.' };
  }
  if (fit.role?.type === 'depth' || !best) {
    return { band: 'warning', label: 'Useful cover', text: 'The manager would use him as cover rather than a regular starter.' };
  }
  return { band: 'danger', label: 'Not a priority', text: 'The manager thinks funds may be better used elsewhere.' };
}

function approveDealRoomTarget(id) {
  const club = userClub();
  const target = state.market.find(p => p.id === id);
  if (!target) return;
  const fit = transferFit(target, club);
  if (!fit.affordable) { alert('You cannot afford the asking price.'); return; }
  const wageAfter = projectedWageRatio(club, target);
  completeTransferIn(target, fit.askingPrice, club, state.market);
  removeTransferRecommendation(id);
  applyChairmanTrait({
    ambition: fit.role?.type === 'starter' ? 4 : fit.role?.type === 'rotation' ? 2 : 1,
    prudence: wageAfter > 0.8 ? -3 : 1,
    youth: target.age <= 23 ? 3 : target.age >= 30 ? -2 : 0,
    delegation: 2,
  });
  addStory(transferCompletedStory({ player: target, fee: fit.askingPrice, club, wageRatio: projectedWageRatio(club) }));
  alert(`${target.name} joins ${club.name} for £${fmt(fit.askingPrice)}.`);
  render();
}

function askForCheaperOption(id) {
  const club = userClub();
  const target = state.market.find(p => p.id === id);
  if (!target) return;
  state.boardPlan.recruitmentPolicy = 'bargains';
  state.transferFilters = { ...(state.transferFilters || {}), position: target.position, affordableOnly: true };
  state.market = guidedMarket(club);
  refreshDealRoomRecommendations(club, 'cheaper-options');
  applyChairmanTrait({ prudence: 4, delegation: 2, ambition: -1 });
  addStory({
    title: `${club.short} ask DoF for cheaper options`,
    body: `${target.name} was parked while the Director of Football searches for better value under a bargain-market brief.`,
    type: 'transfer',
    category: 'Transfers',
    importance: 1,
  });
  render();
}

function deferDealRoomTarget(id) {
  const club = userClub();
  const target = state.market.find(p => p.id === id);
  if (!target) return;
  removeTransferRecommendation(id);
  applyChairmanTrait({ prudence: 2, patience: 2 });
  addStory({
    title: `${club.short} defer ${target.name} decision`,
    body: `The chairman delayed a decision on ${target.name} until the club has clearer financial or squad evidence.`,
    type: 'transfer',
    category: 'Transfers',
    importance: 1,
  });
  alert(`${target.name} remains on the list. The deal has been deferred.`);
  render();
}

function rejectDealRoomTarget(id) {
  const club = userClub();
  const target = state.market.find(p => p.id === id);
  if (!target) return;
  state.market = state.market.filter(p => p.id !== id);
  removeTransferRecommendation(id);
  applyChairmanTrait({ prudence: 2, delegation: -1 });
  addStory({
    title: `${club.short} reject ${target.name} proposal`,
    body: `${target.name} was rejected as not aligned with the current chairman strategy.`,
    type: 'transfer',
    category: 'Transfers',
    importance: 1,
  });
  render();
}

function openBid(id) {
  const club = userClub();
  const target = state.market.find(p => p.id === id);
  if (!target) return;
  const fit = transferFit(target, club);
  const wageRatio = projectedWageRatio(club, target);
  document.getElementById('transferModalContent').innerHTML = `
    <div class="flex-between">
      <h2 class="mb0">${target.name}</h2>
      <span class="pill ${target.position.toLowerCase()}">${target.position}</span>
    </div>
    <p class="muted small mt">${fit.recommendation} · ${target.age} years old · ${target.overall} OVR / ${target.potential} POT</p>
    <div class="grid mt">
      <div class="mini-panel"><span class="muted small">Asking price</span><strong>£${fmt(fit.askingPrice)}</strong></div>
      <div class="mini-panel"><span class="muted small">Balance after ask</span><strong class="${club.cash - fit.askingPrice >= 0 ? 'success' : 'danger'}">£${fmt(club.cash - fit.askingPrice)}</strong></div>
      <div class="mini-panel"><span class="muted small">Wage ratio after</span><strong class="${wageRatio < 0.8 ? 'success' : wageRatio < 1 ? 'warning' : 'danger'}">${(wageRatio * 100).toFixed(0)}%</strong></div>
    </div>
    <div class="transfer-detail-grid mt">
      ${attributeMini('ATT', target.attack)}
      ${attributeMini('DEF', target.defense)}
      ${attributeMini('PAS', target.passing)}
      ${attributeMini('FIN', target.finish)}
    </div>
    <div class="form-row mt">
      <label>Bid fee</label>
      <input type="number" id="bidFee" min="1" step="1000" value="${fit.askingPrice}" />
    </div>
    <p class="muted small">Rule: meet the asking price and have enough cash, and the deal is accepted. No hidden negotiation roll.</p>
    <div class="modal-actions">
      <button class="btn" id="confirmBid">Submit bid</button>
      <button class="btn-ghost" id="cancelBid">Cancel</button>
    </div>`;
  document.getElementById('transferModal').hidden = false;
  document.getElementById('cancelBid').addEventListener('click', closeTransferModal);
  document.getElementById('confirmBid').addEventListener('click', () => submitBid(target.id));
}

function submitBid(id) {
  const club = userClub();
  const target = state.market.find(p => p.id === id);
  if (!target) return;
  const fee = parseInt(document.getElementById('bidFee').value, 10);
  if (!fee || fee <= 0) { alert('Enter a valid fee.'); return; }
  const verdict = evaluateBid(target, fee, club);
  if (verdict.accepted) {
    const fit = transferFit(target, club);
    const wageAfter = projectedWageRatio(club, target);
    completeTransferIn(target, fee, club, state.market);
    applyChairmanTrait({
      ambition: fit.role?.type === 'starter' ? 4 : fit.role?.type === 'rotation' ? 2 : 1,
      prudence: wageAfter > 0.8 ? -3 : 1,
      youth: target.age <= 23 ? 3 : target.age >= 30 ? -2 : 0,
    });
    addStory(transferCompletedStory({ player: target, fee, club, wageRatio: projectedWageRatio(club) }));
    closeTransferModal();
    alert(`${verdict.reason}\n${target.name} joins ${club.name}!`);
  } else {
    alert(verdict.reason);
  }
  render();
}

function closeTransferModal() {
  document.getElementById('transferModal').hidden = true;
  document.getElementById('transferModalContent').innerHTML = '';
}

function guidedMarket(club, size = 10) {
  return generateMarket(club, size)
    .sort((a, b) => transferPolicyScore(b, club).score - transferPolicyScore(a, club).score);
}

function transferPolicyScore(player, club, fit = transferFit(player, club)) {
  return {
    score: recruitmentScore(player, club, fit, state.boardPlan?.recruitmentPolicy || 'balanced'),
    fit,
  };
}

function transferFilterOption(value, label, selected) {
  return `<option value="${value}" ${value === selected ? 'selected' : ''}>${label}</option>`;
}

function attributeMini(label, value) {
  return `<div class="mini-panel"><span class="muted small">${label}</span><strong>${value}</strong></div>`;
}

/* ---------- Finance ---------- */
function renderFinance() {
  const club = userClub();
  const health = financialHealth(club);
  const forecast = financeForecast(club);
  const rev = forecast.revenue;
  const cost = forecast.costs;
  const projected = forecast.profit;
  const tickets = ticketPricePlan(club);

  document.getElementById('finance').innerHTML = `
    <div class="card">
      <div class="flex-between">
        <h2 class="mb0">Finance Control</h2>
        <span class="${bandClass(forecast.risk)} small">${forecast.label}</span>
      </div>
      <p class="scoreline ${club.cash >= 0 ? 'success' : 'danger'}">£${fmt(club.cash)}</p>
      <div class="stat-row">
        <div class="stat"><strong>Transfer Budget</strong><span>£${fmt(forecast.transferBudget)}</span></div>
        <div class="stat"><strong>Weekly Wage Room</strong><span class="${forecast.remainingWeeklyWage >= 0 ? 'success' : 'danger'}">£${fmt(forecast.remainingWeeklyWage)}</span></div>
        <div class="stat"><strong>Cash Runway</strong><span>${formatRunway(forecast.runway)}</span></div>
      </div>
      <p class="center small ${bandClass(health.band)}">${health.label} · ${health.advice}</p>
    </div>
    <div class="grid">
      <div class="card mb0">
        <h3>Projected Season Revenue</h3>
        <table><tbody>
          <tr><td>Matchday</td><td class="num">£${fmt(rev.matchday)}</td></tr>
          <tr><td>TV / Prize</td><td class="num">£${fmt(rev.tv)}</td></tr>
          <tr><td>Commercial</td><td class="num">£${fmt(rev.commercial)}</td></tr>
          <tr><td><strong>Total</strong></td><td class="num"><strong>£${fmt(rev.total)}</strong></td></tr>
        </tbody></table>
      </div>
      <div class="card mb0">
        <h3>Projected Season Costs</h3>
        <table><tbody>
          <tr><td>Wages</td><td class="num">£${fmt(cost.wages)}</td></tr>
          <tr><td>Stadium upkeep</td><td class="num">£${fmt(cost.upkeep)}</td></tr>
          <tr><td>Infrastructure</td><td class="num">£${fmt(cost.infrastructure)}</td></tr>
          <tr><td><strong>Total</strong></td><td class="num"><strong>£${fmt(cost.total)}</strong></td></tr>
        </tbody></table>
      </div>
    </div>
    <div class="card">
      <h3>Projected Profit / Loss</h3>
      <p class="scoreline ${projected >= 0 ? 'success' : 'danger'}">${projected >= 0 ? '+' : '−'}£${fmt(Math.abs(projected))}</p>
      <div class="attr-bar"><span class="val small">Wage</span><div class="bar"><div class="bar-fill ${health.band === 'danger' ? '' : 'green'}" style="width:${Math.min(100, health.ratio * 100)}%;background:${health.band === 'danger' ? 'var(--danger)' : health.band === 'warning' ? 'var(--warning)' : 'var(--accent-2)'}"></div></div><span class="val">${(health.ratio * 100).toFixed(0)}%</span></div>
      <p class="muted small mt">Wage-to-revenue ratio. Budget target is £${fmt(forecast.weeklyWageBudget)}/wk; under 80% of revenue is comfortable.</p>
    </div>
    <div class="card">
      <h3>Ticket Price Demand</h3>
      <p class="muted small">Ticket changes now affect attendance. Higher prices can help, but only if local demand supports them.</p>
      <div class="ticket-grid mt">
        ${tickets.map(t => `<div class="ticket-card ${t.current ? 'active' : ''}">
          <span>£${t.price}</span>
          <strong>${fmt(t.attendance)}</strong>
          <small>£${fmt(t.seasonMatchday)} season matchday</small>
        </div>`).join('')}
      </div>
    </div>
    ${renderLastFinanceReport()}`;
}

function renderLastFinanceReport() {
  const report = state.financeReport;
  if (!report) return '';
  return `<div class="card">
    <div class="flex-between">
      <h3 class="mb0">Last Season Finance Report</h3>
      <span class="muted small">Season ${report.season}</span>
    </div>
    <p class="muted small mt">${report.summary}</p>
    <table><tbody>
      <tr><td>Revenue</td><td class="num">£${fmt(report.revenue)}</td></tr>
      <tr><td>Costs</td><td class="num">£${fmt(report.costs)}</td></tr>
      <tr><td>Profit / Loss</td><td class="num ${report.profit >= 0 ? 'success' : 'danger'}">${report.profit >= 0 ? '+' : '−'}£${fmt(Math.abs(report.profit))}</td></tr>
    </tbody></table>
  </div>`;
}

/* ---------- Stadium & Infrastructure ---------- */
function renderStadium() {
  const club = userClub();
  const expansion = stadiumExpansionPlan(club);
  const academyPlan = infrastructureUpgradePlan(club, 'academy');
  const trainingPlan = infrastructureUpgradePlan(club, 'training');
  const tickets = ticketPricePlan(club);

  document.getElementById('stadium').innerHTML = `
    <div class="card">
      <div class="flex-between">
        <h2 class="mb0">Stadium</h2>
        <span class="muted small">${fmt(club.stadiumCapacity)} capacity</span>
      </div>
      <div class="grid mt">
        <div class="mini-panel"><span class="muted small">Expansion cost</span><strong>£${fmt(expansion.cost)}</strong></div>
        <div class="mini-panel"><span class="muted small">Annual matchday gain</span><strong class="${expansion.annualGain > 0 ? 'success' : 'warning'}">£${fmt(expansion.annualGain)}</strong></div>
        <div class="mini-panel"><span class="muted small">ROI</span><strong>${expansion.label}</strong></div>
      </div>
      <button class="btn mt" id="expand" ${club.cash < expansion.cost ? 'disabled' : ''}>Expand +${fmt(expansion.seats)} seats</button>
      <div class="form-row">
        <label>Ticket price</label>
        <input type="number" id="ticket" value="${club.ticketPrice}" min="5" max="80" style="width:90px" />
        <button class="btn-ghost btn-sm" id="setTicket">Set</button>
      </div>
      <div class="ticket-grid mt">
        ${tickets.map(t => `<div class="ticket-card ${t.current ? 'active' : ''}">
          <span>£${t.price}</span>
          <strong>${fmt(t.attendance)}</strong>
          <small>£${fmt(t.seasonMatchday)} season matchday</small>
        </div>`).join('')}
      </div>
      <p class="muted small mt">Attendance now reacts to price, results, reputation, and capacity.</p>
    </div>
    <div class="grid">
      <div class="card mb0">
        <h3>Youth Academy · Level ${club.academy}</h3>
        <p class="muted small">${academyPlan.impact}</p>
        <p class="small">Cost: <strong>£${fmt(academyPlan.cost)}</strong> · Annual upkeep +£${fmt(academyPlan.annualCostIncrease)}</p>
        <button class="btn btn-sm" id="upAcademy" ${academyPlan.maxed || club.cash < academyPlan.cost ? 'disabled' : ''}>Upgrade to level ${academyPlan.nextLevel}</button>
      </div>
      <div class="card mb0">
        <h3>Training · Level ${club.training}</h3>
        <p class="muted small">${trainingPlan.impact}</p>
        <p class="small">Cost: <strong>£${fmt(trainingPlan.cost)}</strong> · Annual upkeep +£${fmt(trainingPlan.annualCostIncrease)}</p>
        <button class="btn btn-sm" id="upTraining" ${trainingPlan.maxed || club.cash < trainingPlan.cost ? 'disabled' : ''}>Upgrade to level ${trainingPlan.nextLevel}</button>
      </div>
    </div>`;

  document.getElementById('expand').addEventListener('click', () => {
    club.cash -= expansion.cost; club.stadiumCapacity += expansion.seats;
    applyChairmanTrait({ supporter: 2, prudence: expansion.annualGain > 0 ? 2 : -2, patience: 1 });
    addStory(infrastructureStory({
      title: 'Stadium expansion approved',
      body: `Capacity increased by ${fmt(expansion.seats)} seats. Forecast annual matchday gain: £${fmt(expansion.annualGain)}.`,
      type: 'finance',
    }));
    render();
  });
  document.getElementById('setTicket').addEventListener('click', () => {
    const v = parseInt(document.getElementById('ticket').value, 10);
    if (v >= 5 && v <= 80) {
      const old = club.ticketPrice;
      club.ticketPrice = v;
      if (v > old) applyChairmanTrait({ prudence: 2, supporter: -2 });
      if (v < old) applyChairmanTrait({ supporter: 3, prudence: -1 });
      render();
    }
  });
  document.getElementById('upAcademy').addEventListener('click', () => {
    club.cash -= academyPlan.cost; club.academy++;
    applyChairmanTrait({ youth: 7, patience: 3, prudence: 1 });
    addStory(infrastructureStory({
      title: 'Academy pathway upgraded',
      body: `Academy is now level ${club.academy}. ${academyPlan.impact}`,
      type: 'development',
    }));
    render();
  });
  document.getElementById('upTraining').addEventListener('click', () => {
    club.cash -= trainingPlan.cost; club.training++;
    applyChairmanTrait({ youth: 3, ambition: 2, patience: 1 });
    addStory(infrastructureStory({
      title: 'Training ground upgraded',
      body: `Training is now level ${club.training}. ${trainingPlan.impact}`,
      type: 'development',
    }));
    render();
  });
}

/* ------------------------------------------------------------------ */
/* Game loop                                                          */
/* ------------------------------------------------------------------ */
function onPlayNext() {
  const event = nextCalendarEvent();
  if (!event) return;
  if (event.type === 'cup') playCupEvent(event);
  else playLeagueEvent(event);
  syncSeasonCalendar();
  state.currentEvent = nextCalendarIndex();
  processOutgoingOffers();
  render();
}

function playLeagueEvent(event) {
  const week = state.fixtures.find(w => w.week === event.week);
  if (!week) return;
  const beforePos = divisionStandings(state.league.clubs, userDivision()).indexOf(userClub()) + 1;
  const results = playMatchweek(week, state.league.clubsById);
  state.lastResults = results;
  state.currentWeek = Math.max(state.currentWeek, event.week);
  event.played = true;

  // Show the user's own match in the modal.
  const uc = userClub();
  const mine = results.find(r => r.home === uc || r.away === uc);
  if (mine) {
    const afterPos = divisionStandings(state.league.clubs, uc.division).indexOf(uc) + 1;
    rememberResult(event, mine, { competition: 'League', roundName: event.label });
    addMatchInbox(mine, beforePos, afterPos);
    showMatchModal(mine, { competition: 'League', roundName: event.label, date: event.date });
  } else {
    rememberRoundSummary(event, { round: { short: event.label }, results });
  }

  updateFormAndMorale(results);
  processWeeklyInjuries(results).forEach(event => addStory(injuryStory(event, uc)));
  processWorldActivity(event);
  processPressureStory(event);
  generateDecisionReports('league-event');
}

function playCupEvent(event) {
  if (event.roundIndex !== state.cup?.roundIndex) return;
  const uc = userClub();
  const played = playCupRound(state.cup, state.league.clubsById);
  if (!played.round) return;

  state.lastCupResults = played.results;
  event.played = true;
  updateFormAndMorale(played.results);
  processWeeklyInjuries(played.results).forEach(event => addStory(injuryStory(event, uc)));

  const mine = played.results.find(r => r.home === uc || r.away === uc);
  if (mine) {
    const won = mine.winner === uc;
    const prize = won ? played.round.prize : 0;
    if (prize) uc.cash += prize;
    state.cup.userBestRound = played.round.name;
    rememberResult(event, mine, { competition: state.cup.name, roundName: played.round.name, cup: true });
    addStory(cupStory({ result: mine, round: played.round, userClub: uc, prize }));
    showMatchModal(mine, {
      competition: state.cup.name,
      roundName: played.round.name,
      date: event.date,
      cupResult: mine,
      prize,
    });
    if (played.championId === uc.id) {
      state.clubHistory = state.clubHistory || createClubHistory(uc);
      state.clubHistory.honours = [
        ...(state.clubHistory.honours || []),
        { season: state.season, label: `Won ${state.cup.name}` },
      ];
    }
  } else rememberRoundSummary(event, played);

  addStory(cupRoundStory({
    round: played.round,
    results: played.results,
    clubsById: state.league.clubsById,
    championId: played.championId,
  }));
  const draw = cupDrawStory({ cup: state.cup, clubsById: state.league.clubsById, userClub: uc });
  if (draw) addStory(draw);
  generateDecisionReports('cup-event');
}

function onPlayCupRound() {
  const event = nextCalendarEvent();
  if (event?.type === 'cup') {
    playCupEvent(event);
    syncSeasonCalendar();
    state.currentEvent = nextCalendarIndex();
    processOutgoingOffers();
    render();
  }
}

function processPressureStory(event) {
  if (!event || event.type !== 'league') return;
  const club = userClub();
  const table = divisionStandings(state.league.clubs, club.division);
  const pos = table.indexOf(club) + 1;
  const track = trackStatus(state.objective, pos, club.played);
  const pressure = currentPressure(club, pos, track);
  if (pressure.band === 'danger' || event.week % 4 === 0) {
    addStory(pressureStory(club, pressure));
  }
}

function showMatchModal(r, context = {}) {
  const uc = userClub();
  const events = [];
  r.timeline.home.forEach(m => events.push({ min: m, team: r.home.short, side: 'home' }));
  r.timeline.away.forEach(m => events.push({ min: m, team: r.away.short, side: 'away' }));
  events.sort((a, b) => a.min - b.min);
  const evHtml = events.length
    ? events.map(e => `<li><span class="min">${e.min}'</span> ⚽ ${e.team}</li>`).join('')
    : '<li class="muted">No goals.</li>';

  const isCup = !!context.cupResult || !!r.winner;
  const won = isCup
    ? r.winner === uc
    : (r.home === uc && r.result === 'H') || (r.away === uc && r.result === 'A');
  const drew = r.result === 'D';
  const verdict = isCup ? (won ? 'Win' : 'Loss') : drew ? 'Draw' : won ? 'Win' : 'Loss';
  const vClass = !isCup && drew ? 'warning' : won ? 'success' : 'danger';
  const preview = matchPreview({ home: r.home.id, away: r.away.id });
  const userProb = pct(preview.userWin);
  const drawProb = pct(preview.probs.draw);
  const oppProb = pct(preview.oppWin);
  const tieBreakHtml = r.tiebreak ? `
      <p>${r.tiebreak.method} — <strong>${r.tiebreak.penaltyScore}</strong>. Shootout weighting: ${r.home.short} ${pct(r.tiebreak.homeChance)}%, ${r.away.short} ${pct(1 - r.tiebreak.homeChance)}%.</p>` : '';
  const prizeHtml = context.prize ? `<p class="success">Prize money earned: <strong>£${fmt(context.prize)}</strong>.</p>` : '';

  document.getElementById('matchModalContent').innerHTML = `
    <p class="center muted small">${context.date ? `${context.date} · ` : ''}${context.competition || 'League'}${context.roundName ? ` · ${context.roundName}` : ''}</p>
    <h2 class="center">${r.home.name} vs ${r.away.name}</h2>
    <p class="scoreline">${r.homeGoals} – ${r.awayGoals}</p>
    <p class="center ${vClass}"><strong>${verdict}</strong></p>
    <ul class="match-events">${evHtml}</ul>
    <div class="explanation">
      <p><strong>Why this result (transparent sim):</strong></p>
      <p>Expected goals — ${r.home.short}: <strong>${r.xg.home}</strong>, ${r.away.short}: <strong>${r.xg.away}</strong></p>
      <p>Ratings — ${r.home.short} ATT ${r.ratings.homeAtt} / DEF ${r.ratings.homeDef} (incl. +${HOME_BONUS} home)</p>
      <p>Ratings — ${r.away.short} ATT ${r.ratings.awayAtt} / DEF ${r.ratings.awayDef}</p>
      <p>Pre-match probabilities — you ${userProb}%, draw ${drawProb}%, ${preview.opponent.short} ${oppProb}%.</p>
      ${tieBreakHtml}
      ${prizeHtml}
      <p class="muted small">Goals drawn from a fair Poisson model — favourites win at the correct rate, with no rigged streaks.</p>
    </div>`;
  document.getElementById('matchModal').hidden = false;
}

function addMatchInbox(r, beforePos, afterPos) {
  const uc = userClub();
  addStory(matchStory({ result: r, userClub: uc, beforePos, afterPos }));
  const table = divisionStandings(state.league.clubs, uc.division);
  if (state.currentWeek % 3 === 0 || afterPos <= 2 || afterPos >= table.length - 1) {
    addStory(divisionStory(table, uc));
  }
}

// Light form/morale drift based on results (bounded, no wild swings).
function updateFormAndMorale(results) {
  for (const r of results) {
    const homeWin = r.result === 'H', awayWin = r.result === 'A';
    for (const p of r.home.players) driftPlayer(p, homeWin ? +1 : r.result === 'D' ? 0 : -1);
    for (const p of r.away.players) driftPlayer(p, awayWin ? +1 : r.result === 'D' ? 0 : -1);
    driftManagerConfidence(r.home, homeWin ? +2 : r.result === 'D' ? 0 : -2);
    driftManagerConfidence(r.away, awayWin ? +2 : r.result === 'D' ? 0 : -2);
  }
}
function driftPlayer(p, dir) {
  const step = 0.03 * dir + (Math.random() - 0.5) * 0.02;
  p.form = clampMult(p.form + step);
  p.morale = clampMult(p.morale + step * 0.6);
}
function clampMult(v) { return Math.max(0.85, Math.min(1.15, +v.toFixed(3))); }
function driftManagerConfidence(club, delta) {
  if (!club.manager) return;
  club.manager.confidence = Math.max(20, Math.min(95, (club.manager.confidence ?? 60) + delta));
}

function chairmanExitScenario({ club, review, finalPos, divisionName }) {
  if ((state.fanTrust ?? 60) < 25) {
    return {
      title: 'Fan Revolt',
      body: `Supporter trust has collapsed after finishing ${finalPos}${ord(finalPos)} in ${divisionName}. Protests are calling for you to stand down as chairman of ${club.name}.`,
    };
  }
  if (club.cash < 0 || review.confidence < 8) {
    return {
      title: 'Investor Takeover Pressure',
      body: `A foreign investor group is circling ${club.name}, arguing that poor results and weak finances require new ownership leadership.`,
    };
  }
  if (state.badlyStreak >= 2) {
    return {
      title: 'Board Forces Resignation Vote',
      body: `The board believes a prolonged period of poor performance has damaged the club. They ask you to resign before a formal vote of no confidence.`,
    };
  }
  return {
    title: 'Chairman Position Untenable',
    body: `The board and supporter groups believe the club needs a reset after repeated underperformance.`,
  };
}

function onNewSeason() {
  if (state.cup?.status === 'active') {
    alert('Finish the active Chairman Cup before starting the next season.');
    state.currentTab = 'cup';
    render();
    return;
  }

  const clubs = state.league.clubs;
  const uc = userClub();

  // 1. Auto-simulate the divisions the user did NOT manage this season, so the
  //    whole pyramid has a complete set of results before promotion/relegation.
  for (let d = TOP_DIVISION; d <= BOTTOM_DIVISION; d++) {
    if (d !== uc.division) autoSimulateDivision(clubs, d, state.league.clubsById);
  }

  // 2. Record the user's finishing position in their own division.
  const myTable = divisionStandings(clubs, uc.division);
  const finalPos = myTable.indexOf(uc) + 1;
  const oldDivName = DIVISIONS[uc.division].name;

  // 2a. Grade the board objective for the season just played, then update
  //     board confidence and job status (transparent two-strike forced-out rule).
  const grading = gradeLeagueObjective(state.objective, finalPos);
  const review = applyConfidence(state.confidence, grading.delta, grading.grade, state.badlyStreak);
  state.confidence = review.confidence;
  state.fanTrust = clampScore((state.fanTrust ?? 60) + (grading.grade === 'exceeded' ? 8 : grading.grade === 'met' ? 4 : grading.grade === 'badly' ? -14 : -6));
  state.badlyStreak = review.badlyStreak;
  state.jobStatus = review.status;
  state.lastReview = { grade: grading.grade, message: grading.message, jobMessage: review.jobMessage };

  // 3. Apply end-of-season finances to the user's club (TV money reflects the
  //    division they were IN this season, before any move).
  const pnl = applySeasonFinances(uc);

  // 3a. Exceeding the objective earns a small board-backed cash bonus; badly
  //     missing it triggers a modest budget squeeze. Never bankrupting.
  let bonus = 0;
  if (grading.grade === 'exceeded') { bonus = Math.round(pnl.revenue.total * 0.10); uc.cash += bonus; }
  else if (grading.grade === 'badly') { bonus = -Math.round(pnl.revenue.total * 0.05); uc.cash += bonus; }
  state.financeReport = {
    season: state.season,
    revenue: pnl.revenue.total,
    costs: pnl.costs.total,
    profit: pnl.profit + bonus,
    balance: uc.cash,
    bonus,
    summary: `Revenue £${fmt(pnl.revenue.total)}, costs £${fmt(pnl.costs.total)}, net ${pnl.profit + bonus >= 0 ? '+' : '−'}£${fmt(Math.abs(pnl.profit + bonus))}. Balance now £${fmt(uc.cash)}.`,
  };

  // 3b. If ownership pressure becomes untenable, the chairman is challenged.
  if (review.sacked) {
    const exit = chairmanExitScenario({ club: uc, review, finalPos, divisionName: oldDivName });
    const acceptExit = confirm(
      `Season ${state.season} review\n\n` +
      `${grading.message}\n\n` +
      `${exit.title}\n${exit.body}\n\n` +
      `You finished ${finalPos}${ord(finalPos)} in ${oldDivName}. Board confidence is ${review.confidence}/100 and supporter trust is ${state.fanTrust}/100.\n\n` +
      `Accept the exit and start a new game? Choose Cancel to refuse and continue under emergency review.`
    );
    if (acceptExit) {
      localStorage.removeItem(SAVE_KEY);
      showClubSelection();
      return;
    }
    state.confidence = Math.max(10, Math.min(25, review.confidence + 5));
    state.fanTrust = Math.max(10, Math.min(35, state.fanTrust + 3));
    state.badlyStreak = 1;
    state.jobStatus = 'at_risk';
    review.confidence = state.confidence;
    review.status = 'at_risk';
    review.jobMessage = 'You refused to resign. The board allows one emergency review period, but patience is almost gone.';
    review.sacked = false;
    addStory({
      title: `${uc.short} chairman refuses to stand down`,
      body: `${exit.body} The chairman rejects the pressure and continues under emergency review.`,
      type: 'result-bad',
      category: 'Boardroom',
      importance: 3,
    });
  }

  // 4. Promotion & relegation across the whole pyramid.
  const moves = applyPromotionRelegation(clubs, uc.id);
  const seasonMemory = buildSeasonMemory({
    season: state.season,
    club: uc,
    divisionName: oldDivName,
    finalPos,
    divisionSize: myTable.length,
    objective: state.objective,
    grading,
    move: moves.userMove,
    pnl: state.financeReport,
  });
  state.clubHistory = applySeasonMemory(state.clubHistory || createClubHistory(uc), seasonMemory, state.lastResults);

  // 5. Reset records and apply transparent player development.
  let userDevelopment = [];
  let academyIntake = [];
  clubs.forEach(c => {
    c.resetSeasonRecord();
    const changes = developSquad(c, state.season);
    tickContracts(c);
    c.players.forEach(p => { p.appearances = 0; p.goals = 0; });
    if (c === uc) {
      userDevelopment = changes;
      academyIntake = generateAcademyIntake(c, state.season);
      c.players.push(...academyIntake);
    }
  });
  state.developmentReport = {
    season: state.season,
    changes: userDevelopment.slice(0, 10),
    intake: academyIntake.map(serialisePlayer),
    summary: summariseDevelopment(userDevelopment, academyIntake),
  };

  // 5a. Record how the user arrived in next season's division (drives the
  //     board's objective — promoted clubs get a forgiving "survive" target).
  state.lastMove = moves.userMove?.type ?? null;

  // 6. New fixtures for the user's (possibly new) division; refresh market.
  state.fixtures = generateFixtures(clubsInDivision(clubs, uc.division));
  state.currentWeek = 0;
  state.season++;
  state.market = guidedMarket(uc);
  state.transferRecommendations = null;
  state.outgoingOffers = [];
  state.managerMarket = availableManagersForClub(uc, state.season);
  state.directorMarket = directorMarketForClub(uc, state.season);
  state.lastResults = [];
  state.cup = createCup(clubs, state.season);
  state.lastCupResults = [];
  state.seasonCalendar = buildSeasonCalendar(state.fixtures, state.cup, state.season);
  state.currentEvent = 0;
  state.resultMemory = [];
  state.worldActivity = [];
  state.decisions = [];

  // 6a. The board sets a fresh objective for the new season & division.
  state.objective = setLeagueObjective(uc, state.lastMove, clubsInDivision(clubs, uc.division).length);
  state.financeObjective = setFinanceObjective();
  state.inbox = [];
  seasonReviewStories({
    memory: seasonMemory,
    financeReport: state.financeReport,
    developmentReport: state.developmentReport,
  }).forEach(addStory);
  addStory(objectiveStory(state.objective));
  addStory({ title: 'Finance forecast refreshed', body: state.financeObjective.detail, type: 'finance', category: 'Finance', importance: 1 });
  addStory(transferMarketStory(state.market, uc));
  refreshDealRoomRecommendations(uc, 'new-season');
  generateDecisionReports('new-season');

  // 7. Build a clear end-of-season summary.
  let outcome;
  if (moves.userMove?.type === 'promoted') {
    outcome = `🎉 PROMOTED to ${DIVISIONS[uc.division].name}!`;
  } else if (moves.userMove?.type === 'relegated') {
    outcome = `⬇️ Relegated to ${DIVISIONS[uc.division].name}.`;
  } else {
    outcome = `Staying in ${DIVISIONS[uc.division].name}.`;
  }

  const otherPromos = moves.promoted
    .filter(m => m.id !== uc.id)
    .map(m => `${state.league.clubsById[m.id].name} ↑`)
    .slice(0, 6);

  const bonusLine = bonus > 0
    ? `Board bonus: +£${fmt(bonus)}\n`
    : bonus < 0 ? `Budget squeeze: −£${fmt(Math.abs(bonus))}\n` : '';

  alert(
    `Season ${state.season - 1} complete!\n` +
    `${oldDivName}: you finished ${finalPos}${ord(finalPos)}.\n\n` +
    `${outcome}\n\n` +
    `📋 Board review: ${grading.message}\n` +
    `${review.jobMessage} (confidence ${review.confidence}/100)\n\n` +
    `P&L: ${pnl.profit >= 0 ? '+' : '−'}£${fmt(Math.abs(pnl.profit))}\n` +
    bonusLine +
    `New balance: £${fmt(uc.cash)}\n\n` +
    `Development: ${state.developmentReport.summary.text}\n\n` +
    `New objective: ${state.objective.label} (${state.objective.divisionName}).\n` +
    (otherPromos.length ? `\nAlso promoted: ${otherPromos.join(', ')}` : '')
  );

  state.currentTab = 'dashboard';
  render();
}

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */
function fmt(n) { return Math.round(n).toLocaleString('en-GB'); }
function pct(n) { return Math.round(n * 100); }
function signed(n) { return n > 0 ? `+${n}` : `${n}`; }
function addDays(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}
function formatGameDate(date) {
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
function calendarDateForCupRound(roundIndex) {
  const event = state.seasonCalendar.find(e => e.type === 'cup' && e.roundIndex === roundIndex);
  return event?.date || 'Scheduled';
}
function formatRunway(runway) {
  if (!Number.isFinite(runway)) return 'Safe';
  return `${runway.toFixed(1)} yrs`;
}
function formatHighestFinish(record) {
  if (!record) return '—';
  return `${record.finalPos}${ord(record.finalPos)} · ${record.divisionName}`;
}
function formatResultRecord(record) {
  if (!record) return '—';
  return `${record.score} vs ${record.opponent}`;
}
function ord(n) { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return s[(v - 20) % 10] || s[v] || s[0]; }
function avgOverall(club) {
  if (!club.players.length) return 0;
  return Math.round(club.players.reduce((s, p) => s + p.overall, 0) / club.players.length);
}
function posOrder(pos) { return { GK: 0, DEF: 1, MID: 2, FWD: 3 }[pos] ?? 4; }
function bandClass(band) {
  return band === 'safe' || band === 'ok' ? 'success' : band === 'warning' ? 'warning' : 'danger';
}
function toneClass(tone) {
  return tone === 'green' ? 'success' : tone === 'gold' ? 'gold' : tone === 'red' ? 'danger' : '';
}
function addStory(story) {
  if (!story) return;
  const meta = `S${state.season} · MW ${Math.min(state.currentWeek + 1, state.fixtures.length || 1)}`;
  state.inbox.unshift({
    title: story.title,
    body: story.body,
    type: story.type || 'system',
    category: story.category || 'Club',
    importance: story.importance || 1,
    meta,
    at: Date.now(),
  });
  state.inbox = state.inbox.slice(0, 30);
}
function addInbox(title, body, type = 'system') {
  addStory({ title, body, type, category: storyCategory(type), importance: 1 });
}
function normaliseStory(item) {
  return {
    title: item.title,
    body: item.body,
    type: item.type || 'system',
    category: item.category || storyCategory(item.type),
    importance: item.importance || 1,
    meta: item.meta || '',
  };
}
function storyCategory(type) {
  return {
    board: 'Board',
    finance: 'Finance',
    transfer: 'Transfers',
    development: 'Development',
    history: 'Club',
    league: 'League',
    cup: 'Cup',
    contract: 'Contracts',
    'cup-good': 'Cup',
    'cup-bad': 'Cup',
    injury: 'Squad',
    fitness: 'Squad',
    'result-good': 'Match',
    'result-neutral': 'Match',
    'result-bad': 'Match',
  }[type] || 'Club';
}

/* ---------- Objective UI helpers ---------- */
function trackWord(s) {
  return { ontrack: 'On track', close: 'Borderline', offtrack: 'Off track',
           pending: 'Not started', unknown: '—' }[s] || '—';
}
function trackDot(s) {
  return { ontrack: '●', close: '●', offtrack: '●', pending: '○', unknown: '○' }[s] || '○';
}
function trackClass(s) {
  return s === 'ontrack' ? 'success' : s === 'close' ? 'warning' : s === 'offtrack' ? 'danger' : 'muted';
}
// A prominent banner shown only when the manager's job is under pressure.
function jobBanner() {
  if (state.jobStatus === 'at_risk') {
    return `<p class="job-banner danger mt">⚠ Job at risk — the board wants a big improvement this season.</p>`;
  }
  if (state.jobStatus === 'watch') {
    return `<p class="job-banner warning mt">The board is watching closely — deliver on this objective.</p>`;
  }
  return '';
}

init();
