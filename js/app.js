// js/app.js
// Main controller: global state, tab routing, rendering, game loop, save/load.

import { createLeague } from './data.js';
import { Club, teamRatings } from './club.js';
import { Player } from './player.js';
import { simulateMatch, HOME_BONUS } from './match.js';
import { generateFixtures, playMatchweek, recordResult, standings } from './league.js';
import {
  seasonRevenue, seasonCosts, financialHealth, applySeasonFinances,
} from './finance.js';
import {
  generateMarket, evaluateBid, completeTransferIn, sellPlayer,
} from './transfers.js';

const SAVE_KEY = 'fco-elite-save-v1';

const state = {
  league: null,
  fixtures: [],
  currentWeek: 0,   // index into fixtures
  season: 1,
  market: [],
  currentTab: 'dashboard',
  lastResults: [],
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
  state.fixtures = generateFixtures(lg.clubs);
  state.currentWeek = 0;
  state.season = 1;
  state.market = generateMarket(lg.clubsById[lg.userClubId]);
  state.lastResults = [];
}

function userClub() {
  return state.league.clubsById[state.league.userClubId];
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
  const table = standings(state.league.clubs);
  const pos = table.indexOf(club) + 1;
  const totalWeeks = state.fixtures.length;
  const done = state.currentWeek;
  const nextWeek = state.fixtures[state.currentWeek];
  const health = financialHealth(club);

  const nextFixture = nextWeek
    ? nextWeek.matches.find(m => m.home === club.id || m.away === club.id)
    : null;
  let nextHtml = '<p class="muted">Season complete — advance to start the next one.</p>';
  if (nextFixture) {
    const isHome = nextFixture.home === club.id;
    const opp = state.league.clubsById[isHome ? nextFixture.away : nextFixture.home];
    nextHtml = `<p><strong>${isHome ? club.name : opp.name}</strong> vs <strong>${isHome ? opp.name : club.name}</strong>
      <span class="muted small">(${isHome ? 'Home' : 'Away'})</span></p>`;
  }

  document.getElementById('dashboard').innerHTML = `
    <div class="card">
      <div class="flex-between">
        <div>
          <h2 class="mb0">${club.name}</h2>
          <p class="muted small">Season ${state.season} · Matchweek ${Math.min(done + 1, totalWeeks)} of ${totalWeeks}</p>
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
      <h2>Next Match</h2>
      ${nextHtml}
      <div class="flex mt">
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

    ${renderLastResults()}
  `;

  const playBtn = document.getElementById('playNext');
  if (playBtn) playBtn.addEventListener('click', onPlayNext);
  const ns = document.getElementById('newSeason');
  if (ns) ns.addEventListener('click', onNewSeason);
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

/* ---------- Table ---------- */
function renderTable() {
  const club = userClub();
  const table = standings(state.league.clubs);
  const rows = table.map((c, i) => `
    <tr class="${c === club ? 'highlight-row' : ''}">
      <td class="num">${i + 1}</td>
      <td>${c.name}</td>
      <td class="num">${c.played}</td>
      <td class="num">${c.won}</td>
      <td class="num">${c.drawn}</td>
      <td class="num">${c.lost}</td>
      <td class="num">${c.gf}</td>
      <td class="num">${c.ga}</td>
      <td class="num">${c.goalDiff > 0 ? '+' : ''}${c.goalDiff}</td>
      <td class="num"><strong>${c.points}</strong></td>
    </tr>`).join('');

  document.getElementById('table').innerHTML = `
    <div class="card">
      <h2>League Table</h2>
      <table>
        <thead><tr>
          <th class="num">#</th><th>Club</th><th class="num">P</th><th class="num">W</th>
          <th class="num">D</th><th class="num">L</th><th class="num">GF</th><th class="num">GA</th>
          <th class="num">GD</th><th class="num">Pts</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p class="muted small mt">Top 3 promoted · Bottom 2 relegated (applied at season end).</p>
    </div>`;
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
        <p class="muted small">Higher levels would produce better youth prospects each season.</p>
        <button class="btn btn-sm" id="upAcademy" ${club.academy >= 5 || club.cash < academyCost ? 'disabled' : ''}>Upgrade (£${fmt(academyCost)})</button>
      </div>
      <div class="card mb0">
        <h3>Training · Level ${club.training}</h3>
        <p class="muted small">Higher levels improve player development and form recovery.</p>
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
  const results = playMatchweek(week, state.league.clubsById);
  state.lastResults = results;
  state.currentWeek++;

  // Show the user's own match in the modal.
  const uc = userClub();
  const mine = results.find(r => r.home === uc || r.away === uc);
  if (mine) showMatchModal(mine);

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
      <p class="muted small">Goals drawn from a fair Poisson model — favourites win at the correct rate, with no rigged streaks.</p>
    </div>`;
  document.getElementById('matchModal').hidden = false;
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

  // Apply end-of-season finances.
  const uc = userClub();
  const pnl = applySeasonFinances(uc);

  // Reputation nudges from final position.
  const table = standings(clubs);
  table.forEach((c, i) => {
    if (i === 0) c.reputation = Math.min(10, c.reputation + 1);
    else if (i >= table.length - 2) c.reputation = Math.max(1, c.reputation - 0.5);
    c.reputation = +c.reputation.toFixed(1);
  });

  const finalPos = table.indexOf(uc) + 1;

  // Reset records, age players, regenerate fixtures.
  clubs.forEach(c => {
    c.resetSeasonRecord();
    c.players.forEach(p => { p.age++; p.appearances = 0; p.goals = 0; p.refreshValue(); });
  });

  state.fixtures = generateFixtures(clubs);
  state.currentWeek = 0;
  state.season++;
  state.market = generateMarket(uc);
  state.lastResults = [];

  alert(`Season ${state.season - 1} complete!\nYou finished ${finalPos}${ord(finalPos)}.\n\nP&L: ${pnl.profit >= 0 ? '+' : '−'}£${fmt(Math.abs(pnl.profit))}\nNew balance: £${fmt(uc.cash)}`);
  state.currentTab = 'dashboard';
  document.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === 'dashboard'));
  render();
}

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */
function fmt(n) { return Math.round(n).toLocaleString('en-GB'); }
function ord(n) { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return s[(v - 20) % 10] || s[v] || s[0]; }
function avgOverall(club) {
  if (!club.players.length) return 0;
  return Math.round(club.players.reduce((s, p) => s + p.overall, 0) / club.players.length);
}
function posOrder(pos) { return { GK: 0, DEF: 1, MID: 2, FWD: 3 }[pos] ?? 4; }
function bandClass(band) {
  return band === 'safe' || band === 'ok' ? 'success' : band === 'warning' ? 'warning' : 'danger';
}

init();
