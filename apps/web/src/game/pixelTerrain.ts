import type Phaser from "phaser";
import { terrainAt, type Content, type BattleState } from "@orden/core";

type TerrainFrame = readonly [column: number, row: number];

// Original sheet coordinates are zero based. Direction bits: N=1, E=2, S=4, W=8.
const ROAD_FRAMES: Readonly<Record<number, TerrainFrame>> = {
  0: [1, 10],
  1: [0, 11],
  2: [1, 10],
  3: [0, 12],
  4: [0, 11],
  5: [0, 11],
  6: [0, 10],
  7: [0, 9],
  8: [1, 10],
  9: [2, 12],
  10: [1, 10],
  11: [2, 9],
  12: [2, 10],
  13: [1, 9],
  14: [3, 9],
  15: [1, 11],
};
const RIVER_FRAMES: Readonly<Record<number, TerrainFrame>> = {
  0: [1, 14],
  1: [0, 14],
  2: [1, 13],
  3: [0, 15],
  4: [0, 14],
  5: [0, 14],
  6: [0, 13],
  7: [4, 14],
  8: [1, 13],
  9: [2, 15],
  10: [1, 13],
  11: [4, 13],
  12: [2, 13],
  13: [3, 14],
  14: [3, 13],
  15: [1, 14],
};

/** Paint Toen's native 16px tiles at an exact 3× scale into a map-sized canvas. */
export function drawAssetTerrain(
  context: CanvasRenderingContext2D,
  source: CanvasImageSource,
  content: Content,
  state?: BattleState,
): void {
  const scenario = content.scenario;
  const tile = (x: number, y: number) =>
    x < 0 || y < 0 || x >= scenario.width || y >= scenario.height
      ? ""
      : (terrainAt(content, { x, y }, state)?.id ?? "");
  const isRiver = (id: string) =>
    id === "water" || id === "shallow" || id === "bridge";
  const isRoad = (id: string) =>
    id === "road" || id === "bridge" || id === "village";
  const connections = (
    x: number,
    y: number,
    matches: (id: string) => boolean,
  ) =>
    (matches(tile(x, y - 1)) ? 1 : 0) |
    (matches(tile(x + 1, y)) ? 2 : 0) |
    (matches(tile(x, y + 1)) ? 4 : 0) |
    (matches(tile(x - 1, y)) ? 8 : 0);

  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.imageSmoothingEnabled = false;
  context.clearRect(0, 0, scenario.width * 48, scenario.height * 48);
  for (let y = 0; y < scenario.height; y++) {
    for (let x = 0; x < scenario.width; x++) {
      const id = tile(x, y);
      const seed = (x * 71 + y * 137) % 97;
      const draw = (frame: TerrainFrame) =>
        context.drawImage(
          source,
          frame[0] * 16,
          frame[1] * 16,
          16,
          16,
          x * 48,
          y * 48,
          48,
          48,
        );
      const fragment = (
        frame: TerrainFrame,
        sx: number,
        sy: number,
        width: number,
        height: number,
        dx: number,
        dy: number,
      ) =>
        context.drawImage(
          source,
          frame[0] * 16 + sx,
          frame[1] * 16 + sy,
          width,
          height,
          x * 48 + dx * 3,
          y * 48 + dy * 3,
          width * 3,
          height * 3,
        );

      // The matching plain/tufted pair shares a palette, avoiding checkerboard fields.
      draw([seed % 5 < 2 ? 2 : 0, 0]);
      if (isRiver(id)) {
        draw(RIVER_FRAMES[connections(x, y, isRiver)] ?? [0, 14]);
        if (id === "shallow") {
          // Small pieces of the original rock tile make the ford readable without
          // suggesting a road or changing the core's movement rules.
          fragment([0, 34], 1, 8, 7, 5, 5, 6);
          fragment([0, 34], 3, 9, 4, 3, 10, 9);
        } else if (id === "bridge") {
          const roadMask = connections(x, y, isRoad);
          const vertical = (roadMask & 5) !== 0 && (roadMask & 10) === 0;
          // The source's masonry crossings include their own parapets and water.
          draw(vertical ? [5, 34] : [4, 34]);
        }
      } else if (id === "road") {
        draw(ROAD_FRAMES[connections(x, y, isRoad)] ?? [1, 10]);
      } else if (id === "forest") {
        const forestMask = connections(
          x,
          y,
          (neighbor) => neighbor === "forest",
        );
        const dense = forestMask === 15 || [7, 11, 13, 14].includes(forestMask);
        draw([dense ? 6 : 4 + (seed % 2), 0]);
      } else if (id === "hill" || id === "mountain") {
        const ridge = connections(
          x,
          y,
          (neighbor) => neighbor === "hill" || neighbor === "mountain",
        );
        draw([ridge === 15 || id === "mountain" ? 5 : 3 + (seed % 2), 1]);
      } else if (id === "village") {
        const beacon =
          scenario.mission?.beacon.x === x && scenario.mission.beacon.y === y;
        if (beacon) {
          draw([3, 3]);
          fragment([1, 33], 8, 3, 5, 5, 8, 0);
        } else {
          draw([2, 2]);
        }
      }
    }
  }
  context.restore();
}

