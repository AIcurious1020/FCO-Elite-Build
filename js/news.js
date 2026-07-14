// js/news.js
// Contextual story generation for the season feed.
// Stories are intentionally generated from real sim events so the world feels
// alive without inventing hidden outcomes.

export function matchStory({ result, userClub, beforePos, afterPos }) {
  const isHome = result.home === userClub;
  const opponent = isHome ? result.away : result.home;
  const userGoals = isHome ? result.homeGoals : result.awayGoals;
  const oppGoals = isHome ? result.awayGoals : result.homeGoals;
  const won = userGoals > oppGoals;
  const drew = userGoals === oppGoals;
  const moved = beforePos !== afterPos;
  const type = won ? 'result-good' : drew ? 'result-neutral' : 'result-bad';
  const headline = won
    ? `${userClub.short} take three points against ${opponent.short}`
    : drew ? `${userClub.short} held by ${opponent.short}`
      : `${opponent.short} punish ${userClub.short}`;
  const positionLine = moved
    ? `The result moves the club from ${ordinal(beforePos)} to ${ordinal(afterPos)}.`
    : `The club stays ${ordinal(afterPos)} in the table.`;

  return {
    title: headline,
    body: `${userClub.name} ${won ? 'beat' : drew ? 'drew with' : 'lost to'} ${opponent.name} ${userGoals}-${oppGoals}. xG: ${result.xg.home}-${result.xg.away}. ${positionLine}`,
    type,
    category: 'Match',
    importance: won || !drew ? 2 : 1,
  };
}

export function divisionStory(table, userClub) {
  const leader = table[0];
  const userPos = table.indexOf(userClub) + 1;
  const title = leader === userClub
    ? `${userClub.short} set the pace`
    : `${leader.short} lead the division`;
  const body = leader === userClub
    ? `${userClub.name} sit top after the latest round, with supporters starting to believe.`
    : `${leader.name} are top on ${leader.points} points. ${userClub.name} are ${ordinal(userPos)}.`;
  return { title, body, type: leader === userClub ? 'result-good' : 'league', category: 'League', importance: 1 };
}

export function transferMarketStory(market, club) {
  if (!market.length) return null;
  const top = market.slice().sort((a, b) => b.overall - a.overall)[0];
  const affordable = market.filter(p => p.value * 0.95 <= club.cash).length;
  return {
    title: `${top.position} ${top.name} headlines scouting list`,
    body: `${top.name} is the strongest available target at ${top.overall} OVR. ${affordable} listed players look affordable at current prices.`,
    type: 'transfer',
    category: 'Transfers',
    importance: 1,
  };
}

export function transferCompletedStory({ player, fee, club, wageRatio }) {
  return {
    title: `${club.short} complete ${player.name} deal`,
    body: `${player.name} joins ${club.name} for £${fmt(fee)}. The projected wage-to-revenue ratio is now ${(wageRatio * 100).toFixed(0)}%.`,
    type: 'transfer',
    category: 'Transfers',
    importance: 2,
  };
}

export function infrastructureStory({ title, body, type = 'finance' }) {
  return { title, body, type, category: type === 'development' ? 'Infrastructure' : 'Finance', importance: 1 };
}

export function seasonReviewStories({ memory, financeReport, developmentReport }) {
  const stories = [];
  stories.push({
    title: `Season ${memory.season} verdict: ${memory.summary}`,
    body: `${memory.divisionName}: ${memory.finalPos}${ordinalSuffix(memory.finalPos)} place, ${memory.points} points. Objective: ${memory.objective}.`,
    type: memory.move === 'promoted' ? 'result-good' : memory.move === 'relegated' ? 'result-bad' : 'history',
    category: 'Season',
    importance: 3,
  });
  if (financeReport) {
    stories.push({
      title: `Finance report: ${financeReport.profit >= 0 ? 'profit recorded' : 'loss recorded'}`,
      body: financeReport.summary,
      type: financeReport.profit >= 0 ? 'finance' : 'result-bad',
      category: 'Finance',
      importance: 2,
    });
  }
  if (developmentReport) {
    stories.push({
      title: 'Development staff publish squad report',
      body: developmentReport.summary.text,
      type: 'development',
      category: 'Development',
      importance: 2,
    });
  }
  return stories;
}

export function objectiveStory(objective) {
  return {
    title: `Board set target: ${objective.label}`,
    body: `${objective.reason} Target: finish ${ordinal(objective.targetPos)} or better in ${objective.divisionName}.`,
    type: 'board',
    category: 'Board',
    importance: 2,
  };
}

export function injuryStory(event, userClub) {
  const isUser = event.club === userClub;
  if (event.kind === 'return') {
    return {
      title: `${event.player.name} returns to training`,
      body: `${event.player.name} has recovered from ${event.injury || 'injury'} and is available again for ${event.club.name}.`,
      type: 'fitness',
      category: isUser ? 'Squad' : 'League',
      importance: isUser ? 2 : 1,
    };
  }
  return {
    title: `${event.player.name} ruled out for ${event.weeks} week${event.weeks === 1 ? '' : 's'}`,
    body: `${event.club.name} will be without ${event.player.name} after ${article(event.injury)} ${event.injury}. Squad depth at ${event.player.position} is now under the spotlight.`,
    type: isUser ? 'injury' : 'league',
    category: isUser ? 'Squad' : 'League',
    importance: isUser ? 3 : 1,
  };
}

