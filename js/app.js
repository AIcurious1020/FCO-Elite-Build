// js/app.js
// Main controller: global state, tab routing, rendering, game loop, save/load.

import { createLeague, DIVISIONS, TOP_DIVISION, BOTTOM_DIVISION } from './data.js';
import { Club, teamRatings } from './club.js';
import { Player } from './player.js';
import { simulateMatch, HOME_BONUS, outcomeProbabilities } from './match.js';
import { generateFixtures, playMatchweek, recordResult, standings } from './league.js';
import {
  seasonRevenue, seasonCosts, financialHealth, applySeasonFinances,
} from './finance.js';
import {
  generateMarket, evaluateBid, completeTransferIn, sellPlayer,
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

// v3 save schema (multi-division + board objectives). Older saves are
// incompatible, so they are simply ignored and a fresh pyramid game starts.
const SAVE_KEY = 'fco-elite-save-v3';

const state = {
  league: null,
  fixtures: [],
  currentWeek: 0,   // index into fixtures
  season: 1,
  market: [],
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
};

/* ------------------------------------------------------------------ */
/* Bootstrap                                                          */
/* ------------------------------------------------------------------ */
function init() {
  if (!load()) newGame();
  setupTabs();
  setupGlobalButtons();
  render();
}

function newGame() {
  const lg = createLeague('solihull');
  state.league = lg;
  const uc = lg.clubsById[lg.userClubId];
  // Only the user's own division plays interactively; other divisions are
  // auto-simulated at season end.
  state.fixtures = generateFixtures(clubsInDivision(lg.clubs, uc.division));
  state.currentWeek = 0;
  state.season = 1;
  state.market = generateMarket(uc);
  state.lastResults = [];
  // Board objectives for the opening season.
  state.confidence = START_CONFIDENCE;
  state.badlyStreak = 0;
  state.jobStatus = 'secure';
  state.lastMove = null;
  state.lastReview = null;
  state.developmentReport = null;
  state.objective = setLeagueObjective(uc, null, clubsInDivision(lg.clubs, uc.division).length);
  state.financeObjective = setFinanceObjective();
  state.inbox = [];
  addInbox('Board objective set', `${state.objective.label}: ${state.objective.reason}`, 'board');
  addInbox('Financial guardrail', state.financeObjective.detail, 'finance');
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
    state.market = (data.market || []).map(p => Object.assign(new Player(p), p));
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
    // Safety: if an objective is missing (older-but-compatible save), set one.
    if (!state.objective) {
      const uc = clubsById[data.userClubId];
      state.objective = setLeagueObjective(uc, null, clubsInDivision(clubs, uc.division).length);
    }
    if (!state.inbox.length) {
      addInbox('Save loaded', 'Your club is ready. Review the next match and board objective before advancing.', 'system');
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
    played: c.played, won: c.won, drawn: c.drawn, lost: c.lost,
    gf: c.gf, ga: c.ga, points: c.points,
    players: c.players.map(serialisePlayer),
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
      state.currentTab = btn.dataset.tab;
      document.querySelectorAll('[data-tab]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      render();
    });
  });
}

function setupGlobalButtons() {
  document.getElementById('resetGame').addEventListener('click', () => {
    if (confirm('Reset the game? This deletes your current save.')) {
      localStorage.removeItem(SAVE_KEY);
      newGame();
      render();
    }
  });
  document.getElementById('closeMatchModal').addEventListener('click', () => {
    document.getElementById('matchModal').hidden = true;
  });
}

