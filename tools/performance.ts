import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { cpus, platform, arch, release } from "node:os";
import { performance } from "node:perf_hooks";
import { execFileSync } from "node:child_process";
import { content } from "../packages/content/src/index";
import { contentSchema } from "../packages/schema/src/index";
import {
  apply,
  createBattle,
  enemyPhysicalThreat,
  evaluate,
  inAttackRange,
  nextEnemyCommand,
  reachable,
  type BattleState,
  type Content,
  type Unit,
} from "../packages/core/src/index";

const WIDTH = 24;
const HEIGHT = 18;
const VARIANTS = 30;
const SELECT_SAMPLES = 200;

/** Controlled physical-combat workload, not a campaign map or browser benchmark. */
function fixture(variant: number): { world: Content; state: BattleState } {
  const world = structuredClone(content);
  const units: Unit[] = [];
  for (const side of ["player", "enemy"] as const) {
    const prefix = side === "player" ? "P" : "E";
    for (let group = 0; group < 5; group++)
      for (let member = 0; member < 4; member++) {
        const ranged = member === 3;
        units.push({
          id: `${prefix}${group}-${member}`,
          name: `${prefix}${group}-${member}`,
          side,
          kind: member === 0 ? "commander" : "mercenary",
          commanderId: member === 0 ? null : `${prefix}${group}-0`,
          unitType: ranged ? "archer" : member === 2 ? "pike" : "infantry",
          moveType: "foot",
          pos: {
            x: side === "player" ? 5 + member : 14 - member,
            y: 1 + group * 3 + (variant % 3),
          },
          hp: 10,
          mp: 0,
          acted: false,
          spellIds: [],
          range: ranged ? [2, 3] : [1, 1],
          stats: {
            at: side === "player" ? 7 : 10,
            df: side === "player" ? 10 : 14,
            mag: 0,
            res: 4,
            maxMp: 0,
            move: 4,
          },
          command: member === 0 ? { radius: 3, at: 2, df: 2 } : null,
        });
      }
  }
  for (let index = 0; index < 2; index++)
    units.push({
      ...structuredClone(units[0]!),
      id: `N${index}`,
      name: `Escort ${index}`,
      side: "npc",
      kind: "escort",
      commanderId: null,
      command: null,
      pos: { x: index === 0 ? 0 : WIDTH - 1, y: HEIGHT - 1 },
    });
  world.scenario.width = WIDTH;
  world.scenario.height = HEIGHT;
  world.scenario.tiles = Array.from({ length: WIDTH * HEIGHT }, (_, index) =>
    (index * 7 + variant * 11) % 19 === 0
      ? "forest"
      : (index + variant) % 23 === 0
        ? "hill"
        : "plain",
  );
  world.scenario.units = units;
  world.scenario.enemyPlans = [];
  delete world.scenario.preparation;
  world.scenario.reinforcement.units = [];
  world.scenario.reinforcement.reserves = {};
  world.scenario.mission = {
    ...world.scenario.mission!,
    protectedIds: ["N0"],
    escortId: "N0",
    unitLimit: 42,
    route: Array.from({ length: WIDTH }, (_, x) => ({ x, y: HEIGHT - 1 })),
    beacon: { x: 0, y: 0 },
  };
  const checked = contentSchema.parse(world);
  const state = createBattle(checked);
  state.mission.reinforcement = "cancelled";
  return { world: checked, state };
}

function stats(samples: number[], budgetMs: number) {
  const sorted = [...samples].sort((a, b) => a - b);
  const percentile = (value: number) =>
    sorted[Math.ceil(sorted.length * value) - 1]!;
  const round = (value: number) => Math.round(value * 1000) / 1000;
  return {
    samples: samples.length,
    meanMs: round(
      samples.reduce((sum, value) => sum + value, 0) / samples.length,
    ),
    medianMs: round(percentile(0.5)),
    p95Ms: round(percentile(0.95)),
    maxMs: round(sorted.at(-1)!),
    budgetMs,
    passed: percentile(0.95) <= budgetMs,
  };
}

