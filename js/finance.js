// js/finance.js
// Financial model designed to avoid "death spirals": revenue has a solid floor,
// TV/prize money scales with division, and wage warnings are advisory, not
// instant-kill. A single bad season hurts but never bankrupts a well-run club.

// Division prize/TV money per season (£), indexed by division number.
//   [0] unused · [1] Div 1 (top) · [2] Div 2 · [3] Div 3 (bottom)
// The gap between tiers is the reward for promotion and the sting of the drop.
const TV_MONEY = [0, 18_000_000, 4_000_000, 900_000];
const BASE_TICKET_PRICE = [0, 34, 24, 18];

// Matchday revenue for one home league game.
export function matchdayRevenue(club, winRatio = 0.4) {
  const attendance = projectedAttendance(club, winRatio);
  return Math.round(attendance * club.ticketPrice);
}

export function projectedAttendance(club, winRatio = 0.4, ticketPrice = club.ticketPrice, capacity = club.stadiumCapacity) {
  // Attendance rises with form/reputation but falls if tickets outrun the local market.
  const basePull = 0.45 + 0.30 * winRatio + 0.05 * club.reputation;
  const fairPrice = BASE_TICKET_PRICE[club.division] ?? 20;
  const pricePressure = (ticketPrice - fairPrice) / fairPrice;
  const priceEffect = Math.max(0.55, Math.min(1.15, 1 - pricePressure * 0.45));
  return Math.round(Math.min(capacity, capacity * basePull * priceEffect));
}

// Full-season revenue breakdown.
export function seasonRevenue(club, seasonStats = {}) {
  const played = seasonStats.played ?? (club.played || 14);
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

export function financeForecast(club) {
  const revenue = seasonRevenue(club);
  const costs = seasonCosts(club);
  const profit = revenue.total - costs.total;
  const reserveTarget = Math.round(costs.total * 0.15);
  const transferBudget = Math.max(0, club.cash - reserveTarget);
  const annualWageBudget = Math.round(revenue.total * 0.75);
  const weeklyWageBudget = Math.round(annualWageBudget / 52);
  const remainingWeeklyWage = weeklyWageBudget - club.wageBill();
  const runway = profit >= 0 ? Infinity : club.cash / Math.abs(profit);

  let risk = 'safe', label = 'Stable';
  if (profit < 0 && runway < 1) { risk = 'danger'; label = 'Cash risk this season'; }
  else if (profit < 0 && runway < 2) { risk = 'warning'; label = 'Watch cash runway'; }
  else if (remainingWeeklyWage < 0) { risk = 'warning'; label = 'Wage budget stretched'; }

  return {
    revenue,
    costs,
    profit,
    reserveTarget,
    transferBudget,
    annualWageBudget,
    weeklyWageBudget,
    remainingWeeklyWage,
    runway,
    risk,
    label,
  };
}

export function stadiumExpansionPlan(club, seats = 2000) {
  const cost = Math.round(club.stadiumCapacity * 350);
  const currentRevenue = seasonRevenue(club).matchday;
  const expandedClub = { ...club, stadiumCapacity: club.stadiumCapacity + seats };
  const expandedRevenue = seasonRevenue(expandedClub).matchday;
  const annualGain = Math.max(0, expandedRevenue - currentRevenue);
  return {
    seats,
    cost,
    annualGain,
    paybackYears: annualGain ? cost / annualGain : Infinity,
    label: annualGain ? `${(cost / annualGain).toFixed(1)} season payback` : 'Low ROI until demand grows',
  };
}

export function ticketPricePlan(club) {
  const prices = [
    Math.max(5, club.ticketPrice - 2),
    club.ticketPrice,
    Math.min(80, club.ticketPrice + 2),
  ];
  const played = club.played || 14;
  const winRatio = played ? club.won / played : 0.4;
  return prices.map(price => {
    const attendance = projectedAttendance(club, winRatio, price);
    const homeGames = Math.max(1, Math.round(played / 2));
    return {
      price,
      attendance,
      seasonMatchday: Math.round(attendance * price * homeGames),
      current: price === club.ticketPrice,
    };
  });
}

export function infrastructureUpgradePlan(club, kind) {
  const level = kind === 'academy' ? club.academy : club.training;
  const cost = level * 200_000;
  const nextLevel = Math.min(5, level + 1);
  const annualCostIncrease = 25_000;
  const impact = kind === 'academy'
    ? nextLevel >= 4 ? 'Adds a second yearly prospect and improves potential.' : 'Improves youth intake overall and potential.'
    : 'Improves player growth and softens older-player decline.';
  return { kind, level, nextLevel, cost, annualCostIncrease, impact, maxed: level >= 5 };
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
