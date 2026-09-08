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
