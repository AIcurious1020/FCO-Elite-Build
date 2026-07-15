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
  boardroomPolicyStory, directorAppointmentStory, managerMeetingStory, pressureStory,
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
  badlyStreak: 0,         // consecutive "badly missed" seasons (two-strike sack rule)
  jobStatus: 'secure',    // secure | watch | at_risk | sacked
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
  ensureClubStaff(lg.clubs, state.season);
  state.market = guidedMarket(uc);
  state.lastResults = [];
  // Board objectives for the opening season.
  state.confidence = START_CONFIDENCE;
  state.badlyStreak = 0;
  state.jobStatus = 'secure';
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
  state.objective = setLeagueObjective(uc, null, clubsInDivision(lg.clubs, uc.division).length);
  state.financeObjective = setFinanceObjective();
  state.inbox = [];
  addStory(objectiveStory(state.objective));
  addStory({ title: 'Finance guardrail agreed', body: state.financeObjective.detail, type: 'finance', category: 'Finance', importance: 1 });
  addStory(transferMarketStory(state.market, uc));
  generateDecisionReports('season-start');
}

function showClubSelection() {
  const previewLeague = createLeague(null);
  const candidates = clubsInDivision(previewLeague.clubs, BOTTOM_DIVISION);
  state.league = null;
  state.currentTab = 'dashboard';
  setNavEnabled(false);
  document.querySelectorAll('.tab-content').forEach(s => { s.hidden = s.id !== 'dashboard'; });
  document.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === 'dashboard'));
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
    state.decisions = data.decisions ?? [];
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
  document.querySelectorAll('[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      switchTab(btn.dataset.tab);
    });
  });
}

function switchTab(tab) {
  if (!state.league) return;
  state.currentTab = tab;
  document.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  render();
}

