import { createDefaultTeams, simulateBattle } from "./battleEngine.js";
import type { BattleConfig } from "./types.js";

// Read seed from args or use default
const args = process.argv.slice(2);
const seedArg = args[0] || "RAIKU-DEMO-SEED-001";
const maxRoundsArg = args[1] ? Number(args[1]) : 20;

const config: BattleConfig = {
  seed: seedArg,
  maxRounds: Number.isFinite(maxRoundsArg) && maxRoundsArg > 0 ? maxRoundsArg : 20,
};

const { teamA, teamB } = createDefaultTeams();
const result = simulateBattle(teamA, teamB, config);

console.log("=== Raiku Deterministic Battle Simulator ===");
console.log("Config:", config);
console.log("Winner:", result.winner);
console.log("Rounds:", result.rounds);
console.log("");
console.log("Final State:");
console.log("Team A:", result.finalState.teamA);
console.log("Team B:", result.finalState.teamB);
console.log("");
console.log("Battle Log Hash (SHA-256 of JSON.stringify(log)):");
console.log(result.logHash);
console.log("");
console.log("Battle Log:");
for (const event of result.log) {
  console.log(
    `Round ${event.round} | Team ${event.actorTeam} | ${event.description} ` +
      `(HP ${event.target.hpBefore} -> ${event.target.hpAfter})`
  );
}

console.log("");
console.log("Note:");
console.log(
  "Run this script again with the SAME seed and maxRounds, and you will get the EXACT same battle log and the same logHash."
);
console.log(
  "Change the seed (e.g. `npm run simulate -- NEW-SEED`) and observe a different, but still deterministic, battle and corresponding hash."
);