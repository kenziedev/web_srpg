import { describe, expect, it } from "vitest";
import { contentSchema, type Content, type EnemyPlan } from "@orden/schema";
import { content } from "./index";

const planOf = (value: Content): EnemyPlan => value.scenario.enemyPlans![0]!;

function rejectionAfter(mutate: (value: Content) => void, message?: string) {
  const value = structuredClone(content);
  mutate(value);
  const result = contentSchema.safeParse(value);
  expect(result.success).toBe(false);
  if (message && !result.success)
    expect(
      result.error.issues.some((issue) => issue.message.includes(message)),
    ).toBe(true);
}

describe("P03a scenario enemy plans", () => {
  it("loads the guard squad's scheduled north and south objectives", () => {
    expect(content.scenario.enemyPlans).toEqual([
      {
        commanderId: "E2",
        stages: [
          { fromRound: 1, label: "북쪽 여울 견제", target: { x: 11, y: 3 } },
          { fromRound: 3, label: "남쪽 호송로 압박", target: { x: 11, y: 10 } },
        ],
      },
    ]);
  });

  it("preserves the shape of legacy content without an enemyPlans field", () => {
    const legacy = structuredClone(content);
    delete legacy.scenario.enemyPlans;
    const parsed = contentSchema.parse(legacy);
    expect(Object.hasOwn(parsed.scenario, "enemyPlans")).toBe(false);
    expect(parsed).toEqual(legacy);
  });

  it("accepts an empty plan list and a known reinforcement commander", () => {
    const value = structuredClone(content);
    value.scenario.enemyPlans = [];
    expect(contentSchema.safeParse(value).success).toBe(true);
    value.scenario.enemyPlans = [
      {
        commanderId: "E3",
        stages: [
          { fromRound: 1, label: "강 건너 지원", target: { x: 11, y: 3 } },
        ],
      },
    ];
    expect(contentSchema.safeParse(value).success).toBe(true);
  });

  it.each(["missing", "A1", "E21", "N1", "E31"])(
    "rejects a plan whose owner %s is not a known enemy commander",
    (commanderId) => {
      rejectionAfter((value) => {
        planOf(value).commanderId = commanderId;
      }, "지휘관 참조 오류");
    },
  );

  it("rejects duplicate plans for a commander", () => {
    rejectionAfter((value) => {
      value.scenario.enemyPlans!.push(structuredClone(planOf(value)));
    }, "지휘관 중복");
  });

  it("requires a nonempty stage list", () => {
    rejectionAfter((value) => {
      planOf(value).stages = [];
    });
  });

  it.each([0, -1, 1.5])(
    "rejects nonpositive or fractional start round %s",
    (round) => {
      rejectionAfter((value) => {
        planOf(value).stages[0]!.fromRound = round;
      });
    },
  );

  it.each(["late-first", "equal", "descending", "after-limit"])(
    "rejects invalid stage schedule %s",
    (schedule) => {
      rejectionAfter((value) => {
        const stages = planOf(value).stages;
        if (schedule === "late-first") stages[0]!.fromRound = 2;
        if (schedule === "equal") stages[1]!.fromRound = 1;
        if (schedule === "descending")
          stages.push({ ...stages[0]!, fromRound: 2 });
        if (schedule === "after-limit")
          stages[1]!.fromRound = value.scenario.mission!.maxRounds + 1;
      }, "시간 오류");
    },
  );

  it("accepts a stage at the round limit and an unbounded schedule without a mission", () => {
    const value = structuredClone(content);
    planOf(value).stages[1]!.fromRound = value.scenario.mission!.maxRounds;
    expect(contentSchema.safeParse(value).success).toBe(true);
    delete value.scenario.mission;
    planOf(value).stages[1]!.fromRound = 100;
    expect(contentSchema.safeParse(value).success).toBe(true);
  });

  it.each(["", "   ", "x".repeat(81)])(
    "rejects an empty or excessive stage label (%s)",
    (label) => {
      rejectionAfter((value) => {
        planOf(value).stages[0]!.label = label;
      });
    },
  );

  it.each(["right", "bottom", "negative", "fractional"])(
    "rejects an invalid target at the %s map boundary",
    (boundary) => {
      rejectionAfter((value) => {
        const target = planOf(value).stages[0]!.target;
        if (boundary === "right") target.x = value.scenario.width;
        if (boundary === "bottom") target.y = value.scenario.height;
        if (boundary === "negative") target.x = -1;
        if (boundary === "fractional") target.y = 1.5;
      });
    },
  );

  it.each(["water", "wall"])(
    "rejects a foot squad target on %s",
    (terrainId) => {
      rejectionAfter((value) => {
        const target = planOf(value).stages[0]!.target;
        value.scenario.tiles[target.y * value.scenario.width + target.x] =
          terrainId;
      }, "목표 좌표 오류");
    },
  );

  it("rejects a target impassable for one follower even if its commander can enter", () => {
    rejectionAfter((value) => {
      const target = planOf(value).stages[0]!.target;
      value.scenario.tiles[target.y * value.scenario.width + target.x] =
        "mountain";
      value.scenario.units.find((unit) => unit.id === "E23")!.moveType =
        "mounted";
    }, "목표 좌표 오류");
  });

  it("rejects a flying squad target on a no-landing tile", () => {
    rejectionAfter((value) => {
      planOf(value).commanderId = "E3";
      const target = planOf(value).stages[0]!.target;
      value.scenario.tiles[target.y * value.scenario.width + target.x] = "wall";
    }, "목표 좌표 오류");
  });
});
