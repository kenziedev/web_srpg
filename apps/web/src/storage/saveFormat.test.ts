import { afterEach, describe, expect, it, vi } from "vitest";
import { content } from "@orden/content";
import {
  apply,
  createBattle,
  evaluate,
  spellTargetTiles,
  type BattleState,
  type Command,
} from "@orden/core";
import {
  checksumForSave,
  createSave,
  MAX_SAVE_BYTES,
  MAX_SAVE_COMMANDS,
  parseSave,
  serializeSave,
  validateSave,
  type BattleSave,
} from "./saveFormat";
import beaconClear from "../../../../packages/sim/fixtures/beacon-clear.json";

function actedState(): BattleState {
  const result = apply(content, createBattle(content), {
    type: "act",
    commandId: "manual-0",
    expectedRevision: 0,
    unitId: "A1",
    path: [],
    action: { type: "wait" },
  });
  if (!result.ok) throw new Error(result.error);
  return result.nextState;
}

let completedMission: BattleState | undefined;
/** Every reward in these saves comes from the production mission command log. */
function completedMissionState(): BattleState {
  if (!completedMission) {
    let state = createBattle(content);
    for (const command of beaconClear.commands as Command[]) {
      const result = apply(content, state, command);
      if (!result.ok) throw new Error(result.error);
      state = result.nextState;
    }
    if (state.outcome?.status !== "victory")
      throw new Error("승리 경로가 필요합니다.");
    completedMission = state;
  }
  return structuredClone(completedMission);
}

/** Valid checksum lets tests exercise semantic validation beyond corruption. */
function resign(save: BattleSave): BattleSave {
  const { checksum: _checksum, ...body } = save;
  return { ...body, checksum: checksumForSave(body) };
}

function editCommand(
  save: BattleSave,
  change: (command: Command) => void,
): BattleSave {
  change(save.commands[0]!);
  save.battle.commands = structuredClone(save.commands);
  save.lastCommandId = save.commands.at(-1)?.commandId ?? null;
  return resign(save);
}

afterEach(() => vi.useRealTimers());

