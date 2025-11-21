/**
 * Frontend deterministic battle simulator for the Raiku challenge.
 * This re-implements the same logic as the Node/TS engine, but uses Web Crypto
 * to compute SHA-256 of the battle log so it runs entirely in the browser.
 */

// ---------------------- Types (JSDoc style) ----------------------
/**
 * @typedef {Object} Character
 * @property {string} id
 * @property {string} name
 * @property {number} maxHp
 * @property {number} attack
 * @property {number} defense
 * @property {number} speed
 * @property {number} critChance
 * @property {number} skillMultiplier
 */

/**
 * @typedef {Object} FighterState
 * @property {string} id
 * @property {string} name
 * @property {number} hp
 * @property {number} maxHp
 * @property {boolean} alive
 */

/**
 * @typedef {Object} BattleEvent
 * @property {number} round
 * @property {"A" | "B"} actorTeam
 * @property {{id:string,name:string,hpBefore:number,hpAfter:number}} actor
 * @property {{id:string,name:string,hpBefore:number,hpAfter:number}} target
 * @property {number} damage
 * @property {boolean} isCrit
 * @property {string} description
 */

/**
 * @typedef {Object} BattleResult
 * @property {{seed:string,maxRounds:number}} config
 * @property {"A" | "B" | "DRAW"} winner
 * @property {number} rounds
 * @property {BattleEvent[]} log
 * @property {{teamA:FighterState[],teamB:FighterState[]}} finalState
 * @property {string} logHash
 */

// ---------------------- Deterministic RNG ----------------------

