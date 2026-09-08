import { useEffect, useRef } from "react";
import Phaser from "phaser";
import { content } from "@orden/content";
import {
  commandBonus,
  distance,
  type BattleState,
  type Position,
  type ReachableTile,
} from "@orden/core";

import { drawUnit } from "./pixelUnits";

const TILE = 48;
interface MapProps {
  state: BattleState;
  selectedId: string;
  destination: Position | null;
  reachable: ReachableTile[];
  showCommand: boolean;
  onTile: (position: Position) => void;
}
const color = (hex: string) => Number.parseInt(hex.slice(1), 16);

/** Rendering only: every rule query comes from core; pointer input returns tile coordinates. */
export function BattleMap(props: MapProps) {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  const sceneRef = useRef<BattleScene | null>(null);
  latest.current = props;
  useEffect(() => {
    if (!host.current) return;
    const scene = new BattleScene(() => latest.current);
    sceneRef.current = scene;
    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: host.current,
      backgroundColor: "#263d35",
      pixelArt: true,
      antialias: false,
      scale: {
        mode: Phaser.Scale.RESIZE,
        width: host.current.clientWidth,
        height: host.current.clientHeight,
      },
      scene,
      audio: { noAudio: true },
      banner: false,
    });
    return () => {
      sceneRef.current = null;
      game.destroy(true);
    };
  }, []);
  useEffect(() => {
    if (sceneRef.current?.sys.isActive()) sceneRef.current.paint();
  }, [
    props.state,
    props.selectedId,
    props.destination,
    props.reachable,
    props.showCommand,
  ]);
  return (
    <div
      ref={host}
      className="map-canvas"
      role="img"
      aria-label="두 개의 건널목 전술 지도. 오른쪽 부대 목록에서도 유닛을 선택할 수 있습니다."
    />
  );
}