const positions = Array.from({ length: VARIANTS }, (_, index) =>
  fixture(index),
);
let attacks = 0;
function select(variant: number, sample: number) {
  const { world, state } = positions[variant]!;
  const actor = state.units[sample % 20]!;
  const tiles = reachable(world, state, actor);
  const enemies = state.units.filter((unit) => unit.side === "enemy");
  const attack = tiles.flatMap((tile) =>
    enemies
      .filter((enemy) =>
        inAttackRange({ ...actor, pos: tile.pos }, enemy, world, state),
      )
      .map((enemy) => ({ tile, enemy })),
  )[0];
  const path = attack?.tile.path ?? tiles.at(-1)!.path;
  const result = evaluate(world, state, {
    type: "act",
    unitId: actor.id,
    commandId: "performance-preview",
    expectedRevision: 0,
    path,
    action: attack
      ? { type: "attack", targetId: attack.enemy.id }
      : { type: "wait" },
  });
  if (!result.ok) throw new Error(`Preview failed: ${result.error}`);
  return !!attack;
}

function enemyPhase(variant: number) {
  const { world, state: initial } = positions[variant]!;
  let state = structuredClone(initial);
  state.activeSide = "enemy";
  let actions = 0;
  while (state.activeSide === "enemy" && !state.outcome) {
    const command = nextEnemyCommand(world, state);
    if (!command) throw new Error("Enemy phase stopped without a command");
    const result = apply(world, state, command);
    if (!result.ok) throw new Error(`Enemy command failed: ${result.error}`);
    if (command.type === "act") actions++;
    state = result.nextState;
    if (actions > 20) throw new Error("Enemy phase exceeded the actor count");
  }
  if (actions !== 20)
    throw new Error(`Expected 20 enemy actions, observed ${actions}`);
}

for (let index = 0; index < 20; index++) select(index % VARIANTS, index);
enemyPhase(0);
const selectionMs: number[] = [];
for (let index = 0; index < SELECT_SAMPLES; index++) {
  const started = performance.now();
  if (select(index % VARIANTS, index)) attacks++;
  selectionMs.push(performance.now() - started);
}
const enemyMs: number[] = [];
const threatMs: number[] = [];
for (let index = 0; index < VARIANTS; index++) {
  let started = performance.now();
  enemyPhase(index);
  enemyMs.push(performance.now() - started);
  const { world, state } = positions[index]!;
  started = performance.now();
  enemyPhysicalThreat(world, state);
  threatMs.push(performance.now() - started);
}

const report = {
  generatedAt: new Date().toISOString(),
  environment: {
    node: process.version,
    platform: platform(),
    arch: arch(),
    osRelease: release(),
    cpu: cpus()[0]?.model,
  },
  source: {
    head: execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim(),
    dirty:
      execFileSync("git", ["status", "--porcelain"], {
        encoding: "utf8",
      }).trim().length > 0,
    rulesVersion: content.rulesVersion,
  },
  workload: {
    width: WIDTH,
    height: HEIGHT,
    units: 42,
    players: 20,
    enemies: 20,
    npc: 2,
    variants: VARIANTS,
    fixturesValidated: true,
    selectionAttackSamples: attacks,
    selectionWaitSamples: SELECT_SAMPLES - attacks,
    enemyActionsPerPhase: 20,
    warmup: { selection: 20, enemyPhases: 1 },
    percentile: "nearest-rank",
    exclusions: [
      "browser rendering",
      "animations",
      "IndexedDB and save validation",
      "spell AI",
      "equipment and mastery variations",
    ],
  },
  selection: stats(selectionMs, 50),
  enemyPhase: stats(enemyMs, 500),
  threat: stats(threatMs, 50),
  rawMs: {
    selection: selectionMs.map((value) => Math.round(value * 1000) / 1000),
    enemyPhase: enemyMs.map((value) => Math.round(value * 1000) / 1000),
    threat: threatMs.map((value) => Math.round(value * 1000) / 1000),
  },
};
const output = resolve(process.argv[2] ?? "artifacts/performance-core.json");
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
console.log(
  JSON.stringify(
    {
      output,
      selection: report.selection,
      enemyPhase: report.enemyPhase,
      threat: report.threat,
    },
    null,
    2,
  ),
);
if (
  !report.selection.passed ||
  !report.enemyPhase.passed ||
  !report.threat.passed
)
  process.exitCode = 1;
