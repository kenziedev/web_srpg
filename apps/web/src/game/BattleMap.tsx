import type { BattleAnimation } from "./BattleAnimation";
import { playBattleAnimation } from "./playBattleAnimation";
import { useEffect, useRef } from "react";
import Phaser from "phaser";
import { content } from "@orden/content";
import {
  commandBonus,
  distance,
  escortForecast,
  type BattleState,
  type Position,
  type ReachableTile,
} from "@orden/core";

import { drawTerrain } from "./pixelTerrain";
import { drawUnit } from "./pixelUnits";

const TILE = 48;
interface MapProps {
  state: BattleState;
  animation: BattleAnimation | null;
  selectedId: string;
  destination: Position | null;
  reachable: ReachableTile[];
  showCommand: boolean;
  onTile: (position: Position) => void;
}

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
    props.animation,
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
  private playing: BattleAnimation | null = null;
  private lastState: BattleState | null = null;
  private stopAnimation: (() => void) | null = null;
  private art!: Phaser.GameObjects.Graphics;
  private labels: Phaser.GameObjects.Text[] = [];
  private drag: { x: number; y: number; sx: number; sy: number } | null = null;
  constructor(private read: () => MapProps) {
    super("battle");
  }
  create() {
    const terrain = this.add.graphics();
    drawTerrain(terrain, content);
    terrain.generateTexture(
      "battle-terrain",
      content.scenario.width * TILE,
      content.scenario.height * TILE,
    );
    terrain.destroy();
    this.add.image(0, 0, "battle-terrain").setOrigin(0);
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
    this.events.once("shutdown", () => this.stopAnimation?.());
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
    const {
      state,
      selectedId,
      destination,
      reachable,
      showCommand,
      animation,
    } = this.read();
    if (this.playing !== animation) {
      this.stopAnimation?.();
      this.playing = animation;
      this.stopAnimation = animation
        ? playBattleAnimation(this, animation)
        : null;
    }
    if (state.revision === 0 && state !== this.lastState)
      this.cameras.main.centerOn(10 * TILE, 8 * TILE);
    this.lastState = state;
    const animatedId =
      animation?.command.type === "act"
        ? animation.command.unitId
        : animation?.events.find((e) => e.type === "moved")?.unitId;
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
        const px = x * TILE,
          py = y * TILE;
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
            .fillStyle(0x4968ce, 0.18)
            .fillRect(px + 3, py + 3, TILE - 6, TILE - 6);
      }
    for (const marker of s.markers)
      this.label(
        Math.min(
          marker.pos.x * TILE,
          s.width * TILE - marker.label.length * 12 - 6,
        ),
        marker.pos.y * TILE - 16,
        marker.label,
        "#f8df9f",
        11,
      );
    if (!state.outcome) {
      const forecast = escortForecast(content, state);
      if (forecast) {
        this.art
          .lineStyle(2, 0xa3f3e2, 0.85)
          .strokeRect(
            forecast.to.x * TILE + 8,
            forecast.to.y * TILE + 8,
            TILE - 16,
            TILE - 16,
          );
        this.label(
          forecast.to.x * TILE,
          forecast.to.y * TILE - 15,
          "호송 예정",
          "#a3f3e2",
          10,
        );
      }
      if (
        state.mission.reinforcement === "scheduled" ||
        state.mission.reinforcement === "deferred"
      ) {
        for (const unit of s.reinforcement.units) {
          for (const [index, pos] of [
            unit.pos,
            ...(s.reinforcement.reserves[unit.id] ?? []),
          ].entries()) {
            this.art
              .lineStyle(2, 0xffb080, index === 0 ? 0.8 : 0.35)
              .strokeRect(
                pos.x * TILE + 4,
                pos.y * TILE + 4,
                TILE - 8,
                TILE - 8,
              );
            this.label(
              pos.x * TILE + 5,
              pos.y * TILE + 15,
              index === 0 ? "증원" : "예비",
              "#ffcc9c",
              10,
            );
          }
        }
      }
    }
    for (const unit of state.units) {
      if (unit.id === animatedId) continue;
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