class BattleScene extends Phaser.Scene {
  private art!: Phaser.GameObjects.Graphics;
  private labels: Phaser.GameObjects.Text[] = [];
  private drag: { x: number; y: number; sx: number; sy: number } | null = null;
  constructor(private read: () => MapProps) {
    super("battle");
  }
  create() {
    this.art = this.add.graphics();
    this.cameras.main.setBounds(
      0,
      0,
      content.scenario.width * TILE,
      content.scenario.height * TILE,
    );
    this.cameras.main.centerOn(10 * TILE, 8 * TILE);
    this.game.events.once(Phaser.Core.Events.POST_RENDER, () => {
      this.game.canvas.dataset.ready = "true";
    });
    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      if (this.game.canvas.dataset.ready !== "true") return;
      this.drag = {
        x: p.x,
        y: p.y,
        sx: this.cameras.main.scrollX,
        sy: this.cameras.main.scrollY,
      };
    });
    this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
      if (!p.isDown || !this.drag) return;
      this.cameras.main.setScroll(
        Math.round(this.drag.sx + this.drag.x - p.x),
        Math.round(this.drag.sy + this.drag.y - p.y),
      );
    });
    this.input.on("pointerup", (p: Phaser.Input.Pointer) => {
      if (this.drag && Math.hypot(p.x - this.drag.x, p.y - this.drag.y) < 6) {
        const point = this.cameras.main.getWorldPoint(p.x, p.y);
        this.read().onTile({
          x: Math.floor(point.x / TILE),
          y: Math.floor(point.y / TILE),
        });
      }
      this.drag = null;
    });
    this.input.on(
      "wheel",
      (_p: unknown, _objects: unknown, dx: number, dy: number) => {
        this.cameras.main.setScroll(
          this.cameras.main.scrollX + dx,
          this.cameras.main.scrollY + dy,
        );
      },
    );
    this.paint();
  }
  private label(
    x: number,
    y: number,
    text: string,
    fill = "#fff8df",
    size = 11,
  ) {
    this.labels.push(
      this.add
        .text(x, y, text, {
          fontFamily: "sans-serif",
          fontSize: size,
          stroke: "#11182e",
          strokeThickness: 2,
          color: fill,
          backgroundColor: "#10204490",
          padding: { x: 3, y: 1 },
        })
        .setDepth(3),
    );
  }
  paint() {
    if (!this.art) return;
    const { state, selectedId, destination, reachable, showCommand } =
      this.read();
    const selected = state.units.find((u) => u.id === selectedId);
    const leader =
      selected?.kind === "commander"
        ? selected
        : state.units.find((u) => u.id === selected?.commanderId);
    this.art.clear();
    this.labels.forEach((text) => text.destroy());
    this.labels = [];
    const s = content.scenario;
    for (let y = 0; y < s.height; y++)
      for (let x = 0; x < s.width; x++) {
        const t = content.terrains.find(
          (t) => t.id === s.tiles[y * s.width + x],
        )!;
        const px = x * TILE,
          py = y * TILE;
        this.art.fillStyle(color(t.color)).fillRect(px, py, TILE, TILE);
        this.art.lineStyle(1, 0x122d27, 0.05).strokeRect(px, py, TILE, TILE);
        // Deterministic, code-drawn placeholder pixel art. No random or external assets.
        if (t.id === "forest") {
          this.art.fillStyle(0x263f32).fillRect(px + 21, py + 20, 6, 20);
          this.art
            .fillStyle(0x254a35)
            .fillRect(px + 8, py + 17, 32, 15)
            .fillRect(px + 14, py + 9, 22, 20);
          this.art.fillStyle(0x527849).fillRect(px + 16, py + 11, 10, 6);
        } else if (t.water) {
          this.art
            .fillStyle(0x8bc0b8, 0.35)
            .fillRect(px + 5, py + 12, 16, 2)
            .fillRect(px + 25, py + 32, 16, 2);
        } else if (t.id === "bridge") {
          this.art
            .fillStyle(0x514536)
            .fillRect(px, py + 5, TILE, 4)
            .fillRect(px, py + 39, TILE, 4);
          this.art.lineStyle(2, 0x665039);
          for (let i = 8; i < TILE; i += 8)
            this.art.lineBetween(px + i, py + 9, px + i, py + 39);
        } else if (t.id === "hill") {
          this.art
            .fillStyle(0xb0ae73)
            .fillRect(px + 8, py + 25, 28, 4)
            .fillRect(px + 14, py + 19, 16, 4);
        } else if (t.id === "village") {
          this.art.fillStyle(0xd9c5a0).fillRect(px + 13, py + 20, 24, 21);
          this.art
            .fillStyle(0x725943)
            .fillRect(px + 9, py + 16, 32, 7)
            .fillRect(px + 17, py + 11, 16, 6);
        } else if (t.id === "plain" && (x + y) % 3 === 0) {
          this.art
            .fillStyle(0x94a66c, 0.45)
            .fillRect(px + 8, py + 32, 4, 4)
            .fillRect(px + 33, py + 11, 2, 6);
        }
        if (
          showCommand &&
          leader?.command &&
          distance({ x, y }, leader.pos) <= leader.command.radius
        )
          this.art
            .lineStyle(2, 0xedcc81, 0.45)
            .strokeRect(px + 2, py + 2, TILE - 4, TILE - 4);
        if (reachable.some((r) => r.pos.x === x && r.pos.y === y))
          this.art
            .fillStyle(0x345fde, 0.28)
            .fillRect(px + 3, py + 3, TILE - 6, TILE - 6);
      }
    for (const marker of s.markers)
      this.label(
        marker.pos.x * TILE,
        marker.pos.y * TILE - 16,
        marker.label,
        "#f8df9f",
        11,
      );
    for (const unit of state.units) {
      const x = unit.pos.x * TILE,
        y = unit.pos.y * TILE;
      drawUnit(this.art, unit, x, y);
      this.label(x + 33, y + 31, `${unit.hp}`, "#fff8df", 13);
      if (unit.acted) this.label(x + 2, y + 30, "✓");
      if (unit.kind === "mercenary" && !commandBonus(state, unit).active)
        this.label(x + 1, y - 4, "! 범위 밖", "#efb296", 9);
      if (unit.id === selectedId)
        this.art
          .lineStyle(3, 0xffe5a3)
          .strokeRect(x + 2, y + 2, TILE - 4, TILE - 4);
    }
    if (destination) {
      this.art
        .lineStyle(3, 0xf8e4aa)
        .strokeRect(
          destination.x * TILE + 6,
          destination.y * TILE + 6,
          TILE - 12,
          TILE - 12,
        );
      this.label(
        destination.x * TILE,
        destination.y * TILE + TILE,
        "이동 예정",
      );
    }
  }
}
