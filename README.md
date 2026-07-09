# FCO-Elite — Football Club Owner

A web-first football club management sim inspired by Football Chairman Pro 2, rebuilt with **deeper simulation, fairer finances, and a modern UI**. Pure HTML + JavaScript (ES modules), no build step, no frameworks.

## Design pillars

- **Transparent match simulation** — every result shows expected goals, both sides' attack/defence ratings, and the home bonus. Goals are drawn from a fair Poisson model, so favourites win at the correct rate with **no rigged streaks**.
- **Smooth financial progression** — solid revenue floor, division-scaled TV money, and advisory (not instant-death) wage warnings. One bad season hurts but never bankrupts a well-run club.
- **Clean, fast UI** — sticky nav, responsive cards and tables, mobile-friendly, instant tab switching.
- **Depth** — full double round-robin fixtures, live league table, tactics, transfer market with transparent negotiation, stadium expansion, and youth/training infrastructure.

## Features

| Tab | What it does |
|-----|--------------|
| Dashboard | Season progress, next fixture, one-click "Play Next Matchweek", latest results |
| Squad | Full squad with position-weighted overalls, best-XI highlighting, sell players |
| Tactics | Mentality + pressing that transparently scale your ratings |
| Fixtures | Your full season schedule (home/away, played/upcoming) |
| Table | Live standings (P, W, D, L, GF, GA, GD, Pts) |
| Transfers | Scout targets, bid with clear accept/reject rules |
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
    data.js       # seed league (8 clubs, generated squads)
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

- Multi-division promotion/relegation across the pyramid
- Youth prospects generated from academy level
- Injuries & suspensions
- Optional Supabase backend for cloud saves
- Fair, optional monetisation (cosmetic only)