function setNavEnabled(enabled) {
  document.querySelectorAll('[data-tab]').forEach(btn => {
    btn.disabled = !enabled && btn.dataset.tab !== 'dashboard';
  });
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
  const divInfo = DIVISIONS[club.division];
  const totalEvents = state.seasonCalendar.length;
  const nextEvent = nextCalendarEvent();
  const health = financialHealth(club);

  // Board objective + live on-track status.
  const obj = state.objective;
  const track = trackStatus(obj, pos, club.played);
  const conf = confidenceLabel(state.confidence);
  const pressure = currentPressure(club, pos, track);

  const nextFixture = nextEvent ? fixtureForCalendarEvent(nextEvent) : null;
  const preview = nextFixture ? matchPreview(nextFixture, nextEvent) : null;

  document.getElementById('dashboard').innerHTML = `
    <div class="card">
      <div class="flex-between">
        <div>
          <h2 class="mb0">${club.name}</h2>
          <p class="muted small">${divInfo.name} · Season ${state.season} · Event ${Math.min(state.currentEvent + 1, totalEvents)} of ${totalEvents}</p>
        </div>
        <div class="center">
          <div class="stat span" style="min-width:70px"><strong>Position</strong><span class="gold">${pos}${ord(pos)}</span></div>
        </div>
      </div>
      <div class="stat-row mt">
        <div class="stat"><strong>Played</strong><span>${club.played}</span></div>
        <div class="stat"><strong>Won</strong><span class="success">${club.won}</span></div>
        <div class="stat"><strong>Drawn</strong><span>${club.drawn}</span></div>
        <div class="stat"><strong>Lost</strong><span class="danger">${club.lost}</span></div>
        <div class="stat"><strong>Points</strong><span>${club.points}</span></div>
      </div>
    </div>

    <div class="card">
      <div class="flex-between">
        <h2 class="mb0">Board Objective</h2>
        <span class="pill obj-${track.state}">${trackDot(track.state)} ${trackWord(track.state)}</span>
      </div>
      <p class="mt"><strong>${obj ? obj.label : '—'}</strong>
        ${obj ? `<span class="muted small">(${obj.divisionName})</span>` : ''}</p>
      ${obj ? `<p class="muted small">${obj.reason}</p>` : ''}
      <p class="small ${trackClass(track.state)}">${track.text}</p>
      <div class="flex-between mt">
        <span class="small muted">Board confidence</span>
        <span class="small ${bandClass(conf.band)}">${conf.label} · ${state.confidence}/100</span>
      </div>
      <div class="bar"><div class="bar-fill ${bandClass(conf.band)}" style="width:${state.confidence}%"></div></div>
      ${jobBanner()}
    </div>

    <div class="card">
      <div class="flex-between">
        <h2 class="mb0">Boardroom</h2>
        <button class="btn-ghost btn-sm" id="openBoardroom">Open controls</button>
      </div>
      <div class="grid mt">
        <div class="mini-panel"><span class="muted small">Director of Football</span><strong>${club.director?.name || 'Vacant'}</strong></div>
        <div class="mini-panel"><span class="muted small">Recruitment</span><strong>${RECRUITMENT_POLICIES[state.boardPlan.recruitmentPolicy]?.label || 'Balanced'}</strong></div>
        <div class="mini-panel"><span class="muted small">Pressure</span><strong class="${bandClass(pressure.band)}">${pressure.label}</strong></div>
      </div>
      <p class="muted small mt">${pressure.text}</p>
    </div>

    <div class="card">
      <div class="flex-between">
        <h2 class="mb0">News Centre</h2>
        <button class="btn-ghost btn-sm" id="openNews">Open full feed</button>
      </div>
      ${renderInbox()}
    </div>

    ${renderDecisionInbox(true)}

    <div class="card">
      <div class="flex-between">
        <h2 class="mb0">Next Match Preview</h2>
        ${preview ? `<span class="pill ${preview.userEdge >= 0 ? 'obj-ontrack' : 'obj-close'}">${preview.userEdge >= 0 ? 'Favourable' : 'Tough'}</span>` : ''}
      </div>
      ${preview ? renderMatchPreview(preview) : renderCalendarEventPreview(nextEvent)}
      <div class="flex mt action-row">
        <button class="btn btn-lg" id="playNext" ${!nextEvent ? 'disabled' : ''}>▶ Play Next Fixture</button>
      </div>
      ${!nextEvent ? `<button class="btn btn-success btn-lg mt" id="newSeason">Start Season ${state.season + 1}</button>` : ''}
    </div>

    <div class="card">
      <div class="flex-between">
        <h2 class="mb0">Season Calendar</h2>
        <span class="pill obj-${cupStatus(state.cup, club.id).band}">${cupStatus(state.cup, club.id).label}</span>
      </div>
      ${renderCalendarMini()}
      <div class="flex mt action-row">
        <button class="btn-ghost btn-sm" id="openFixtures">Open calendar</button>
        <button class="btn-ghost btn-sm" id="openCup">Open cup</button>
      </div>
    </div>

    <div class="grid">
      <div class="card mb0">
        <h3>Squad</h3>
        <p><strong>${club.players.length}</strong> players · Avg overall <strong>${avgOverall(club)}</strong></p>
        <p class="muted small">Best XI rating: ${Math.round((teamRatings(club).attack + teamRatings(club).defense) / 2)}</p>
      </div>
      <div class="card mb0">
        <h3>Head Coach</h3>
        <p><strong>${club.manager?.name || 'Interim staff'}</strong></p>
        <p class="muted small">${MANAGER_STYLES[club.manager?.style]?.label || 'Balanced'} · Fit ${managerFit(club.manager, club)}/100</p>
      </div>
      <div class="card mb0">
        <h3>Finance</h3>
        <p>Balance: <strong class="success">£${fmt(club.cash)}</strong></p>
        <p class="small ${bandClass(health.band)}">${health.label} — wages ${(health.ratio * 100).toFixed(0)}% of revenue</p>
      </div>
      <div class="card mb0">
        <h3>Reputation</h3>
        <p>Level <strong>${club.reputation}</strong> / 10</p>
        <div class="bar"><div class="bar-fill gold" style="width:${club.reputation * 10}%"></div></div>
      </div>
    </div>

    ${renderDevelopmentSummary()}

    ${renderClubsToWatch()}

    ${renderSeasonTimeline()}

    ${renderLastResults()}
  `;

  const playBtn = document.getElementById('playNext');
  if (playBtn) playBtn.addEventListener('click', onPlayNext);
  const openFixtures = document.getElementById('openFixtures');
  if (openFixtures) openFixtures.addEventListener('click', () => switchTab('fixtures'));
  const openCup = document.getElementById('openCup');
  if (openCup) openCup.addEventListener('click', () => switchTab('cup'));
  const ns = document.getElementById('newSeason');
  if (ns) {
    ns.disabled = state.cup?.status === 'active';
    ns.addEventListener('click', onNewSeason);
  }
  const openNews = document.getElementById('openNews');
  if (openNews) openNews.addEventListener('click', () => switchTab('news'));
  const openTimelineCalendar = document.getElementById('openTimelineCalendar');
  if (openTimelineCalendar) openTimelineCalendar.addEventListener('click', () => switchTab('fixtures'));
  const openBoardroom = document.getElementById('openBoardroom');
  if (openBoardroom) openBoardroom.addEventListener('click', () => switchTab('boardroom'));
  bindDecisionButtons();
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

function renderSeasonTimeline() {
  if (!state.resultMemory.length) return '';
  const items = state.resultMemory.slice(0, 5).map(memory => {
    const home = state.league.clubsById[memory.home];
    const away = state.league.clubsById[memory.away];
    const result = calendarResultSummary(memory);
    return `<li>
      <strong>${memory.date}</strong> · ${memory.competition} · ${memory.round}
      <span class="${memory.outcome === 'W' ? 'success' : memory.outcome === 'L' ? 'danger' : 'warning'}">${result.text}</span>
      <span class="muted small">${memory.involved ? `vs ${memory.opponent ? state.league.clubsById[memory.opponent].short : ''}` : `${home.short}/${away.short}`}</span>
    </li>`;
  }).join('');
  return `<div class="card">
    <div class="flex-between">
      <h2 class="mb0">Season Timeline</h2>
      <button class="btn-ghost btn-sm" id="openTimelineCalendar">Open calendar</button>
    </div>
    <ul class="plain-list mt">${items}</ul>
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
  return `<div class="card">
    <div class="flex-between">
      <h2 class="mb0">Decision Inbox</h2>
      <span class="muted small">${pending.length} pending</span>
    </div>
    <div class="decision-list mt">
      ${items.map(decision => `
        <article class="decision-item ${decision.importance >= 3 ? 'major' : ''}">
          <div>
            <span class="story-kicker">${decision.source}</span>
            <strong>${decision.title}</strong>
            <p class="muted small">${decision.body}</p>
            <p class="small ${decision.importance >= 2 ? 'warning' : 'muted'}">${decision.impact}</p>
          </div>
          <div class="decision-actions">
            <button class="btn btn-sm" data-decision-approve="${decision.id}">${decision.actionLabel || 'Approve'}</button>
            <button class="btn-ghost btn-sm" data-decision-dismiss="${decision.id}">Dismiss</button>
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
      </div>
      <p class="small ${bandClass(pressure.band)} mt">${pressure.text} Pressure score: ${pressure.score}/100.</p>
    </div>

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

    <div class="card">
      <div class="flex-between">
        <h2 class="mb0">Manager Performance Meeting</h2>
        <span class="muted small">${club.manager.name} · confidence ${club.manager.confidence ?? 60}/100</span>
      </div>
      <p class="muted small mt">Meetings adjust manager confidence and create a news story. They are broad chairman actions, not match-by-match tactics.</p>
      <div class="flex mt action-row">
        <button class="btn btn-sm" data-manager-meeting="back">Publicly Back Manager</button>
        <button class="btn-ghost btn-sm" data-manager-meeting="review">Hold Review Meeting</button>
        <button class="btn-ghost btn-sm danger-action" data-manager-meeting="warn">Issue Warning</button>
      </div>
    </div>

    ${renderDecisionInbox(false)}

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
    state.market = guidedMarket(club);
    addStory(boardroomPolicyStory(club, RECRUITMENT_POLICIES[state.boardPlan.recruitmentPolicy], BUDGET_PRIORITIES[state.boardPlan.budgetPriority]));
    render();
  });
  document.getElementById('budgetPriority').addEventListener('change', e => {
    state.boardPlan.budgetPriority = e.target.value;
    addStory(boardroomPolicyStory(club, RECRUITMENT_POLICIES[state.boardPlan.recruitmentPolicy], BUDGET_PRIORITIES[state.boardPlan.budgetPriority]));
    render();
  });
  document.querySelectorAll('[data-manager-meeting]').forEach(btn => {
    btn.addEventListener('click', () => holdManagerMeeting(btn.dataset.managerMeeting, pressure));
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

function holdManagerMeeting(action, pressure) {
  const club = userClub();
  const manager = club.manager;
  if (!manager) return;
  const delta = action === 'back' ? 6 : action === 'warn' ? -8 : pressure.band === 'danger' ? -3 : 2;
  manager.confidence = Math.max(20, Math.min(95, (manager.confidence ?? 60) + delta));
  state.boardPlan.lastManagerMeeting = { action, week: state.currentWeek, season: state.season };
  addStory(managerMeetingStory(club, manager, action, pressure));
  render();
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
  addStory(directorAppointmentStory(club, club.director, cost));
  render();
}

function approveDecision(id) {
  const decision = state.decisions.find(d => d.id === id);
  if (!decision) return;
  const club = userClub();

  if (decision.type === 'scout_policy') {
    state.boardPlan.recruitmentPolicy = decision.payload.policy;
    state.market = guidedMarket(club);
  }
  if (decision.type === 'back_manager' && club.manager) {
    club.manager.confidence = Math.min(95, (club.manager.confidence ?? 60) + 6);
  }
  if (decision.type === 'tighten_spending' || decision.type === 'delay_facilities') {
    state.boardPlan.budgetPriority = decision.payload.priority || 'cautious';
  }
  if (decision.type === 'greenlight_transfer') {
    state.transferFilters = { ...(state.transferFilters || {}), affordableOnly: true };
    state.currentTab = 'transfers';
  }
  if (decision.type === 'pressure_response') {
    state.confidence = Math.min(100, state.confidence + 3);
  }

  addStory(staffDecisionStory(club, decision));
  state.decisions = state.decisions.filter(d => d.id !== id);
  render();
}

function dismissDecision(id) {
  state.decisions = state.decisions.filter(d => d.id !== id);
  render();
}

function currentPressure(club, pos, track) {
  const history = state.clubHistory || createClubHistory(club);
  const latest = history.seasons?.at(-1) || null;
  return pressureSnapshot({
    club,
    position: pos,
    objective: state.objective,
    track,
    fanMood: fanMood(history, state.confidence, latest),
  });
}

function generateDecisionReports(reason = 'routine') {
  if (!state.league) return;
  const club = userClub();
  const table = divisionStandings(state.league.clubs, club.division);
  const pos = table.indexOf(club) + 1;
  const track = trackStatus(state.objective, pos, club.played);
  const pressure = currentPressure(club, pos, track);
  const reports = createStaffReports({
    club,
    market: state.market,
    forecast: financeForecast(club),
    pressure,
    track,
    boardPlan: state.boardPlan,
    season: state.season,
    week: state.currentWeek,
    reason,
  });
  const existing = new Set((state.decisions || []).map(d => d.id));
  const fresh = reports.filter(d => !existing.has(d.id));
  state.decisions = [...(state.decisions || []), ...fresh]
    .sort((a, b) => (b.importance || 1) - (a.importance || 1))
    .slice(0, 8);
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

  const rows = players.map(p => `
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
      <td class="num">£${fmt(p.value)}</td>
      <td><button class="btn-ghost btn-sm" data-sell="${p.id}">Sell</button></td>
    </tr>
  `).join('');

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
          <th class="num">Form</th><th>Status</th><th class="num">Wage</th><th class="num">Value</th><th></th>
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
      if (confirm(`Sell ${p.name} for £${fmt(Math.round(p.value * 0.9))}?`)) {
        const fee = sellPlayer(p, club);
        alert(`${p.name} sold for £${fmt(fee)}.`);
        render();
      }
    });
  });
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
  club.cash -= cost;
  club.manager = { ...candidate, confidence: 60, directive: 'trust' };
  applyManagerTactics(club);
  state.managerMarket = availableManagersForClub(club, state.season);
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
    const fitClass = fit.affordable ? (fit.improvement >= 5 || fit.need.priority === 'urgent' ? 'success' : 'warning') : 'danger';
    return `
    <tr>
      <td>${p.name}</td>
      <td><span class="pill ${p.position.toLowerCase()}">${p.position}</span></td>
      <td class="num">${p.age}</td>
      <td class="num"><strong>${p.overall}</strong></td>
      <td class="num ${fit.improvement >= 0 ? 'success' : 'muted'}">${signed(fit.improvement)}</td>
      <td class="num">£${fmt(p.wage)}/wk</td>
      <td class="num">£${fmt(fit.askingPrice)}</td>
      <td><span class="${fitClass} small">${fit.recommendation}</span></td>
      <td><span class="${bandClass(rec.band)} small">${rec.label} · ${policyFit.score}</span></td>
      <td><button class="btn btn-sm" data-buy="${p.id}">Bid</button></td>
    </tr>`;
  }).join('');

  document.getElementById('transfers').innerHTML = `
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
        <thead><tr><th>Name</th><th>Pos</th><th class="num">Age</th><th class="num">OVR</th><th class="num">Vs Best</th><th class="num">Wage</th><th class="num">Ask</th><th>Squad Fit</th><th>DoF View</th><th></th></tr></thead>
        <tbody>${rows || '<tr><td colspan="10" class="muted">No targets match these filters.</td></tr>'}</tbody>
      </table>
    </div>`;

  document.querySelectorAll('[data-buy]').forEach(btn => {
    btn.addEventListener('click', () => openBid(btn.dataset.buy));
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
    addStory(transferMarketStory(state.market, club));
    render();
  });
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
    completeTransferIn(target, fee, club, state.market);
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
    addStory(infrastructureStory({
      title: 'Stadium expansion approved',
      body: `Capacity increased by ${fmt(expansion.seats)} seats. Forecast annual matchday gain: £${fmt(expansion.annualGain)}.`,
      type: 'finance',
    }));
    render();
  });
  document.getElementById('setTicket').addEventListener('click', () => {
    const v = parseInt(document.getElementById('ticket').value, 10);
    if (v >= 5 && v <= 80) { club.ticketPrice = v; render(); }
  });
  document.getElementById('upAcademy').addEventListener('click', () => {
    club.cash -= academyPlan.cost; club.academy++;
    addStory(infrastructureStory({
      title: 'Academy pathway upgraded',
      body: `Academy is now level ${club.academy}. ${academyPlan.impact}`,
      type: 'development',
    }));
    render();
  });
  document.getElementById('upTraining').addEventListener('click', () => {
    club.cash -= trainingPlan.cost; club.training++;
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

function onNewSeason() {
  if (state.cup?.status === 'active') {
    alert('Finish the active Chairman Cup before starting the next season.');
    state.currentTab = 'cup';
    document.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === 'cup'));
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
  //     board confidence and job status (transparent two-strike sack rule).
  const grading = gradeLeagueObjective(state.objective, finalPos);
  const review = applyConfidence(state.confidence, grading.delta, grading.grade, state.badlyStreak);
  state.confidence = review.confidence;
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

  // 3b. If the board sacked the manager, end the game cleanly here.
  if (review.sacked) {
    alert(
      `Season ${state.season} review\n\n` +
      `${grading.message}\n\n` +
      `🔴 SACKED\n${review.jobMessage}\n\n` +
      `You finished ${finalPos}${ord(finalPos)} in ${oldDivName} with board confidence at ${review.confidence}/100.`
    );
    if (confirm('Start a new game with a fresh club?')) {
      localStorage.removeItem(SAVE_KEY);
      showClubSelection();
      return;
    }
    state.currentTab = 'dashboard';
    document.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === 'dashboard'));
    render();
    return;
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
  document.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === 'dashboard'));
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