describe("P04 battle save format and recovery", () => {
  it("round trips a confirmed action with the same revision and ordered commands", () => {
    const state = actedState();
    const save = createSave(state, { finishing: true, autoFollow: false });
    expect(parseSave(serializeSave(save))).toEqual(save);
    expect(save.battle).toEqual(state);
    expect(save.revision).toBe(1);
    expect(save.lastCommandId).toBe("manual-0");
    expect(save.continuation).toEqual({ finishing: true, autoFollow: false });
  });

  it.each(["attack-1", "teleport", "summon-salamander", "meteor"])(
    "round trips real preparation and %s effects with deterministic replay",
    (spellId) => {
      let state = createBattle(content);
      const train = apply(content, state, {
        type: "train",
        commandId: "train",
        expectedRevision: 0,
        unitId: "A3",
        spellIds: [spellId],
      });
      if (!train.ok) throw Error(train.error);
      state = train.nextState;
      const caster = state.units.find((unit) => unit.id === "A3")!;
      const spell = content.spells.find((spell) => spell.id === spellId)!;
      let after: BattleState | undefined;
      for (const target of spellTargetTiles(content, caster, spell)) {
        const result = apply(content, state, {
          type: "act",
          commandId: "cast",
          expectedRevision: state.revision,
          unitId: caster.id,
          path: [],
          action: {
            type: "cast",
            spellId,
            target,
            ...(spellId === "teleport" ? { destination: { x: 7, y: 4 } } : {}),
          },
        });
        if (!result.ok) continue;
        if (
          spellId === "meteor" &&
          !result.events.some((event) => event.type === "terrainChanged")
        )
          continue;
        after = result.nextState;
        break;
      }
      expect(after).toBeDefined();
      if (!after) return;
      const save = createSave(after);
      expect(parseSave(serializeSave(save)).battle).toEqual(after);
      const forged = structuredClone(save);
      forged.battle.rngSeed += 1;
      expect(() => validateSave(resign(forged))).toThrow("재현 결과");
    },
  );

  it("saves equipment totals and granted spells, rejecting forged equipment, inventory, and statuses", () => {
    const initial = createBattle(content);
    const result = apply(content, initial, {
      type: "equip",
      commandId: "equip",
      expectedRevision: 0,
      unitId: "A3",
      slot: "weapon",
      itemId: "orb",
    });
    if (!result.ok) throw Error(result.error);
    const save = createSave(result.nextState);
    expect(parseSave(serializeSave(save)).battle).toEqual(result.nextState);
    for (const change of [
      (state: BattleState) => {
        state.inventory.orb = 2;
      },
      (state: BattleState) => {
        state.terrainChanges["0,0"] = "plain";
      },
      (state: BattleState) => {
        state.statuses.push({
          unitId: "A3",
          sourceId: "A3",
          status: "quick",
          power: 3,
          expiresRound: 2,
          expiresSide: "player",
        });
      },
    ]) {
      const forged = structuredClone(save);
      change(forged.battle);
      expect(() => validateSave(resign(forged))).toThrow("재현 결과");
    }
  });

  it("gives identical saves for identical snapshots and time regardless of object key order", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-11T01:00:00.000Z"));
    const save = createSave(actedState());
    expect(createSave(actedState())).toEqual(save);
    const reordered = Object.fromEntries(Object.entries(save).reverse());
    expect(parseSave(JSON.stringify(reordered))).toEqual(save);
  });

  it("creates and validates detached snapshots without mutating live state or input", () => {
    const state = actedState();
    const expected = structuredClone(state);
    const continuation = { finishing: true, autoFollow: true };
    const save = createSave(state, continuation);
    const restored = validateSave(save);
    expect(state).toEqual(expected);
    state.units[0]!.hp = 1;
    state.commands[0]!.commandId = "live-mutation";
    continuation.autoFollow = false;
    expect(save.battle).toEqual(expected);
    expect(save.continuation.autoFollow).toBe(true);
    save.battle.units[0]!.hp = 2;
    save.commands[0]!.commandId = "input-mutation";
    expect(restored.battle).toEqual(expected);
    expect(restored.commands[0]!.commandId).toBe("manual-0");
  });

  it.each([
    ["schemaVersion", 99, "형식 버전"],
    ["rulesVersion", "old-rules", "규칙 버전"],
    ["contentHash", "00000000", "콘텐츠 버전"],
  ])("rejects incompatible %s", (key, value, message) => {
    const save = { ...createSave(createBattle(content)), [key]: value };
    expect(() => validateSave(save)).toThrow(message);
  });

  it("rejects corrupt JSON, checksum, and metadata before accepting a snapshot", () => {
    expect(() => parseSave("{broken json")).toThrow("JSON");
    const save = createSave(actedState());
    save.battle.units[0]!.hp = 2;
    expect(() => validateSave(save)).toThrow("체크섬");
    const changedTime = createSave(actedState());
    changedTime.updatedAt = "2020-01-01T00:00:00.000Z";
    expect(() => validateSave(changedTime)).toThrow("체크섬");
  });

  it("rejects a forged initial state and battle even with a recomputed checksum", () => {
    const initial = createSave(actedState());
    initial.initialState.units[0]!.stats.at += 100;
    expect(() => validateSave(resign(initial))).toThrow("초기 배치");
    const altered = createSave(actedState());
    altered.battle.units[0]!.hp = 3;
    expect(() => validateSave(resign(altered))).toThrow("재현 결과");
    const badReference = createSave(actedState());
    badReference.battle.units[0]!.commanderId = "unknown-commander";
    expect(() => validateSave(resign(badReference))).toThrow("재현 결과");
  });

  it("rejects nonexistent command units, targets, and impossible paths through core replay", () => {
    for (const change of [
      (command: Command) => {
        if (command.type === "act") command.unitId = "missing-unit";
      },
      (command: Command) => {
        if (command.type === "act")
          command.action = { type: "attack", targetId: "missing-target" };
      },
      (command: Command) => {
        if (command.type === "act") command.path = [{ x: 19, y: 14 }];
      },
    ]) {
      const invalid = editCommand(createSave(actedState()), change);
      expect(() => validateSave(invalid)).toThrow("명령을 재현할 수 없습니다");
    }
  });

  it("rejects repeated IDs, stale revisions, and mismatched envelope references", () => {
    const first = actedState();
    const result = apply(content, first, {
      type: "act",
      commandId: "manual-1",
      expectedRevision: 1,
      unitId: "A2",
      path: [],
      action: { type: "wait" },
    });
    if (!result.ok) throw new Error(result.error);
    const duplicated = createSave(result.nextState);
    duplicated.commands[1]!.commandId = duplicated.commands[0]!.commandId;
    duplicated.battle.commands = structuredClone(duplicated.commands);
    duplicated.lastCommandId = duplicated.commands[1]!.commandId;
    expect(() => validateSave(resign(duplicated))).toThrow("중복 명령");
    const stale = editCommand(createSave(first), (command) => {
      command.expectedRevision = 1;
    });
    expect(() => validateSave(stale)).toThrow("revision");
    const revision = createSave(first);
    revision.revision = 2;
    expect(() => validateSave(resign(revision))).toThrow("명령 개수");
    const last = createSave(first);
    last.lastCommandId = "unknown-command";
    expect(() => validateSave(resign(last))).toThrow("마지막 명령");
    const log = createSave(first);
    log.battle.commands = [];
    expect(() => validateSave(resign(log))).toThrow("명령 기록");
  });

  it("refuses unknown fields at every nested boundary instead of stripping them", () => {
    const paths = [
      [],
      ["battle"],
      ["battle", "units", 0],
      ["battle", "units", 0, "stats"],
      ["battle", "units", 0, "pos"],
      ["battle", "units", 0, "command"],
      ["battle", "mission"],
      ["commands", 0],
      ["commands", 0, "action"],
      ["continuation"],
    ];
    for (const path of paths) {
      const save = createSave(actedState());
      let object: unknown = save;
      for (const key of path)
        object = (object as Record<string | number, unknown>)[key];
      (object as Record<string, unknown>).unexpected = "corrupt";
      expect(() => validateSave(save)).toThrow("형식이 올바르지 않습니다");
    }
  });

  it("bounds file bytes, command counts, nesting, and unsupported JSON values", () => {
    expect(() => parseSave(" ".repeat(MAX_SAVE_BYTES + 1))).toThrow("2MiB");
    expect(() => parseSave(`"${"한".repeat(MAX_SAVE_BYTES / 2)}"`)).toThrow(
      "2MiB",
    );
    const save = createSave(actedState());
    save.commands = Array.from(
      { length: MAX_SAVE_COMMANDS + 1 },
      () => save.commands[0]!,
    );
    expect(() => validateSave(save)).toThrow("형식");
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => validateSave(cyclic)).toThrow("순환 참조");
    expect(() => validateSave({ unsupported: undefined })).toThrow("JSON");
    let nested: unknown = {};
    for (let i = 0; i < 40; i++) nested = { nested };
    expect(() => validateSave(nested)).toThrow("중첩");
  });

  it("preserves the pre-command save through previews and rejected commands", () => {
    const state = createBattle(content);
    const save = createSave(state);
    const command: Command = {
      type: "act",
      commandId: "preview",
      expectedRevision: 0,
      unitId: "A1",
      path: [],
      action: { type: "wait" },
    };
    expect(evaluate(content, state, command).ok).toBe(true);
    expect(apply(content, state, { ...command, unitId: "missing" }).ok).toBe(
      false,
    );
    expect(state).toEqual(save.battle);
    expect(validateSave(save)).toEqual(save);
  });

  it("allows pending player turn completion before the first command, but not during an enemy phase", () => {
    const initial = createBattle(content);
    expect(
      createSave(initial, { finishing: true, autoFollow: true }).revision,
    ).toBe(0);
    const enemy = apply(content, initial, {
      type: "endPhase",
      commandId: "end-0",
      expectedRevision: 0,
      side: "player",
    });
    if (!enemy.ok) throw new Error(enemy.error);
    expect(createSave(enemy.nextState).battle.activeSide).toBe("enemy");
    expect(() =>
      createSave(enemy.nextState, { finishing: true, autoFollow: true }),
    ).toThrow("페이즈");
  });

  it("recovers a completed mission with all commands, outcome, and bonuses intact", () => {
    let state = createBattle(content);
    for (const command of beaconClear.commands as Command[]) {
      const result = apply(content, state, command);
      if (!result.ok) throw new Error(result.error);
      state = result.nextState;
    }
    expect(state.outcome?.status).toBe("victory");
    const text = serializeSave(createSave(state));
    const recovered = parseSave(text);
    expect(recovered.battle).toEqual(state);
    expect(recovered.battle.outcome).toEqual(beaconClear.expectedOutcome);
    expect(recovered.commands).toHaveLength(beaconClear.commands.length);
    expect(new TextEncoder().encode(text).byteLength).toBeLessThan(
      MAX_SAVE_BYTES,
    );
    expect(() =>
      createSave(state, { finishing: true, autoFollow: true }),
    ).toThrow("페이즈");
  });
});