/** Original 24px terrain art, painted once at a crisp 2× scale. */
export function drawTerrain(
  g: Phaser.GameObjects.Graphics,
  content: Content,
  state?: BattleState,
) {
  const s = content.scenario;
  const tile = (x: number, y: number) =>
    x < 0 || y < 0 || x >= s.width || y >= s.height
      ? ""
      : (terrainAt(content, { x, y }, state)?.id ?? "");
  for (let y = 0; y < s.height; y++)
    for (let x = 0; x < s.width; x++) {
      const id = tile(x, y);
      const rect = (a: number, b: number, w: number, h: number, c: number) =>
        g.fillStyle(c).fillRect(x * 48 + a * 2, y * 48 + b * 2, w * 2, h * 2);
      const seed = (x * 71 + y * 137) % 97;
      const water = id === "water" || id === "shallow";
      const base = water
        ? id === "shallow"
          ? 0x5598a0
          : 0x32697f
        : id === "forest"
          ? 0x486547
          : 0x879761;
      rect(0, 0, 24, 24, base);
      // Sparse grass tufts and broken soil give texture without a visible tile checkerboard.
      for (let n = 0; n < 8; n++) {
        const a = (seed + n * 13) % 23,
          b = (seed * 3 + n * 7) % 23;
        rect(
          a,
          b,
          1 + (n % 2),
          1,
          water ? 0x407e90 : n % 3 ? 0x7b8d55 : 0x9aa96d,
        );
        if (!water && n % 3 === 0) rect(a, b - 1, 1, 1, 0x637e4d);
      }
      if (water) {
        for (let n = 0; n < 3; n++) {
          const a = (seed + n * 7) % 17,
            b = (seed + n * 9) % 23;
          rect(a, b, 5, 1, 0x6097a1);
          rect(a + 2, b + 1, 5, 1, 0x3c788d);
        }
        if (id === "shallow")
          for (let n = 0; n < 6; n++)
            rect((n * 7 + seed) % 22, (n * 5 + 3) % 22, 2, 1, 0xa6b7a0);
        if (!["water", "shallow", "bridge"].includes(tile(x - 1, y) ?? "")) {
          rect(0, 0, 2, 24, 0xc0b88b);
          rect(2, 0, 1, 24, 0x6c9692);
          for (let n = 0; n < 5; n++) rect(0, n * 5, 3, 2, 0x8ca172);
        }
        if (!["water", "shallow", "bridge"].includes(tile(x + 1, y) ?? "")) {
          rect(22, 0, 2, 24, 0xc0b88b);
          rect(21, 0, 1, 24, 0x6c9692);
          for (let n = 0; n < 5; n++) rect(22, n * 5 + 2, 2, 2, 0x8ca172);
        }
      }
      if (id === "road") {
        rect(0, 3, 24, 18, 0xb4a17a);
        rect(0, 5, 24, 14, 0xc4b58b);
        rect(0, 7, 24, 1, 0x9e906c);
        rect(0, 16, 24, 1, 0xa59570);
        for (let n = 0; n < 7; n++) {
          const a = (seed + n * 7) % 23,
            b = 4 + ((n * 3) % 16);
          rect(a, b, 2, 1, n % 2 ? 0xd3c39b : 0xb3a17d);
        }
        for (let n = 0; n < 4; n++) {
          rect(n * 7, 2 + (n % 2), 3, 2, 0x9aa26a);
          rect(n * 6 + 2, 20, 2, 2, 0x859360);
        }
      }
      if (id === "bridge") {
        rect(0, 0, 24, 24, 0x366d82);
        rect(0, 5, 24, 15, 0x6b5445);
        for (let n = 0; n < 8; n++) {
          rect(n * 3, 5, 2, 15, 0xb39b70);
          rect(n * 3, 6, 1, 13, 0xc8b789);
        }
        rect(0, 3, 24, 2, 0xe1cca0);
        rect(0, 19, 24, 2, 0x4d4438);
        rect(0, 18, 24, 1, 0xd3b989);
        for (let n = 0; n < 4; n++) {
          rect(n * 7, 1, 2, 6, 0x69503b);
          rect(n * 7, 1, 1, 4, 0xc5b18a);
          rect(n * 7, 18, 2, 5, 0x6c503a);
        }
      }
      if (id === "hill") {
        rect(2, 14, 21, 7, 0x667c50);
        rect(4, 10, 17, 7, 0x768954);
        rect(7, 7, 12, 6, 0x98a26b);
        rect(10, 5, 6, 3, 0xb1b184);
        rect(3, 19, 19, 2, 0x506d48);
        rect(5, 16, 4, 2, 0x9aa574);
        rect(9, 12, 9, 1, 0xc0bd8f);
        rect(7, 18, 2, 2, 0x8c9467);
        rect(18, 15, 3, 2, 0x515f49);
        rect(19, 14, 2, 1, 0xc8bd92);
      }
      if (id === "forest") {
        const tree = (a: number, b: number) => {
          rect(a + 4, b + 13, 7, 3, 0x354d39);
          rect(a + 6, b + 9, 2, 8, 0x5b4c38);
          rect(a + 6, b + 9, 1, 7, 0x9e8355);
          rect(a + 1, b + 5, 11, 7, 0x294a38);
          rect(a + 3, b + 2, 8, 11, 0x345a3b);
          rect(a + 5, b, 4, 13, 0x466d40);
          rect(a, b + 6, 12, 3, 0x375c3a);
          rect(a + 2, b + 3, 7, 4, 0x587b47);
          rect(a + 5, b + 1, 3, 3, 0x789454);
          rect(a + 1, b + 7, 4, 2, 0x6c884d);
          rect(a + 7, b + 5, 3, 2, 0x6b894b);
          rect(a + 3, b + 10, 5, 2, 0x476b3f);
        };
        tree(0, 0);
        tree(11, 1);
        tree(5, 8);
      }
      if (id === "village") {
        const beacon = s.mission?.beacon.x === x && s.mission.beacon.y === y;
        rect(3, 19, 19, 4, 0x5b624b);
        rect(4, 20, 17, 1, 0xc1b389);
        if (beacon) {
          rect(8, 7, 9, 14, 0x8c927b);
          rect(9, 7, 4, 13, 0xc0bea0);
          rect(8, 6, 10, 2, 0xd5d0ac);
          for (let n = 0; n < 3; n++) {
            rect(8 + n * 4, 3, 2, 4, 0xa9ac90);
            rect(8 + n * 4, 3, 2, 1, 0xe1d9b8);
          }
          rect(11, 15, 3, 6, 0x454d42);
          rect(10, 10, 5, 1, 0x7a826d);
          rect(15, 12, 2, 1, 0x5e6c5d);
          rect(11, 4, 4, 2, 0x754536);
          rect(12, 2, 2, 3, 0xe5a74f);
          rect(13, 1, 1, 3, 0xffe0a2);
        } else {
          rect(5, 11, 15, 10, 0xd3c39a);
          rect(6, 12, 2, 8, 0x947b5b);
          rect(18, 12, 2, 8, 0x9f8865);
          rect(3, 10, 19, 3, 0x653e36);
          rect(5, 7, 15, 3, 0x995340);
          rect(8, 4, 9, 3, 0xb66a49);
          rect(8, 4, 9, 1, 0xd69868);
          rect(6, 8, 13, 1, 0xc18256);
          rect(11, 15, 4, 6, 0x504839);
          rect(7, 14, 2, 3, 0x547b7d);
          rect(16, 14, 2, 3, 0x547b7d);
          rect(11, 14, 4, 1, 0xeee0b4);
          rect(19, 15, 3, 3, 0xe4d8b5);
          rect(20, 14, 1, 5, 0xa64d3e);
          rect(19, 16, 3, 1, 0xa64d3e);
        }
      }
    }
}
