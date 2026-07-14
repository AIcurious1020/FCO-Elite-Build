// js/player.js
// Player model + helpers. Attributes are 1–99. Form (0.85–1.15) and morale
// (0.85–1.15) are visible multipliers so the sim stays transparent.

export class Player {
  constructor({
    id, name, position, age,
    attack, defense, passing, finish,
    wage, value, form = 1.0, morale = 1.0, potential = null,
    injuryWeeks = 0, injury = null
  }) {
    this.id = id;
    this.name = name;
    this.position = position;       // 'GK' | 'DEF' | 'MID' | 'FWD'
    this.age = age;
    this.attack = attack;
    this.defense = defense;
    this.passing = passing;
    this.finish = finish;
    this.wage = wage;               // per week (£)
    this.value = value ?? Player.estimateValue({ attack, defense, passing, finish, age });
    this.form = form;               // 0.85–1.15
    this.morale = morale;           // 0.85–1.15
    this.potential = potential ?? Math.min(99, Player.overallOf({ attack, defense, passing, finish, position }) + 6);
    this.injuryWeeks = injuryWeeks;
    this.injury = injury;
    this.appearances = 0;
    this.goals = 0;
  }

  get available() {
    return !this.injuryWeeks || this.injuryWeeks <= 0;
  }

  // Position-weighted overall rating (0–99) — the single number shown in the UI.
  static overallOf({ attack, defense, passing, finish, position }) {
    const w = Player.weights(position);
    return Math.round(attack * w.att + defense * w.def + passing * w.pas + finish * w.fin);
  }

  get overall() {
    return Player.overallOf(this);
  }

  // Attribute weighting per position — makes each role value the right skills.
  static weights(position) {
    switch (position) {
      case 'GK':  return { att: 0.05, def: 0.70, pas: 0.15, fin: 0.10 };
      case 'DEF': return { att: 0.10, def: 0.55, pas: 0.25, fin: 0.10 };
      case 'MID': return { att: 0.25, def: 0.20, pas: 0.40, fin: 0.15 };
      case 'FWD': return { att: 0.30, def: 0.05, pas: 0.20, fin: 0.45 };
      default:    return { att: 0.25, def: 0.25, pas: 0.25, fin: 0.25 };
    }
  }

  // Transparent value formula: overall^3 scaled, with a youth premium.
  static estimateValue({ attack, defense, passing, finish, age, position = 'MID' }) {
    const ovr = Player.overallOf({ attack, defense, passing, finish, position });
    const base = Math.pow(ovr / 10, 3) * 900; // ovr 70 -> ~£309k
    const ageFactor = age <= 21 ? 1.6 : age <= 25 ? 1.3 : age <= 29 ? 1.0 : age <= 32 ? 0.65 : 0.35;
    return Math.round((base * ageFactor) / 1000) * 1000;
  }

  refreshValue() {
    this.value = Player.estimateValue(this);
    return this.value;
  }
}
