import type Phaser from "phaser";
import type { Unit } from "@orden/core";

const soldier = [
  "....hhhh....",
  "...hllllh...",
  "...hssssh...",
  "....soso....",
  "....ssss..w.",
  "...haaaah.w.",
  "..haaaaah.w.",
  "..hhaaash.w.",
  "..hhhhaah.w.",
  "..hllhaah.w.",
  "...hhadd..w.",
  "....d.dd....",
  "...dd..dd...",
];
const rider = [
  "......hhhh......",
  ".....hllllh.....",
  ".....hssssh.....",
  "......soss..w...",
  "......aaaa..w...",
  ".....haaaah.w...",
  "....hhhaass.w...",
  ".dd.ddaaaa.dww..",
  "dssdwwwwwwddd...",
  "dssdwwwwwwdddd..",
  "..ddwwwwwwdddd..",
  "....dddddddd....",
  "....dd..d..dd...",
  "...dd...d...dd..",
];

function figure(
  g: Phaser.GameObjects.Graphics,
  pattern: string[],
  x: number,
  y: number,
  scale: number,
  uniform: number,
  flip: boolean,
  faded: boolean,
) {
  const palette: Record<string, number> = {
    h: 0x506c89,
    l: 0xd7dec9,
    s: 0xedbd8e,
    o: 0x202a46,
    a: uniform,
    d: 0x4f3932,
    w: 0xc4a472,
  };
  pattern.forEach((row, py) =>
    [...row].forEach((ink, px) => {
      if (ink === ".") return;
      g.fillStyle(palette[ink]!, faded ? 0.68 : 1).fillRect(
        x + (flip ? row.length - 1 - px : px) * scale,
        y + py * scale,
        scale,
        scale,
      );
    }),
  );
}

export function drawUnit(
  g: Phaser.GameObjects.Graphics,
  unit: Unit,
  x: number,
  y: number,
) {
  const uniform = unit.side === "enemy" ? 0xa64e49 : 0x416b9d;
  const flip = unit.side === "enemy";
  g.fillStyle(0x203921, 0.3).fillEllipse(x + 24, y + 38, 34, 9);
  if (unit.kind === "escort") {
    g.fillStyle(0x664638).fillRect(x + 8, y + 13, 31, 23);
    g.fillStyle(0xd4c69c)
      .fillRect(x + 7, y + 11, 33, 13)
      .fillRect(x + 11, y + 7, 25, 7);
    g.fillStyle(0x3c3028)
      .fillRect(x + 11, y + 33, 7, 8)
      .fillRect(x + 31, y + 33, 7, 8);
    return;
  }
  if (unit.moveType === "flying") {
    g.fillStyle(0x52637a).fillRect(x + 1, y + 11, 45, 12);
    g.fillStyle(0xdedcc1)
      .fillRect(x + 1, y + 8, 10, 9)
      .fillRect(x + 36, y + 8, 10, 9);
    g.fillStyle(0xb5c0b6)
      .fillRect(x + 5, y + 17, 10, 7)
      .fillRect(x + 32, y + 17, 10, 7);
  }
  const mounted = unit.unitType === "cavalry" || unit.moveType === "mounted";
  if (unit.kind === "commander") {
    figure(
      g,
      mounted ? rider : soldier,
      x + (mounted ? 7 : 10),
      y + 6,
      2,
      uniform,
      flip,
      unit.acted,
    );
    g.fillStyle(0xe1d69c).fillRect(x + 4, y + 2, 2, 21);
    g.fillStyle(uniform).fillRect(x + 6, y + 3, 12, 8);
    g.fillStyle(0xffe9a4).fillRect(x + 6, y + 3, 12, 2);
  } else {
    for (const [dx, dy] of mounted
      ? [
          [0, 0],
          [15, 14],
        ]
      : [
          [12, 0],
          [1, 13],
          [24, 13],
        ]) {
      figure(
        g,
        mounted ? rider : soldier,
        x + dx!,
        y + dy!,
        2,
        uniform,
        flip,
        unit.acted,
      );
      if (unit.unitType === "pike")
        g.fillStyle(0xe4ddae).fillRect(x + dx! + 21, y + dy! - 5, 2, 27);
      if (unit.unitType === "archer")
        g.lineStyle(1, 0x57342d).strokeEllipse(
          x + dx! + 20,
          y + dy! + 12,
          7,
          21,
        );
    }
  }
}
