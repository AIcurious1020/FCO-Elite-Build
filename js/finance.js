// js/finance.js
// Financial model designed to avoid "death spirals": revenue has a solid floor,
// TV/prize money scales with division, and wage warnings are advisory, not
// instant-kill. A single bad season hurts but never bankrupts a well-run club.

// Division prize/TV money per season (£). Index 0 = top tier.
const TV_MONEY = [42_000_000, 8_000_000, 2_400_000, 900_000, 300_000, 90_000];

// Matchday revenue for one home league game.
export function matchdayRevenue(club, winRatio = 0.4) {
  // Attendance rises with form and reputation but is capped by the stadium.
  const pull = 0.45 + 0.30 * winRatio + 0.05 * club.reputation;
  const attendance = Math.min(club.stadiumCapacity, club.stadiumCapacity * pull);
  return Math.round(attendance * club.ticketPrice);
}

// Full-season revenue breakdown.
export function seasonRevenue(club, seasonStats = {}) {
  const played = seasonStats.played ?? club.played ?? 38;
  const won = seasonStats.won ?? club.won ?? 0;
  const winRatio = played ? won / played : 0.4;

  const homeGames = Math.max(1, Math.round(played / 2));
  const matchday = matchdayRevenue(club, winRatio) * homeGames;

  const tv = TV_MONEY[club.division] ?? 20_000;

  // Commercial scales with reputation; sponsors like winners.
  const commercial = Math.round(
    club.baseCommercial * (1 + 0.15 * club.reputation) * (1 + 0.3 * winRatio)
  );

  return {
    matchday,
    tv,
    commercial,
    total: matchday + tv + commercial,
  };
}

// Annual costs.
export function seasonCosts(club) {
  const wages = club.wageBill() * 52; // weekly bill over the year
  const upkeep = Math.round(club.stadiumCapacity * 40); // stadium + staff
  const infrastructure = (club.academy + club.training) * 25_000;
  return { wages, upkeep, infrastructure, total: wages + upkeep + infrastructure };
}

// Financial health — advisory bands, never an automatic game-over.
export function financialHealth(club) {
  const rev = seasonRevenue(club).total;
  const wages = club.wageBill() * 52;
  const ratio = rev ? wages / rev : 1;

  let band, label, advice;
  if (ratio < 0.60) { band = 'safe'; label = 'Healthy'; advice = 'Room to invest in wages or transfers.'; }
  else if (ratio < 0.80) { band = 'ok'; label = 'Sustainable'; advice = 'Wage bill is sensible for your revenue.'; }
  else if (ratio < 1.00) { band = 'warning'; label = 'Stretched'; advice = 'Wages are high — avoid new big contracts.'; }
  else { band = 'danger'; label = 'Overspending'; advice = 'Wages exceed revenue. Sell or reduce wages soon.'; }

  return { ratio, band, label, advice, revenue: rev, wages };
}

// Apply end-of-season finances to a club's cash balance. Returns the P&L.
export function applySeasonFinances(club) {
  const rev = seasonRevenue(club);
  const cost = seasonCosts(club);
  const profit = rev.total - cost.total;
  club.cash += profit;
  return { revenue: rev, costs: cost, profit, balance: club.cash };
}

export { TV_MONEY };
