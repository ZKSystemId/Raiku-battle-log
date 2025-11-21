export interface Character {
  id: string;
  name: string;
  maxHp: number;
  attack: number;
  defense: number;
  speed: number;
  critChance: number; // 0 - 1
  skillMultiplier: number;
}

export interface BattleConfig {
  seed: string;
  maxRounds: number;
}

export interface BattleEvent {
  round: number;
  actorTeam: "A" | "B";
  actor: CharacterSnapshot;
  target: CharacterSnapshot;
  damage: number;
  isCrit: boolean;
  description: string;
}

export interface CharacterSnapshot {
  id: string;
  name: string;
  hpBefore: number;
  hpAfter: number;
}

export interface BattleResult {
  config: BattleConfig;
  winner: "A" | "B" | "DRAW";
  rounds: number;
  log: BattleEvent[];
  finalState: {
    teamA: FighterState[];
    teamB: FighterState[];
  };
  /**
   * SHA-256 hash (hex) of the battle log array, computed from JSON.stringify(log).
   * This can be stored on-chain or in Raiku-coordinated execution as a compact
   * commitment to the full battle trace.
   */
  logHash: string;
}

export interface FighterState {
  id: string;
  name: string;
  hp: number;
  maxHp: number;
  alive: boolean;
}