function xmur3(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function () {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

function mulberry32(a) {
  return function () {
    let t = (a += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function createDeterministicRng(seed) {
  const seedFn = xmur3(seed);
  const a = seedFn();
  const rand = mulberry32(a);
  return {
    next: () => rand(),
    nextInt: (maxExclusive) => {
      if (maxExclusive <= 0) return 0;
      return Math.floor(rand() * maxExclusive);
    },
  };
}

// ---------------------- Engine Logic ----------------------

/**
 * @returns {{teamA: Character[], teamB: Character[]}}
 */
function createDefaultTeams() {
  const teamA = [
    {
      id: "knight",
      name: "Aurora Knight",
      maxHp: 120,
      attack: 24,
      defense: 16,
      speed: 8,
      critChance: 0.15,
      skillMultiplier: 1.4,
    },
    {
      id: "archer",
      name: "Stellar Archer",
      maxHp: 80,
      attack: 28,
      defense: 10,
      speed: 14,
      critChance: 0.25,
      skillMultiplier: 1.5,
    },
  ];

  const teamB = [
    {
      id: "orc",
      name: "Raiku Orc Brute",
      maxHp: 140,
      attack: 22,
      defense: 14,
      speed: 7,
      critChance: 0.12,
      skillMultiplier: 1.3,
    },
    {
      id: "mage",
      name: "Deterministic Mage",
      maxHp: 70,
      attack: 30,
      defense: 8,
      speed: 12,
      critChance: 0.2,
      skillMultiplier: 1.6,
    },
  ];

  return { teamA, teamB };
}

/**
 * @param {Character[]} teamA
 * @param {Character[]} teamB
 */
function cloneTeams(teamA, teamB) {
  return {
    teamA: teamA.map((c) => ({ base: c, hp: c.maxHp, alive: true })),
    teamB: teamB.map((c) => ({ base: c, hp: c.maxHp, alive: true })),
  };
}

/**
 * @param {{base: Character, hp:number, alive:boolean}} f
 * @returns {FighterState}
 */
function snapshotFighter(f) {
  return {
    id: f.base.id,
    name: f.base.name,
    hp: f.hp,
    maxHp: f.base.maxHp,
    alive: f.alive,
  };
}

function allDead(team) {
  return team.every((f) => !f.alive);
}

function chooseTarget(rngInt, opponents) {
  const living = opponents.filter((o) => o.alive);
  if (living.length === 0) return null;
  const idx = rngInt(living.length);
  return living[idx];
}

function computeDamage(rngNext, attacker, defender) {
  const base = Math.max(1, attacker.base.attack - defender.base.defense * 0.5);
  const useSkill = rngNext() < 0.35;
  const critRoll = rngNext();
  const isCrit = critRoll < attacker.base.critChance;
  const skillMultiplier = useSkill ? attacker.base.skillMultiplier : 1.0;
  const variance = 0.9 + rngNext() * 0.2;

  let dmg = base * skillMultiplier * variance;
  if (isCrit) dmg *= 1.7;

  const final = Math.max(1, Math.floor(dmg));
  return { damage: final, isCrit };
}

/**
 * Browser-friendly SHA-256 using Web Crypto.
 * @param {BattleEvent[]} log
 * @returns {Promise<string>}
 */
async function computeLogHash(log) {
  const json = JSON.stringify(log);
  const enc = new TextEncoder().encode(json);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  const bytes = new Uint8Array(buf);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * @param {Character[]} teamA
 * @param {Character[]} teamB
 * @param {{seed:string,maxRounds:number}} config
 * @returns {Promise<BattleResult>}
 */
async function simulateBattle(teamA, teamB, config) {
  const rng = createDeterministicRng(config.seed);
  const teams = cloneTeams(teamA, teamB);
  /** @type {BattleEvent[]} */
  const log = [];

  let round = 0;
  while (round < config.maxRounds) {
    round++;

    /** @type {{fighter:any, team:"A"|"B"}[]} */
    const fighters = [];
    for (const f of teams.teamA) {
      if (f.alive) fighters.push({ fighter: f, team: "A" });
    }
    for (const f of teams.teamB) {
      if (f.alive) fighters.push({ fighter: f, team: "B" });
    }
    if (fighters.length === 0) break;

    fighters.sort((a, b) => {
      if (a.fighter.base.speed !== b.fighter.base.speed) {
        return b.fighter.base.speed - a.fighter.base.speed;
      }
      const rollA = rng.next();
      const rollB = rng.next();
      return rollB - rollA;
    });

    for (const { fighter, team } of fighters) {
      if (!fighter.alive) continue;
      const opponents = team === "A" ? teams.teamB : teams.teamA;
      if (allDead(opponents)) break;

      const target = chooseTarget(rng.nextInt, opponents);
      if (!target) continue;

      const beforeHp = target.hp;
      const { damage, isCrit } = computeDamage(rng.next, fighter, target);

      target.hp = Math.max(0, target.hp - damage);
      if (target.hp === 0) target.alive = false;

      /** @type {BattleEvent} */
      const event = {
        round,
        actorTeam: team,
        actor: {
          id: fighter.base.id,
          name: fighter.base.name,
          hpBefore: fighter.hp,
          hpAfter: fighter.hp,
        },
        target: {
          id: target.base.id,
          name: target.base.name,
          hpBefore: beforeHp,
          hpAfter: target.hp,
        },
        damage,
        isCrit,
        description: `${fighter.base.name} from Team ${team} hits ${target.base.name} for ${damage} damage${isCrit ? " (CRIT)" : ""}.`,
      };

      log.push(event);
    }

    const teamADead = allDead(teams.teamA);
    const teamBDead = allDead(teams.teamB);
    if (teamADead || teamBDead) break;
  }

  const teamADeadFinal = allDead(teams.teamA);
  const teamBDeadFinal = allDead(teams.teamB);
  let winner = "DRAW";
  if (teamADeadFinal && !teamBDeadFinal) winner = "B";
  else if (!teamADeadFinal && teamBDeadFinal) winner = "A";
  else {
    const hpA = teams.teamA.reduce((sum, f) => sum + f.hp, 0);
    const hpB = teams.teamB.reduce((sum, f) => sum + f.hp, 0);
    if (hpA > hpB) winner = "A";
    else if (hpB > hpA) winner = "B";
    else winner = "DRAW";
  }

  const finalState = {
    teamA: teams.teamA.map(snapshotFighter),
    teamB: teams.teamB.map(snapshotFighter),
  };

  const logHash = await computeLogHash(log);

  return {
    config,
    winner,
    rounds: round,
    log,
    finalState,
    logHash,
  };
}

// ---------------------- UI Wiring ----------------------

const seedInput = document.getElementById("seedInput");
const maxRoundsInput = document.getElementById("maxRoundsInput");
const maxRoundsLabel = document.getElementById("maxRoundsLabel");
const simulateBtn = document.getElementById("simulateBtn");
const simulateSpinner = document.getElementById("simulateSpinner");
const randomSeedBtn = document.getElementById("randomSeedBtn");

const hashOutput = document.getElementById("hashOutput");
const logContainer = document.getElementById("logContainer");
const winnerOutput = document.getElementById("winnerOutput");
const roundsOutput = document.getElementById("roundsOutput");
const winnerPill = document.getElementById("winnerPill");

const teamAStats = document.getElementById("teamAStats");
const teamBStats = document.getElementById("teamBStats");
const teamAHealth = document.getElementById("teamAHealth");
const teamBHealth = document.getElementById("teamBHealth");

const { teamA, teamB } = createDefaultTeams();

function renderTeamStats(container, team) {
  container.innerHTML = "";
  team.forEach((c) => {
    const el = document.createElement("div");
    el.className = "rounded-lg bg-slate-950/50 border border-slate-700/80 px-3 py-2";
    el.innerHTML = `
      <div class="flex items-center justify-between mb-1">
        <p class="text-[11px] font-semibold">${c.name}</p>
        <span class="text-[10px] text-slate-400">SPD ${c.speed}</span>
      </div>
      <div class="grid grid-cols-3 gap-2 text-[10px] text-slate-300">
        <div><span class="text-slate-400">HP</span> ${c.maxHp}</div>
        <div><span class="text-slate-400">ATK</span> ${c.attack}</div>
        <div><span class="text-slate-400">DEF</span> ${c.defense}</div>
        <div><span class="text-slate-400">Crit</span> ${(c.critChance * 100).toFixed(0)}%</div>
        <div><span class="text-slate-400">Skill</span> ×${c.skillMultiplier.toFixed(1)}</div>
      </div>
    `;
    container.appendChild(el);
  });
}

function renderHealth(container, fighters, accent) {
  container.innerHTML = "";
  fighters.forEach((f) => {
    const pct = Math.max(0, Math.min(100, Math.round((f.hp / f.maxHp) * 100)));
    const bar = document.createElement("div");
    bar.className = "space-y-1";
    bar.innerHTML = `
      <div class="flex items-center justify-between text-[10px] text-slate-300">
        <span>${f.name}</span>
        <span class="${pct === 0 ? "text-rose-300" : "text-slate-300"}">${f.hp} / ${f.maxHp}</span>
      </div>
      <div class="h-2 w-full rounded-full bg-slate-900/80 overflow-hidden border border-slate-700/80">
        <div class="hp-bar h-full ${accent} rounded-full" style="width: ${pct}%;"></div>
      </div>
    `;
    container.appendChild(bar);
  });
}

function setWinnerPillState(winner) {
  let text = "No battle yet";
  let color = "bg-slate-900/70 border-slate-700/80 text-slate-300";
  let dot = "bg-slate-500";

  if (winner === "A") {
    text = "Team A wins (canonical)";
    color = "bg-sky-500/15 border-sky-400/60 text-sky-100";
    dot = "bg-sky-400";
  } else if (winner === "B") {
    text = "Team B wins (canonical)";
    color = "bg-violet-500/15 border-violet-400/60 text-violet-100";
    dot = "bg-violet-400";
  } else if (winner === "DRAW") {
    text = "Draw (canonical)";
    color = "bg-amber-500/15 border-amber-400/60 text-amber-100";
    dot = "bg-amber-400";
  }

  winnerPill.className =
    "inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] " + color;
  winnerPill.innerHTML = `
    <span class="h-1.5 w-1.5 rounded-full ${dot}"></span>
    <span>${text}</span>
  `;
}

function renderLog(log) {
  if (!log.length) {
    logContainer.innerHTML =
      '<p class="text-slate-500/90">Run a simulation to view the deterministic battle trace.</p>';
    return;
  }
  const frag = document.createDocumentFragment();
  log.forEach((ev, idx) => {
    const row = document.createElement("div");
    row.className =
      "flex items-start gap-2 text-[11px] border-b border-slate-800/70 last:border-b-0 py-1.5";
    const badge =
      ev.actorTeam === "A"
        ? '<span class="inline-flex items-center justify-center rounded-full bg-sky-500/20 border border-sky-400/40 text-sky-100 h-4 w-4 text-[9px]">A</span>'
        : '<span class="inline-flex items-center justify-center rounded-full bg-violet-500/20 border border-violet-400/40 text-violet-100 h-4 w-4 text-[9px]">B</span>';
    row.innerHTML = `
      <div class="mt-0.5">${badge}</div>
      <div class="flex-1">
        <div class="flex items-center justify-between">
          <p class="text-slate-200">Round ${ev.round}</p>
          <span class="text-[10px] text-slate-500">#${idx + 1}</span>
        </div>
        <p class="text-slate-300 mt-0.5">${ev.description}</p>
        <p class="text-[10px] text-slate-500 mt-0.5">
          ${ev.target.name}: HP ${ev.target.hpBefore} → ${ev.target.hpAfter}
          ${ev.isCrit ? '<span class="ml-1 text-rose-300 font-semibold">CRIT</span>' : ""}
        </p>
      </div>
    `;
    frag.appendChild(row);
  });
  logContainer.innerHTML = "";
  logContainer.appendChild(frag);
  logContainer.scrollTop = 0;
}

function randomSeed() {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return (
    "RAIKU-" +
    Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase()
  );
}

maxRoundsInput.addEventListener("input", () => {
  maxRoundsLabel.textContent = String(maxRoundsInput.value);
});

randomSeedBtn.addEventListener("click", () => {
  seedInput.value = randomSeed();
});

simulateBtn.addEventListener("click", async () => {
  const seed = (seedInput.value || "RAIKU-DEMO-SEED-001").trim();
  const maxRounds = Number(maxRoundsInput.value) || 20;

  simulateBtn.disabled = true;
  simulateSpinner.classList.remove("hidden");
  hashOutput.textContent = "computing…";
  logContainer.innerHTML =
    '<p class="text-slate-400">Simulating deterministic battle for seed <span class="text-sky-300">' +
    seed +
    "</span>…</p>";

  try {
    const result = await simulateBattle(teamA, teamB, { seed, maxRounds });

    winnerOutput.textContent =
      result.winner === "A"
        ? "Team A · Aurora Squadron"
        : result.winner === "B"
        ? "Team B · Raiku Cohort"
        : "Draw";
    roundsOutput.textContent = String(result.rounds);
    setWinnerPillState(result.winner);

    renderHealth(
      teamAHealth,
      result.finalState.teamA,
      "bg-gradient-to-r from-sky-400 to-cyan-300"
    );
    renderHealth(
      teamBHealth,
      result.finalState.teamB,
      "bg-gradient-to-r from-violet-400 to-fuchsia-300"
    );
    renderLog(result.log);
    hashOutput.textContent = result.logHash;
  } catch (err) {
    console.error(err);
    logContainer.innerHTML =
      '<p class="text-rose-300">Simulation failed. See console for details.</p>';
    hashOutput.textContent = "error";
    winnerOutput.textContent = "–";
    roundsOutput.textContent = "–";
    setWinnerPillState(null);
  } finally {
    simulateBtn.disabled = false;
    simulateSpinner.classList.add("hidden");
  }
});

// Initial render
renderTeamStats(teamAStats, teamA);
renderTeamStats(teamBStats, teamB);
setWinnerPillState(null);