describe("S04/S05 growth save integrity and deployment replay", () => {
  it("round trips the real victory settlement while keeping the battle and continuing roster distinct", () => {
    const state = completedMissionState();
    const initial = createBattle(content);
    const settlement = state.progression.settlement!;
    expect(settlement).toMatchObject({
      scenarioId: content.scenario.id,
      outcome: "victory",
      duplicate: false,
    });
    expect(settlement.entries).toHaveLength(3);
    for (const entry of settlement.entries) {
      const veteran = state.progression.roster.find(
        (unit) => unit.id === entry.unitId,
      )!;
      const deployed = state.units.find((unit) => unit.id === entry.unitId)!;
      expect(entry.awardedExp).toBeGreaterThanOrEqual(180);
      expect(entry.level).toBeGreaterThan(entry.previousLevel);
      expect(veteran.progression).toMatchObject({
        level: entry.level,
        exp: entry.exp,
        totalExp: entry.awardedExp,
      });
      expect(deployed.progression).toEqual(
        initial.units.find((unit) => unit.id === entry.unitId)!.progression,
      );
    }
    const save = createSave(state);
    const before = structuredClone(save);
    const restored = parseSave(serializeSave(save));
    expect(restored.battle.progression).toEqual(state.progression);
    expect(restored.battle.units).toEqual(state.units);
    expect(restored.initialState).toEqual(initial);
    expect(validateSave(restored)).toEqual(restored);
    expect(validateSave(restored)).toEqual(restored);
    expect(save).toEqual(before);
  });

  it.each([
    [
      "roster level",
      (state: BattleState) => {
        state.progression.roster[0]!.progression!.level = 9;
      },
    ],
    [
      "roster EXP",
      (state: BattleState) => {
        state.progression.roster[0]!.progression!.exp =
          (state.progression.roster[0]!.progression!.exp + 1) % 100;
      },
    ],
    [
      "lifetime EXP",
      (state: BattleState) => {
        state.progression.roster[0]!.progression!.totalExp += 100;
      },
    ],
    [
      "combat contribution",
      (state: BattleState) => {
        state.progression.contributions.A1!.damage += 2;
      },
    ],
    [
      "settlement award",
      (state: BattleState) => {
        state.progression.settlement!.entries[0]!.awardedExp += 1;
      },
    ],
    [
      "settlement breakdown",
      (state: BattleState) => {
        state.progression.settlement!.entries[0]!.earned.clear += 1;
      },
    ],
    [
      "settlement growth",
      (state: BattleState) => {
        state.progression.settlement!.entries[0]!.statGains.at = 10;
      },
    ],
    [
      "settlement duplicate flag",
      (state: BattleState) => {
        state.progression.settlement!.duplicate = true;
      },
    ],
    [
      "missing settlement",
      (state: BattleState) => {
        state.progression.settlement = null;
      },
    ],
    [
      "cleared reward ledger",
      (state: BattleState) => {
        state.progression.rewardedScenarioIds = [];
      },
    ],
    [
      "additional reward entry",
      (state: BattleState) => {
        state.progression.rewardedScenarioIds.push("unplayed-scenario");
      },
    ],
  ] satisfies [string, (state: BattleState) => void][])(
    "rejects forged %s through replay even after its checksum is recomputed",
    (_name, alter) => {
      const save = createSave(completedMissionState());
      alter(save.battle);
      const forged = resign(save);
      const { checksum, ...body } = forged;
      expect(checksumForSave(body)).toBe(checksum);
      expect(() => validateSave(forged)).toThrow("명령 재현 결과");
    },
  );

  it("rejects forged initial growth and an appended promotion command that the real rewards did not unlock", () => {
    const save = createSave(completedMissionState());
    const initial = structuredClone(save);
    initial.initialState.progression.roster[0]!.progression!.level = 10;
    expect(() => validateSave(resign(initial))).toThrow("초기 배치");
    const forged = structuredClone(save);
    const promotion: Command = {
      type: "promote",
      commandId: "forged-promote",
      expectedRevision: forged.revision,
      unitId: "A1",
      classId: "frontline-captain",
    };
    forged.commands.push(promotion);
    forged.battle.commands = structuredClone(forged.commands);
    forged.revision += 1;
    forged.battle.revision = forged.revision;
    forged.lastCommandId = promotion.commandId;
    const profile = forged.battle.progression.roster.find(
      (unit) => unit.id === "A1",
    )!.progression!;
    profile.classId = "frontline-captain";
    profile.classHistory.push("frontline-captain");
    profile.level = 1;
    profile.exp = 0;
    expect(() => validateSave(resign(forged))).toThrow(
      "저장 명령을 재현할 수 없습니다",
    );
  });

  it("replays victory, deployment, and a resumed action without resetting reward ownership or awarding growth twice", () => {
    const won = completedMissionState();
    const afterVictory = parseSave(serializeSave(createSave(won))).battle;
    const deploy: Command = {
      type: "deploy",
      commandId: "growth-deploy",
      expectedRevision: afterVictory.revision,
    };
    const result = apply(content, afterVictory, deploy);
    if (!result.ok) throw new Error(result.error);
    const state = result.nextState;
    expect(state.outcome).toBeNull();
    expect(state.progression.settlement).toBeNull();
    expect(state.progression.battleStartRevision).toBe(state.revision);
    expect(state.progression.rewardedScenarioIds).toEqual([
      content.scenario.id,
    ]);
    expect(state.progression.contributions).toEqual({});
    expect(state.inventory).toEqual(won.inventory);
    for (const veteran of won.progression.roster) {
      const fresh = state.units.find((unit) => unit.id === veteran.id)!;
      expect(fresh.progression).toEqual(veteran.progression);
      expect(fresh.stats).toEqual(veteran.stats);
      expect(fresh).toMatchObject({ hp: 10, acted: false, side: "player" });
    }
    const deployedSave = parseSave(serializeSave(createSave(state)));
    expect(deployedSave.initialState).toEqual(createBattle(content));
    expect(deployedSave.commands).toHaveLength(beaconClear.commands.length + 1);
    expect(deployedSave.battle).toEqual(state);
    expect(apply(content, deployedSave.battle, deploy).ok).toBe(false);
    const continued = apply(content, deployedSave.battle, {
      type: "act",
      commandId: "growth-resumed-wait",
      expectedRevision: deployedSave.revision,
      unitId: "A1",
      path: [],
      action: { type: "wait" },
    });
    if (!continued.ok) throw new Error(continued.error);
    const resumedSave = parseSave(
      serializeSave(createSave(continued.nextState)),
    );
    expect(resumedSave.battle).toEqual(continued.nextState);
    expect(resumedSave.battle.progression.rewardedScenarioIds).toEqual(
      won.progression.rewardedScenarioIds,
    );
    expect(
      resumedSave.battle.progression.roster.map((unit) => unit.progression),
    ).toEqual(won.progression.roster.map((unit) => unit.progression));
    for (const change of [
      (battle: BattleState) => {
        battle.progression.rewardedScenarioIds = [];
      },
      (battle: BattleState) => {
        battle.progression.battleStartRevision = 0;
      },
    ]) {
      const forged = structuredClone(resumedSave);
      change(forged.battle);
      expect(() => validateSave(resign(forged))).toThrow("명령 재현 결과");
    }
  });
});
