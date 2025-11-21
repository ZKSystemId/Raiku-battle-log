import crypto from "node:crypto";
import {
  BattleConfig,
  BattleEvent,
  BattleResult,
  Character,
  CharacterSnapshot,
  FighterState,
} from "./types.js";
import { createDeterministicRng } from "./seedRng.js";

interface InternalFighter {
  base: Character;
  hp: number;
  alive: boolean;
}

interface BattleTeams {
  teamA: InternalFighter[];
  teamB: InternalFighter[];
}

export function createDefaultTeams(): { teamA: Character[]; teamB: Character[] } {
  const teamA: Character[] = [
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

  const teamB: Character[] = [
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
      critChance: 0.20,
      skillMultiplier: 1.6,
    },
  ];

  return { teamA, teamB };
}

function cloneTeams(teamA: Character[], teamB: Character[]): BattleTeams {
  return {
    teamA: teamA.map((c) => ({ base: c, hp: c.maxHp, alive: true })),
    teamB: teamB.map((c) => ({ base: c, hp: c.maxHp, alive: true })),
  };
}

function snapshotFighter(f: InternalFighter): FighterState {
  return {
    id: f.base.id,
    name: f.base.name,
    hp: f.hp,
    maxHp: f.base.maxHp,
    alive: f.alive,
  };
}

function chooseTarget(
  rngInt: (maxExclusive: number) => number,
  opponents: InternalFighter[]
): InternalFighter | null {
  const living = opponents.filter((o) => o.alive);
  if (living.length === 0) return null;
  const idx = rngInt(living.length);
  return living[idx];
}

function computeDamage(
  rngNext: () => number,
  attacker: InternalFighter,
  defender: InternalFighter
): { damage: number; isCrit: boolean } {
  const base = Math.max(1, attacker.base.attack - defender.base.defense * 0.5);
  const useSkill = rngNext() < 0.35; // 35% chance to use skill
  const critRoll = rngNext();
  const isCrit = critRoll < attacker.base.critChance;
  const skillMultiplier = useSkill ? attacker.base.skillMultiplier : 1.0;
  const variance = 0.9 + rngNext() * 0.2; // 0.9 - 1.1

  let dmg = base * skillMultiplier * variance;
  if (isCrit) {
    dmg *= 1.7;
  }

  const final = Math.max(1, Math.floor(dmg));
  return { damage: final, isCrit };
}

function allDead(team: InternalFighter[]): boolean {
  return team.every((f) => !f.alive);
}

/**
 * Compute a stable SHA-256 hash of the battle log.
 * We serialize the log using JSON.stringify with a consistent object shape,
 * so the same battle will always produce the same hash.
 */
function computeLogHash(log: BattleEvent[]): string {
  const json = JSON.stringify(log);
  const hash = crypto.createHash("sha256").update(json, "utf8").digest("hex");
  return hash;
}

export function simulateBattle(
  teamA: Character[],
  teamB: Character[],
  config: BattleConfig
): BattleResult {
  const rng = createDeterministicRng(config.seed);
  const teams = cloneTeams(teamA, teamB);
  const log: BattleEvent[] = [];

  let round = 0;
  while (round < config.maxRounds) {
    round++;

    // Determine turn order: all living fighters from both teams, sorted by speed desc
    const fighters: { fighter: InternalFighter; team: "A" | "B" }[] = [];
    for (const f of teams.teamA) {
      if (f.alive) fighters.push({ fighter: f, team: "A" });
    }
    for (const f of teams.teamB) {
      if (f.alive) fighters.push({ fighter: f, team: "B" });
    }

    if (fighters.length === 0) {
      break;
    }

    fighters.sort((a, b) => {
      if (a.fighter.base.speed !== b.fighter.base.speed) {
        return b.fighter.base.speed - a.fighter.base.speed;
      }
      // Tie-breaker using deterministic RNG but stable for this round
      const rollA = rng.next();
      const rollB = rng.next();
      return rollB - rollA;
    });

    for (const { fighter, team } of fighters) {
      if (!fighter.alive) continue;
      const opponents = team === "A" ? teams.teamB : teams.teamA;
      if (allDead(opponents)) {
        break;
      }

      const target = chooseTarget(rng.nextInt, opponents);
      if (!target) continue;

      const beforeHp = target.hp;
      const { damage, isCrit } = computeDamage(rng.next, fighter, target);

      target.hp = Math.max(0, target.hp - damage);
      if (target.hp === 0) {
        target.alive = false;
      }

      const event: BattleEvent = {
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
    if (teamADead || teamBDead) {
      break;
    }
  }

  const teamADeadFinal = allDead(teams.teamA);
  const teamBDeadFinal = allDead(teams.teamB);
  let winner: "A" | "B" | "DRAW" = "DRAW";
  if (teamADeadFinal && !teamBDeadFinal) {
    winner = "B";
  } else if (!teamADeadFinal && teamBDeadFinal) {
    winner = "A";
  } else {
    // If both alive, choose winner by total HP remaining
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

  const logHash = computeLogHash(log);

  return {
    config,
    winner,
    rounds: round,
    log,
    finalState,
    logHash,
  };
}