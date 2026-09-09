import { expect, it } from "vitest";
import { contentSchema } from "@orden/schema";
import { content } from "./index";

it("loads the documented map with 21 initial and 3 reinforcement units", () => {
  expect(content.scenario.units).toHaveLength(21);
  expect(content.scenario.reinforcement.units).toHaveLength(3);
  expect(content.scenario.tiles).toHaveLength(300);
});
it.each(["position", "commander", "terrain"])(
  "rejects invalid %s references",
  (mutation) => {
    const broken = structuredClone(content);
    if (mutation === "position") broken.scenario.units[0]!.pos.x = 20;
    if (mutation === "commander")
      broken.scenario.units.find((u) => u.kind === "mercenary")!.commanderId =
        "missing";
    if (mutation === "terrain") broken.scenario.tiles[0] = "missing";
    expect(contentSchema.safeParse(broken).success).toBe(false);
  },
);
it.each(["escort", "route", "deadline", "reserve", "protected", "capacity"])(
  "rejects invalid mission %s data",
  (mutation) => {
    const broken = structuredClone(content);
    const m = broken.scenario.mission!;
    if (mutation === "escort") m.escortId = "missing";
    if (mutation === "route") m.route[1] = { x: 5, y: 5 };
    if (mutation === "deadline") m.bonusDeadline = 11;
    if (mutation === "reserve")
      broken.scenario.reinforcement.reserves.E3 = [{ x: 20, y: 0 }];
    if (mutation === "protected") m.protectedIds = ["missing"];
    if (mutation === "capacity") m.unitLimit = 20;
    expect(contentSchema.safeParse(broken).success).toBe(false);
  },
);
