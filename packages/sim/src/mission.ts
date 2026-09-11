/** Recorded full battles against the real enemy policy, from unmodified content. */
import assert from "node:assert/strict";
import { content } from "../../content/src/index";
import {
  apply,
  createBattle,
  commandBonus,
  distance,
  nextEnemyCommand,
  type Command,
} from "../../core/src/index";
import beaconFixture from "../fixtures/beacon-clear.json";
import frontalFixture from "../fixtures/frontal-clear.json";

const reinforcementIds = new Set(
  content.scenario.reinforcement.units.map((unit) => unit.id),
);

function verifyRoute(
  name: "beacon" | "frontal",
  fixture: {
    commands: unknown;
    expectedOutcome: unknown;
  },
) {
  let state = createBattle(content);
  let spawnRound: number | null = null;
  let reinforcementAttacked = false;
  let flyingReinforcementAttacked = false;
  let adjacentRecovery = false;
  let commanderRangeChanged = false;
  let commanderRetreat = false;
  const reinforcementActors = new Set<string>();

  for (const command of fixture.commands as Command[]) {
    if (state.activeSide === "enemy")
      assert.deepEqual(
        command,
        nextEnemyCommand(content, state),
        `${name}: enemy policy drift; review and record a new valid clear.`,
      );
    const result = apply(content, state, command);
    assert.ok(result.ok, result.ok ? "" : `${name}: ${result.error}`);
    const next = result.nextState;

    if (
      state.mission.reinforcement !== "spawned" &&
      next.mission.reinforcement === "spawned"
    ) {
      spawnRound = state.round;
      for (const id of reinforcementIds)
        assert.ok(next.units.some((unit) => unit.id === id));
    }
    if (command.type === "act" && reinforcementIds.has(command.unitId)) {
      reinforcementActors.add(command.unitId);
      if (
        command.action.type === "attack" &&
        result.events.some(
          (event) =>
            event.type === "damaged" &&
            event.unitId !== command.unitId &&
            event.amount > 0,
        )
      ) {
        reinforcementAttacked = true;
        if (
          state.units.find((unit) => unit.id === command.unitId)?.moveType ===
          "flying"
        )
          flyingReinforcementAttacked = true;
      }
    }
    if (command.type === "endPhase" && next.activeSide === "player")
      for (const event of result.events) {
        if (event.type !== "healed") continue;
        const unit = next.units.find((unit) => unit.id === event.unitId);
        const leader = next.units.find(
          (leader) => leader.id === unit?.commanderId,
        );
        if (
          unit?.kind === "mercenary" &&
          leader &&
          distance(unit.pos, leader.pos) === 1
        )
          adjacentRecovery = true;
      }
    if (
      command.type === "act" &&
      command.path.length > 0 &&
      state.units.find((unit) => unit.id === command.unitId)?.kind ===
        "commander"
    )
      for (const unit of state.units.filter(
        (unit) => unit.side === "player" && unit.commanderId === command.unitId,
      )) {
        const after = next.units.find((candidate) => candidate.id === unit.id);
        if (
          after &&
          commandBonus(state, unit).active !== commandBonus(next, after).active
        )
          commanderRangeChanged = true;
      }
    if (
      result.events.some(
        (event) => event.type === "removed" && event.reason === "retreated",
      )
    )
      commanderRetreat = true;
    if (name === "frontal")
      assert.equal(
        next.mission.capturedRound,
        null,
        "Frontal route must never capture the beacon.",
      );
    state = next;
  }

  assert.equal(state.outcome?.status, "victory");
  assert.deepEqual(state.outcome, fixture.expectedOutcome);
  assert.equal(
    state.units.find((unit) => unit.id === content.scenario.mission!.escortId)
      ?.hp,
    10,
  );
  if (name === "beacon") {
    assert.equal(state.mission.capturedRound, 2);
    assert.equal(state.mission.reinforcement, "cancelled");
  } else {
    assert.equal(state.mission.reinforcement, "spawned");
    assert.equal(spawnRound, content.scenario.reinforcement.round);
    assert.deepEqual(reinforcementActors, reinforcementIds);
    assert.ok(reinforcementAttacked, "Reinforcements must actually fight.");
    assert.ok(
      flyingReinforcementAttacked,
      "A flying reinforcement must deal damage before the route clears.",
    );
    assert.ok(
      adjacentRecovery,
      "A wounded mercenary must recover next to their commander.",
    );
    assert.ok(
      commanderRangeChanged,
      "A commander move must change a follower's command bonus.",
    );
    assert.ok(
      commanderRetreat,
      "Defeating a commander must retreat their mercenaries.",
    );
  }
  assert.equal(
    state.units.filter((unit) => unit.side === "player").length,
    12,
    `${name}: all player units must survive this recorded strategy.`,
  );

  let replay = createBattle(content);
  for (const command of state.commands) {
    const result = apply(content, replay, command);
    assert.ok(result.ok);
    replay = result.nextState;
  }
  assert.deepEqual(replay, state);
  console.log(
    `${name} mission replay passed: ${state.commands.length} commands, round ${state.round}, ${state.outcome?.bonuses.join(" / ")}.`,
  );
}

verifyRoute("beacon", beaconFixture);
verifyRoute("frontal", frontalFixture);
console.log(
  "Two scripted routes verified; human playtests and balance review remain pending.",
);