/* ------------------------------------------------------------------ */
/* Rendering                                                          */
/* ------------------------------------------------------------------ */
function render() {
  const club = userClub();
  document.getElementById('headerClubName').textContent = club.name;
  document.getElementById('headerCash').textContent = '£' + fmt(club.cash);

  document.querySelectorAll('.tab-content').forEach(s => { s.hidden = s.id !== state.currentTab; });

  const renderers = {
    dashboard: renderDashboard,
    squad: renderSquad,
    tactics: renderTactics,
    fixtures: renderFixtures,
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
  const totalWeeks = state.fixtures.length;
  const done = state.currentWeek;
  const nextWeek = state.fixtures[state.currentWeek];
  const health = financialHealth(club);

  // Board objective + live on-track status.
  const obj = state.objective;
  const track = trackStatus(obj, pos, club.played);
  const conf = confidenceLabel(state.confidence);

  const nextFixture = nextWeek
    ? nextWeek.matches.find(m => m.home === club.id || m.away === club.id)
    : null;
  const preview = nextFixture ? matchPreview(nextFixture) : null;

  document.getElementById('dashboard').innerHTML = `
    <div class="card">
      <div class="flex-between">
        <div>
          <h2 class="mb0">${club.name}</h2>
          <p class="muted small">${divInfo.name} · Season ${state.season} · Matchweek ${Math.min(done + 1, totalWeeks)} of ${totalWeeks}</p>
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
        <h2 class="mb0">Season Hub</h2>
        <span class="muted small">${state.inbox.length} updates</span>
      </div>
      ${renderInbox()}
    </div>

    <div class="card">
      <div class="flex-between">
        <h2 class="mb0">Next Match Preview</h2>
        ${preview ? `<span class="pill ${preview.userEdge >= 0 ? 'obj-ontrack' : 'obj-close'}">${preview.userEdge >= 0 ? 'Favourable' : 'Tough'}</span>` : ''}
      </div>
      ${preview ? renderMatchPreview(preview) : '<p class="muted">Season complete — advance to start the next one.</p>'}
      <div class="flex mt action-row">
        <button class="btn btn-lg" id="playNext" ${!nextFixture ? 'disabled' : ''}>▶ Play Next Matchweek</button>
      </div>
      ${!nextFixture ? `<button class="btn btn-success btn-lg mt" id="newSeason">Start Season ${state.season + 1}</button>` : ''}
    </div>

    <div class="grid">
      <div class="card mb0">
        <h3>Squad</h3>
        <p><strong>${club.players.length}</strong> players · Avg overall <strong>${avgOverall(club)}</strong></p>
        <p class="muted small">Best XI rating: ${Math.round((teamRatings(club).attack + teamRatings(club).defense) / 2)}</p>
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

    ${renderLastResults()}
  `;

  const playBtn = document.getElementById('playNext');
  if (playBtn) playBtn.addEventListener('click', onPlayNext);
  const ns = document.getElementById('newSeason');
  if (ns) ns.addEventListener('click', onNewSeason);
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

function renderInbox() {
  const items = state.inbox.slice(0, 5);
  if (!items.length) return '<p class="muted small mt">No updates yet. Play a matchweek to build the story of the season.</p>';
  return `<div class="inbox-list mt">${items.map(item => `
    <article class="inbox-item">
      <div class="inbox-dot ${item.type}"></div>
      <div>
        <div class="flex-between inbox-title-row">
          <strong>${item.title}</strong>
          <span class="muted small">${item.meta}</span>
        </div>
        <p class="muted small">${item.body}</p>
      </div>
    </article>
  `).join('')}</div>`;
}

function matchPreview(fx) {
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

  return {
    home, away, opponent, isHome,
    ratings: { home: homeRatings, away: awayRatings, user: userRatings, opponent: oppRatings },
    probs, userWin, oppWin, userEdge: userWin - oppWin,
    factors,
  };
}

function previewFactors(club, opponent, userRatings, oppRatings, isHome) {
  const factors = [];
  const attEdge = Math.round(userRatings.attack - oppRatings.defense);
  const defEdge = Math.round(userRatings.defense - oppRatings.attack);
  const avgGap = avgOverall(club) - avgOverall(opponent);

  factors.push(`${isHome ? `Home advantage adds +${HOME_BONUS} to attack and defence.` : 'Away match: no home bonus applied.'}`);
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

  return `
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
    </ul>`;
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

/* ---------- Squad ---------- */
function renderSquad() {
  const club = userClub();
  const players = club.players.slice().sort((a, b) =>
    posOrder(a.position) - posOrder(b.position) || b.overall - a.overall);
  const xi = new Set(club.bestEleven().map(p => p.id));

  const rows = players.map(p => `
    <tr class="${xi.has(p.id) ? 'highlight-row' : ''}">
      <td>${p.name} ${xi.has(p.id) ? '<span class="small success">●</span>' : ''}</td>
      <td><span class="pill ${p.position.toLowerCase()}">${p.position}</span></td>
      <td class="num">${p.age}</td>
      <td class="num"><strong>${p.overall}</strong></td>
      <td class="num">${p.attack}</td>
      <td class="num">${p.defense}</td>
      <td class="num">${p.passing}</td>
      <td class="num">${p.finish}</td>
      <td class="num small">${p.form.toFixed(2)}</td>
      <td class="num">£${fmt(p.wage)}</td>
      <td class="num">£${fmt(p.value)}</td>
      <td><button class="btn-ghost btn-sm" data-sell="${p.id}">Sell</button></td>
    </tr>
  `).join('');

  document.getElementById('squad').innerHTML = `
    ${renderSquadDevelopmentReport()}
    <div class="card">
      <h2>Squad · ${players.length} players <span class="muted small">(● = starting XI)</span></h2>
      <div style="overflow-x:auto">
      <table>
        <thead><tr>
          <th>Name</th><th>Pos</th><th class="num">Age</th><th class="num">OVR</th>
          <th class="num">Att</th><th class="num">Def</th><th class="num">Pas</th><th class="num">Fin</th>
          <th class="num">Form</th><th class="num">Wage</th><th class="num">Value</th><th></th>
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

/* ---------- Tactics ---------- */
function renderTactics() {
  const club = userClub();
  const r = teamRatings(club);
  document.getElementById('tactics').innerHTML = `
    <div class="card">
      <h2>Tactics</h2>
      <p class="muted small">Changes are transparent: mentality and pressing directly scale your attack and defence ratings shown below.</p>
      <div class="form-row">
        <label>Mentality</label>
        <select id="mentality">
          ${opt('defensive', club.tactics.mentality)}
          ${opt('balanced', club.tactics.mentality)}
          ${opt('attacking', club.tactics.mentality)}
        </select>
      </div>
      <div class="form-row">
        <label>Pressing</label>
        <select id="pressing">
          ${opt('low', club.tactics.pressing)}
          ${opt('medium', club.tactics.pressing)}
          ${opt('high', club.tactics.pressing)}
        </select>
      </div>
    </div>
    <div class="card">
      <h2>Current Best XI Ratings</h2>
      <div class="attr-bar"><span class="val">ATT</span><div class="bar"><div class="bar-fill blue" style="width:${Math.min(100, r.attack)}%"></div></div><span class="val">${Math.round(r.attack)}</span></div>
      <div class="attr-bar mt"><span class="val">DEF</span><div class="bar"><div class="bar-fill green" style="width:${Math.min(100, r.defense)}%"></div></div><span class="val">${Math.round(r.defense)}</span></div>
    </div>`;

  document.getElementById('mentality').addEventListener('change', e => {
    club.tactics.mentality = e.target.value; render();
  });
  document.getElementById('pressing').addEventListener('change', e => {
    club.tactics.pressing = e.target.value; render();
  });
}

function opt(v, sel) {
  const label = v.charAt(0).toUpperCase() + v.slice(1);
  return `<option value="${v}" ${v === sel ? 'selected' : ''}>${label}</option>`;
}

/* ---------- Fixtures ---------- */
function renderFixtures() {
  const club = userClub();
  const rows = state.fixtures.map(w => {
    const fx = w.matches.find(m => m.home === club.id || m.away === club.id);
    if (!fx) return '';
    const isHome = fx.home === club.id;
    const opp = state.league.clubsById[isHome ? fx.away : fx.home];
    const status = w.played ? 'played' : (w.week === state.currentWeek + 1 ? 'next' : 'upcoming');
    return `<tr class="${status === 'next' ? 'highlight-row' : ''}">
      <td class="num">${w.week}</td>
      <td>${isHome ? '🏠 Home' : '✈ Away'}</td>
      <td>${opp.name}</td>
      <td class="center">${w.played ? '✓' : (status === 'next' ? 'Next' : '—')}</td>
    </tr>`;
  }).join('');

  document.getElementById('fixtures').innerHTML = `
    <div class="card">
      <h2>Fixtures · Season ${state.season}</h2>
      <table>
        <thead><tr><th class="num">MW</th><th>Venue</th><th>Opponent</th><th class="center">Status</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
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
  const rows = state.market.map(p => `
    <tr>
      <td>${p.name}</td>
      <td><span class="pill ${p.position.toLowerCase()}">${p.position}</span></td>
      <td class="num">${p.age}</td>
      <td class="num"><strong>${p.overall}</strong></td>
      <td class="num">£${fmt(p.wage)}/wk</td>
      <td class="num">£${fmt(p.value)}</td>
      <td><button class="btn btn-sm" data-buy="${p.id}">Bid</button></td>
    </tr>`).join('');

  document.getElementById('transfers').innerHTML = `
    <div class="card">
      <div class="flex-between">
        <h2 class="mb0">Transfer Market</h2>
        <span class="success"><strong>£${fmt(club.cash)}</strong> available</span>
      </div>
      <p class="muted small mt">Bids are judged transparently: meet ~95% of a player's value and afford the fee, and it's accepted.</p>
      <table>
        <thead><tr><th>Name</th><th>Pos</th><th class="num">Age</th><th class="num">OVR</th><th class="num">Wage</th><th class="num">Value</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <button class="btn-ghost mt" id="refreshMarket">↻ Scout new targets</button>
    </div>`;

  document.querySelectorAll('[data-buy]').forEach(btn => {
    btn.addEventListener('click', () => openBid(btn.dataset.buy));
  });
  document.getElementById('refreshMarket').addEventListener('click', () => {
    state.market = generateMarket(club); render();
  });
}

function openBid(id) {
  const club = userClub();
  const target = state.market.find(p => p.id === id);
  if (!target) return;
  const suggested = Math.round(target.value * 0.95);
  const input = prompt(`Bid for ${target.name} (OVR ${target.overall}).\nAsking ~£${fmt(suggested)}. Your balance: £${fmt(club.cash)}.\n\nEnter your fee (£):`, suggested);
  if (input == null) return;
  const fee = parseInt(input.replace(/[^0-9]/g, ''), 10);
  if (!fee || fee <= 0) { alert('Enter a valid fee.'); return; }
  const verdict = evaluateBid(target, fee, club);
  if (verdict.accepted) {
    completeTransferIn(target, fee, club, state.market);
    alert(`${verdict.reason}\n${target.name} joins ${club.name}!`);
  } else {
    alert(verdict.reason);
  }
  render();
}

/* ---------- Finance ---------- */
function renderFinance() {
  const club = userClub();
  const rev = seasonRevenue(club);
  const cost = seasonCosts(club);
  const health = financialHealth(club);
  const projected = rev.total - cost.total;

  document.getElementById('finance').innerHTML = `
    <div class="card">
      <h2>Balance</h2>
      <p class="scoreline success">£${fmt(club.cash)}</p>
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
      <p class="muted small mt">Wage-to-revenue ratio. Under 80% is comfortable; the game never bankrupts you for a single bad season.</p>
    </div>`;
}

/* ---------- Stadium & Infrastructure ---------- */
function renderStadium() {
  const club = userClub();
  const expandCost = Math.round(club.stadiumCapacity * 350);
  const academyCost = club.academy * 200_000;
  const trainingCost = club.training * 200_000;

  document.getElementById('stadium').innerHTML = `
    <div class="card">
      <h2>Stadium</h2>
      <p>Capacity: <strong>${fmt(club.stadiumCapacity)}</strong> · Ticket £${club.ticketPrice}</p>
      <div class="form-row mt">
        <button class="btn" id="expand" ${club.cash < expandCost ? 'disabled' : ''}>Expand +2,000 seats (£${fmt(expandCost)})</button>
      </div>
      <div class="form-row">
        <label>Ticket price</label>
        <input type="number" id="ticket" value="${club.ticketPrice}" min="5" max="80" style="width:90px" />
        <button class="btn-ghost btn-sm" id="setTicket">Set</button>
      </div>
      <p class="muted small">Higher prices raise revenue per fan but real games would model attendance drop-off. Kept simple and fair here.</p>
    </div>
    <div class="grid">
      <div class="card mb0">
        <h3>Youth Academy · Level ${club.academy}</h3>
        <p class="muted small">Produces 1 youth prospect each season, or 2 from level 4. Higher levels improve starting OVR and potential.</p>
        <button class="btn btn-sm" id="upAcademy" ${club.academy >= 5 || club.cash < academyCost ? 'disabled' : ''}>Upgrade (£${fmt(academyCost)})</button>
      </div>
      <div class="card mb0">
        <h3>Training · Level ${club.training}</h3>
        <p class="muted small">Improves end-of-season growth and softens decline for older players.</p>
        <button class="btn btn-sm" id="upTraining" ${club.training >= 5 || club.cash < trainingCost ? 'disabled' : ''}>Upgrade (£${fmt(trainingCost)})</button>
      </div>
    </div>`;

  document.getElementById('expand').addEventListener('click', () => {
    club.cash -= expandCost; club.stadiumCapacity += 2000; render();
  });
  document.getElementById('setTicket').addEventListener('click', () => {
    const v = parseInt(document.getElementById('ticket').value, 10);
    if (v >= 5 && v <= 80) { club.ticketPrice = v; render(); }
  });
  document.getElementById('upAcademy').addEventListener('click', () => {
    club.cash -= academyCost; club.academy++; render();
  });
  document.getElementById('upTraining').addEventListener('click', () => {
    club.cash -= trainingCost; club.training++; render();
  });
}

/* ------------------------------------------------------------------ */
/* Game loop                                                          */
/* ------------------------------------------------------------------ */
function onPlayNext() {
  const week = state.fixtures[state.currentWeek];
  if (!week) return;
  const beforePos = divisionStandings(state.league.clubs, userDivision()).indexOf(userClub()) + 1;
  const results = playMatchweek(week, state.league.clubsById);
  state.lastResults = results;
  state.currentWeek++;

  // Show the user's own match in the modal.
  const uc = userClub();
  const mine = results.find(r => r.home === uc || r.away === uc);
  if (mine) {
    const afterPos = divisionStandings(state.league.clubs, uc.division).indexOf(uc) + 1;
    addMatchInbox(mine, beforePos, afterPos);
    showMatchModal(mine);
  }

  updateFormAndMorale(results);
  render();
}

function showMatchModal(r) {
  const uc = userClub();
  const events = [];
  r.timeline.home.forEach(m => events.push({ min: m, team: r.home.short, side: 'home' }));
  r.timeline.away.forEach(m => events.push({ min: m, team: r.away.short, side: 'away' }));
  events.sort((a, b) => a.min - b.min);
  const evHtml = events.length
    ? events.map(e => `<li><span class="min">${e.min}'</span> ⚽ ${e.team}</li>`).join('')
    : '<li class="muted">No goals.</li>';

  const won = (r.home === uc && r.result === 'H') || (r.away === uc && r.result === 'A');
  const drew = r.result === 'D';
  const verdict = drew ? 'Draw' : won ? 'Win' : 'Loss';
  const vClass = drew ? 'warning' : won ? 'success' : 'danger';
  const preview = matchPreview({ home: r.home.id, away: r.away.id });
  const userProb = pct(preview.userWin);
  const drawProb = pct(preview.probs.draw);
  const oppProb = pct(preview.oppWin);

  document.getElementById('matchModalContent').innerHTML = `
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
      <p class="muted small">Goals drawn from a fair Poisson model — favourites win at the correct rate, with no rigged streaks.</p>
    </div>`;
  document.getElementById('matchModal').hidden = false;
}

function addMatchInbox(r, beforePos, afterPos) {
  const uc = userClub();
  const isHome = r.home === uc;
  const opponent = isHome ? r.away : r.home;
  const won = (isHome && r.result === 'H') || (!isHome && r.result === 'A');
  const drew = r.result === 'D';
  const result = drew ? 'drew' : won ? 'won' : 'lost';
  const score = isHome ? `${r.homeGoals}-${r.awayGoals}` : `${r.awayGoals}-${r.homeGoals}`;
  const movement = beforePos === afterPos
    ? `You stay ${afterPos}${ord(afterPos)}.`
    : `Moved from ${beforePos}${ord(beforePos)} to ${afterPos}${ord(afterPos)}.`;
  const type = won ? 'result-good' : drew ? 'result-neutral' : 'result-bad';

  addInbox(
    `Matchweek ${state.currentWeek}: ${score} ${result}`,
    `${opponent.name} ${isHome ? 'visited' : 'hosted'} you. xG ${r.xg.home}-${r.xg.away}; ${movement}`,
    type
  );
}

// Light form/morale drift based on results (bounded, no wild swings).
function updateFormAndMorale(results) {
  for (const r of results) {
    const homeWin = r.result === 'H', awayWin = r.result === 'A';
    for (const p of r.home.players) driftPlayer(p, homeWin ? +1 : r.result === 'D' ? 0 : -1);
    for (const p of r.away.players) driftPlayer(p, awayWin ? +1 : r.result === 'D' ? 0 : -1);
  }
}
function driftPlayer(p, dir) {
  const step = 0.03 * dir + (Math.random() - 0.5) * 0.02;
  p.form = clampMult(p.form + step);
  p.morale = clampMult(p.morale + step * 0.6);
}
function clampMult(v) { return Math.max(0.85, Math.min(1.15, +v.toFixed(3))); }

function onNewSeason() {
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
      newGame();
    }
    state.currentTab = 'dashboard';
    document.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === 'dashboard'));
    render();
    return;
  }

  // 4. Promotion & relegation across the whole pyramid.
  const moves = applyPromotionRelegation(clubs, uc.id);

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
  state.market = generateMarket(uc);
  state.lastResults = [];

  // 6a. The board sets a fresh objective for the new season & division.
  state.objective = setLeagueObjective(uc, state.lastMove, clubsInDivision(clubs, uc.division).length);
  state.financeObjective = setFinanceObjective();
  state.inbox = [];
  addInbox('Season review complete', `${grading.message} ${review.jobMessage} Balance now £${fmt(uc.cash)}.`, 'board');
  addInbox('Player development report', state.developmentReport.summary.text, 'development');
  addInbox('New objective set', `${state.objective.label}: ${state.objective.reason}`, 'board');
  addInbox('Finance forecast refreshed', state.financeObjective.detail, 'finance');

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
function addInbox(title, body, type = 'system') {
  const meta = `S${state.season} · MW ${Math.min(state.currentWeek + 1, state.fixtures.length || 1)}`;
  state.inbox.unshift({ title, body, type, meta, at: Date.now() });
  state.inbox = state.inbox.slice(0, 12);
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