export function cupStory({ result, round, userClub, prize = 0 }) {
  const isHome = result.home === userClub;
  const opponent = isHome ? result.away : result.home;
  const userGoals = isHome ? result.homeGoals : result.awayGoals;
  const oppGoals = isHome ? result.awayGoals : result.homeGoals;
  const won = result.winner === userClub;
  const shootout = result.tiebreak ? ` ${result.tiebreak.method}: ${result.tiebreak.penaltyScore}.` : '';
  const prizeLine = won && prize ? ` Prize money: £${fmt(prize)}.` : '';
  return {
    title: won
      ? `${userClub.short} advance in the ${round.short}`
      : `${userClub.short} exit the ${round.short}`,
    body: `${userClub.name} ${won ? 'beat' : 'lost to'} ${opponent.name} ${userGoals}-${oppGoals}.${shootout} xG: ${result.xg.home}-${result.xg.away}.${prizeLine}`,
    type: won ? 'cup-good' : 'cup-bad',
    category: 'Cup',
    importance: won ? 3 : 2,
  };
}

export function cupRoundStory({ round, results, clubsById, championId }) {
  const upsets = results.filter(r => r.winner.reputation < (r.winner === r.home ? r.away.reputation : r.home.reputation));
  if (championId) {
    const champion = clubsById[championId];
    return {
      title: `${champion.short} lift the Chairman Cup`,
      body: `${champion.name} win the final and add the season's first major knockout story.`,
      type: 'cup-good',
      category: 'Cup',
      importance: 3,
    };
  }
  if (upsets.length) {
    const r = upsets[0];
    const loser = r.winner === r.home ? r.away : r.home;
    return {
      title: `${r.winner.short} spring cup upset`,
      body: `${r.winner.name} knocked out ${loser.name} in the ${round.name}, keeping the cup draw unpredictable but traceable.`,
      type: 'cup',
      category: 'Cup',
      importance: 2,
    };
  }
  return {
    title: `${round.name} complete`,
    body: `${results.length} ties played. The ${round.short} field is now set for the next stage.`,
    type: 'cup',
    category: 'Cup',
    importance: 1,
  };
}

export function cupDrawStory({ cup, clubsById, userClub }) {
  const round = cup?.rounds?.[cup.roundIndex];
  if (!round || cup.status === 'complete') return null;
  const userTie = round.fixtures.find(f => f.home === userClub.id || f.away === userClub.id);
  if (userTie) {
    const home = clubsById[userTie.home];
    const away = clubsById[userTie.away];
    const opponent = home === userClub ? away : home;
    return {
      title: `${userClub.short} drawn ${home === userClub ? 'at home to' : 'away at'} ${opponent.short}`,
      body: `${userClub.name} will face ${opponent.name} in the ${round.name}. The tie is now listed on the season calendar.`,
      type: 'cup',
      category: 'Cup',
      importance: 2,
    };
  }
  return {
    title: `${round.name} draw confirmed`,
    body: `${round.fixtures.length} cup ties have been scheduled. ${userClub.name} are not involved in this round.`,
    type: 'cup',
    category: 'Cup',
    importance: 1,
  };
}

export function rivalTransferStory(activity) {
  return {
    title: `${activity.club.short} sign ${activity.player.name}`,
    body: `${activity.club.name} added ${activity.player.position} ${activity.player.name} for £${fmt(activity.fee)}. The move targets ${activity.needLabel.toLowerCase()} and lifts their squad depth.`,
    type: 'transfer',
    category: 'Transfers',
    importance: activity.club.division === activity.userDivision ? 2 : 1,
  };
}

export function clubsToWatchStory({ leader, chaser, pressureClub, userClub }) {
  if (!leader) return null;
  if (leader === userClub) {
    return {
      title: `${userClub.short} become the club to catch`,
      body: `${userClub.name} lead the division after the latest results. The rest of the league now has a clear target.`,
      type: 'league',
      category: 'League',
      importance: 2,
    };
  }
  if (pressureClub) {
    return {
      title: `${pressureClub.short} under pressure near the bottom`,
      body: `${pressureClub.name} are drifting into danger while ${leader.name} set the pace at the top.`,
      type: 'league',
      category: 'League',
      importance: 1,
    };
  }
  return {
    title: `${leader.short} set the standard`,
    body: `${leader.name} lead the division${chaser ? `, with ${chaser.name} keeping close watch` : ''}. ${userClub.name} need to keep pace with the early storylines.`,
    type: 'league',
    category: 'League',
    importance: 1,
  };
}

export function managerAppointmentStory(club, manager, cost) {
  return {
    title: `${club.short} appoint ${manager.name}`,
    body: `${manager.name} arrives as head coach on a ${manager.contractYears}-year deal. Compensation package: £${fmt(cost)}. Style: ${manager.style.replace('_', ' ')}.`,
    type: 'board',
    category: 'Manager',
    importance: 2,
  };
}

export function managerDirectiveStory(club, manager) {
  return {
    title: `${club.short} clarify manager brief`,
    body: `${club.name} have asked ${manager.name} to follow the chairman's updated direction: ${manager.directive.replace('_', ' ')}.`,
    type: 'board',
    category: 'Manager',
    importance: 1,
  };
}

function fmt(n) {
  return Math.round(n).toLocaleString('en-GB');
}

function article(text = '') {
  return /^[aeiou]/i.test(text) ? 'an' : 'a';
}

function ordinal(n) {
  return `${n}${ordinalSuffix(n)}`;
}

function ordinalSuffix(n) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}
