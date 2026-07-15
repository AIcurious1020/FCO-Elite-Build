# FCO-Elite — Football Club Owner

A web-first football club management sim inspired by Football Chairman Pro 2, rebuilt with **deeper simulation, fairer finances, and a modern UI**. Pure HTML + JavaScript (ES modules), no build step, no frameworks.

## Design pillars

- **Transparent match simulation** — every result shows expected goals, both sides' attack/defence ratings, and the home bonus. Goals are drawn from a fair Poisson model, so favourites win at the correct rate with **no rigged streaks**.
- **Smooth financial progression** — solid revenue floor, division-scaled TV money, and advisory (not instant-death) wage warnings. One bad season hurts but never bankrupts a well-run club.
- **Clean, fast UI** — sticky nav, responsive cards and tables, mobile-friendly, instant tab switching.
- **Chairman-first depth** — full double round-robin fixtures, live league table, boardroom budget planning, Director of Football recruitment policy, head coach hiring/directives, transparent transfers, stadium expansion, and youth/training infrastructure.

## Features

| Tab | What it does |
|-----|--------------|
| Dashboard | Icon-led club health, decisions, alerts, next fixture, and latest headlines |
| News | Season stories covering results, transfers, injuries, cups, and rival activity |
| Club | Club identity, chairman profile, history, honours, records, and fan mood |
| Boardroom | Chairman Agenda dilemmas, Director of Football, recruitment policy, contract renewals, budget priority, manager statements, supporter messaging, fan/media pressure |
| Squad | Full squad with position-weighted overalls, best-XI highlighting, contract status, manager player views, sell players |
| Manager | Hire/replace the head coach, set chairman instructions, and review tactical output |
| Fixtures | Your full season calendar, including scheduled league and cup dates |
| Cup | Integrated knockout competition played during the normal season |
| Table | Live standings (P, W, D, L, GF, GA, GD, Pts) |
| Transfers | Periodic need-led Deal Room approvals, scout targets, DoF and manager views, bid with clear accept/reject rules |
| Finance | Projected revenue/costs, P&L, wage-to-revenue health band |
| Stadium | Expand capacity, set ticket price, upgrade academy & training |

Progress **autosaves** to `localStorage`.

## Project structure

```
FCO-elite/
  index.html
  css/styles.css
  js/
    app.js        # controller: state, routing, rendering, game loop, save/load
    player.js     # Player model, overall rating, valuation
    club.js       # Club model, best XI, team ratings
    match.js      # transparent Poisson match engine
    league.js     # fixtures, results, standings
    finance.js    # revenue, costs, health bands
    transfers.js  # market + transparent negotiation
    manager.js    # head coach market, style, directives, tactical output
    contracts.js  # player contract status, renewal demand, expiry ticking
    staff.js      # boardroom staff, recruitment policy, budgets, pressure, staff reports
    data.js       # seed football pyramid, generated squads
```

## Run locally

```bash
cd FCO-elite
python3 -m http.server 8000
# open http://localhost:8000
```

(A static server is required because the app uses ES modules.)

## Deploy

**GitHub Pages:** Settings → Pages → Deploy from branch → `main` / root.
**Vercel:** Import the repo, framework preset "Other", root directory = repo root.

## Roadmap

- Deeper boardroom delegation and staff accountability
- Richer multi-season club identity and fan expectations
- Expanded transfer/news world model
- Optional Supabase backend for cloud saves
- Fair, optional monetisation (cosmetic only)
