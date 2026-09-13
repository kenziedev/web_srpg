import type { BattleAnimation } from "./BattleAnimation";
import { playBattleAnimation } from "./playBattleAnimation";
import { useEffect, useRef, useState } from "react";
import Phaser from "phaser";
import { content } from "@orden/content";
import {
  commandBonus,
  enemyPhysicalThreat,
  key,
  previewCommandRange,
  terrainAt,
  escortForecast,
  type BattleState,
  type Position,
  type ReachableTile,
  type PhysicalThreatTile,
} from "@orden/core";

import { drawTerrain } from "./pixelTerrain";
import { drawUnit } from "./pixelUnits";

const TILE = 48;
const ZOOM_LEVELS = [0.5, 1, 1.5];
export interface BattleMapView {
  zoom: number;
  cursor: Position | null;
}
export interface BattleMapControls {
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
  centerOn: (position?: Position) => void;
  pan: (dxTiles: number, dyTiles: number) => void;
  focusTile: (position?: Position) => void;
  moveCursor: (dx: number, dy: number) => void;
  selectCursor: () => void;
  clearCursor: () => void;
}
interface MapProps {
  state: BattleState;
  animation: BattleAnimation | null;
  selectedId: string;
  destination: Position | null;
  reachable: ReachableTile[];
  spellCenters: Position[];
  spellTiles: Position[];
  showCommand: boolean;
  showThreat?: boolean;
  inputDisabled?: boolean;
  onControlsReady?: (controls: BattleMapControls | null) => void;
  onViewChange?: (view: BattleMapView) => void;
  onTile: (position: Position) => void;
}

/** Rendering only: every rule query comes from core; pointer input returns tile coordinates. */
export function BattleMap(props: MapProps) {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  const sceneRef = useRef<BattleScene | null>(null);
  const [cursor, setCursor] = useState<Position | null>(null);
  latest.current = props;
  useEffect(() => {
    if (!host.current) return;
    const scene = new BattleScene(
      () => latest.current,
      (view) => {
        setCursor(view.cursor);
        latest.current.onViewChange?.(view);
      },
      () => host.current?.focus({ preventScroll: true }),
    );
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
      latest.current.onControlsReady?.(null);
      // Phaser destroys on its next frame. Remove its canvas from layout now so
      // a StrictMode remount cannot cache the position of a second, stacked canvas.
      game.canvas?.remove();
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
    props.spellCenters,
    props.spellTiles,
    props.showCommand,
    props.showThreat,
    props.inputDisabled,
  ]);
  return (
    <div
      ref={host}
      className="map-canvas"
      role="img"
      tabIndex={props.inputDisabled ? -1 : 0}
      data-map-keyboard="true"
      aria-label={`전술 지도. ${cursor ? `선택 타일 (${cursor.x}, ${cursor.y}). ` : ""}방향키로 타일 이동, Space로 선택, WASD로 카메라 이동. 부대 목록에서도 선택할 수 있습니다.`}
      onKeyDown={(event) => {
        if (sceneRef.current?.handleKey(event.nativeEvent)) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
    />
  );
}

class BattleScene extends Phaser.Scene {
  private playing: BattleAnimation | null = null;
  private lastState: BattleState | null = null;
  private stopAnimation: (() => void) | null = null;
  private terrainImage?: Phaser.GameObjects.Image;
  private terrainSignature = "";
  private art!: Phaser.GameObjects.Graphics;
  private labels: Phaser.GameObjects.Text[] = [];
  private drag: { x: number; y: number; sx: number; sy: number } | null = null;
  private cursor: Position | null = null;
  private threatState: BattleState | null = null;
  private threatTiles: PhysicalThreatTile[] = [];
  constructor(
    private read: () => MapProps,
    private changed: (view: BattleMapView) => void,
    private focusHost: () => void,
  ) {
    super("battle");
  }
  create() {
    this.paintTerrain(this.read().state);
    this.art = this.add.graphics();
    this.cameras.main.setBounds(
      0,
      0,
      content.scenario.width * TILE,
      content.scenario.height * TILE,
    );
    this.centerMap();
    this.game.events.once(Phaser.Core.Events.POST_RENDER, () => {
      this.scale.updateBounds();
      this.game.canvas.dataset.ready = "true";
      this.read().onControlsReady?.({
        zoomIn: () => this.changeZoom(1),
        zoomOut: () => this.changeZoom(-1),
        resetZoom: () => this.setZoom(1),
        centerOn: (position) => this.centerOnTile(position),
        pan: (dx, dy) => this.pan(dx, dy),
        focusTile: (position) => this.focusTile(position),
        moveCursor: (dx, dy) => this.moveCursor(dx, dy),
        selectCursor: () => this.selectCursor(),
        clearCursor: () => this.clearCursor(),
      });
      this.notifyView();
    });
    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      if (
        this.game.canvas.dataset.ready !== "true" ||
        this.read().inputDisabled
      )
        return;
      this.clearCursor();
      this.drag = {
        x: p.x,
        y: p.y,
        sx: this.cameras.main.scrollX,
        sy: this.cameras.main.scrollY,
      };
    });
    this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
      if (!p.isDown || !this.drag || this.read().inputDisabled) return;
      this.cameras.main.setScroll(
        Math.round(this.drag.sx + (this.drag.x - p.x) / this.cameras.main.zoom),
        Math.round(this.drag.sy + (this.drag.y - p.y) / this.cameras.main.zoom),
      );
    });
    this.input.on("pointerup", (p: Phaser.Input.Pointer) => {
      if (
        !this.read().inputDisabled &&
        this.drag &&
        Math.hypot(p.x - this.drag.x, p.y - this.drag.y) < 6
      ) {
        const point = this.cameras.main.getWorldPoint(p.x, p.y);
        const position = {
          x: Math.floor(point.x / TILE),
          y: Math.floor(point.y / TILE),
        };
        if (terrainAt(content, position, this.read().state))
          this.read().onTile(position);
      }
      this.drag = null;
    });
    this.input.on(
      "wheel",
      (
        pointer: Phaser.Input.Pointer,
        _objects: unknown,
        dx: number,
        dy: number,
        _dz: number,
        event: WheelEvent,
      ) => {
        if (this.read().inputDisabled) return;
        if (event.ctrlKey || event.metaKey) {
          event.preventDefault();
          if (dy) this.changeZoom(dy < 0 ? 1 : -1, pointer);
          return;
        }
        this.cameras.main.setScroll(
          this.cameras.main.scrollX + dx / this.cameras.main.zoom,
          this.cameras.main.scrollY + dy / this.cameras.main.zoom,
        );
      },
    );
    this.events.once("shutdown", () => this.stopAnimation?.());
    this.paint();
  }
  private centerMap() {
    this.cameras.main.centerOn(
      Math.ceil(content.scenario.width / 2) * TILE,
      Math.ceil(content.scenario.height / 2) * TILE,
    );
  }
  private selectedPosition(): Position {
    const { state, selectedId, destination } = this.read();
    return (
      destination ??
      state.units.find((unit) => unit.id === selectedId)?.pos ?? {
        x: Math.floor(content.scenario.width / 2),
        y: Math.floor(content.scenario.height / 2),
      }
    );
  }
  private notifyView() {
    this.game.canvas.dataset.zoom = String(this.cameras.main.zoom);
    this.game.canvas.dataset.cursor = this.cursor ? key(this.cursor) : "";
    this.changed({
      zoom: this.cameras.main.zoom,
      cursor: this.cursor ? { ...this.cursor } : null,
    });
  }
  private setZoom(zoom: number, pointer?: Phaser.Input.Pointer) {
    if (this.read().inputDisabled) return;
    const camera = this.cameras.main;
    const x = pointer?.x ?? camera.width / 2;
    const y = pointer?.y ?? camera.height / 2;
    const anchor = camera.getWorldPoint(x, y);
    camera.setZoom(zoom);
    camera.centerOn(
      anchor.x + (camera.width / 2 - x) / zoom,
      anchor.y + (camera.height / 2 - y) / zoom,
    );
    this.notifyView();
  }
  private changeZoom(direction: number, pointer?: Phaser.Input.Pointer) {
    const index = ZOOM_LEVELS.indexOf(this.cameras.main.zoom);
    const next = Math.max(
      0,
      Math.min(ZOOM_LEVELS.length - 1, index + direction),
    );
    this.setZoom(ZOOM_LEVELS[next]!, pointer);
  }
  private centerOnTile(position = this.selectedPosition()) {
    if (
      this.read().inputDisabled ||
      !terrainAt(content, position, this.read().state)
    )
      return;
    this.cameras.main.centerOn(
      (position.x + 0.5) * TILE,
      (position.y + 0.5) * TILE,
    );
  }
  private pan(dx: number, dy: number) {
    if (
      this.read().inputDisabled ||
      !Number.isFinite(dx) ||
      !Number.isFinite(dy)
    )
      return;
    this.cameras.main.setScroll(
      this.cameras.main.scrollX + dx * TILE,
      this.cameras.main.scrollY + dy * TILE,
    );
  }
  private focusTile(position = this.selectedPosition()) {
    if (this.read().inputDisabled) return;
    this.cursor = {
      x: Math.max(
        0,
        Math.min(content.scenario.width - 1, Math.floor(position.x)),
      ),
      y: Math.max(
        0,
        Math.min(content.scenario.height - 1, Math.floor(position.y)),
      ),
    };
    this.focusHost();
    this.centerOnTile(this.cursor);
    this.notifyView();
    this.paint();
  }
  private moveCursor(dx: number, dy: number) {
    if (this.read().inputDisabled) return;
    const pos = this.cursor ?? this.selectedPosition();
    this.focusTile({ x: pos.x + dx, y: pos.y + dy });
  }
  private selectCursor() {
    if (!this.read().inputDisabled && this.cursor)
      this.read().onTile({ ...this.cursor });
  }
  private clearCursor() {
    if (!this.cursor) return;
    this.cursor = null;
    this.notifyView();
    this.paint();
  }
  handleKey(event: KeyboardEvent): boolean {
    if (
      this.read().inputDisabled ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey
    )
      return false;
    const arrows: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const movement = arrows[event.key];
    if (movement) {
      if (event.shiftKey) this.pan(...movement);
      else this.moveCursor(...movement);
      return true;
    }
    const camera: Record<string, [number, number]> = {
      a: [-1, 0],
      d: [1, 0],
      w: [0, -1],
      s: [0, 1],
    };
    if (camera[event.key.toLowerCase()]) {
      this.pan(...camera[event.key.toLowerCase()]!);
      return true;
    }
    if (event.key === "+" || event.key === "=") {
      this.changeZoom(1);
      return true;
    }
    if (event.key === "-") {
      this.changeZoom(-1);
      return true;
    }
    if (event.key === "Home") {
      this.centerOnTile();
      return true;
    }
    if (event.key === " " || (event.key === "Enter" && this.cursor)) {
      if (!this.cursor) this.focusTile();
      this.selectCursor();
      return true;
    }
    if (event.key === "Escape") this.clearCursor();
    return false;
  }
  private paintTerrain(state: BattleState) {
    const signature = JSON.stringify(state.terrainChanges);
    if (this.terrainImage && signature === this.terrainSignature) return;
    this.terrainImage?.destroy();
    if (this.textures.exists("battle-terrain"))
      this.textures.remove("battle-terrain");
    const terrain = this.add.graphics();
    drawTerrain(terrain, content, state);
    terrain.generateTexture(
      "battle-terrain",
      content.scenario.width * TILE,
      content.scenario.height * TILE,
    );
    terrain.destroy();
    this.terrainImage = this.add
      .image(0, 0, "battle-terrain")
      .setOrigin(0)
      .setDepth(-1);
    this.terrainSignature = signature;
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
      spellCenters,
      spellTiles,
      showCommand,
      showThreat,
      animation,
    } = this.read();
    this.paintTerrain(state);
    if (this.playing !== animation) {
      this.stopAnimation?.();
      this.playing = animation;
      this.stopAnimation = animation
        ? playBattleAnimation(this, animation)
        : null;
    }
    if (state.revision === 0 && state !== this.lastState) {
      this.centerMap();
      this.cursor = null;
      this.notifyView();
    }
    this.lastState = state;
    const animatedId =
      animation?.command.type === "act"
        ? animation.command.unitId
        : animation?.events.find((e) => e.type === "moved")?.unitId;
    const command = showCommand
      ? previewCommandRange(content, state, selectedId, destination)
      : null;
    const commandCells = new Set(command?.tiles.map(key));
    if (showThreat && this.threatState !== state) {
      this.threatState = state;
      this.threatTiles = enemyPhysicalThreat(content, state);
    }
    const threatCells = new Set(
      showThreat ? this.threatTiles.map((tile) => key(tile.pos)) : [],
    );
    this.game.canvas.dataset.threatCount = String(threatCells.size);
    this.game.canvas.dataset.commandOrigin = command ? key(command.origin) : "";
    this.game.canvas.dataset.commandRadius = command
      ? String(command.radius)
      : "";
    this.art.clear();
    this.labels.forEach((text) => text.destroy());
    this.labels = [];
    const s = content.scenario;
    for (let y = 0; y < s.height; y++)
      for (let x = 0; x < s.width; x++) {
        const px = x * TILE,
          py = y * TILE;
        if (threatCells.has(key({ x, y }))) {
          this.art
            .fillStyle(0xd34850, 0.13)
            .fillRect(px + 2, py + 2, TILE - 4, TILE - 4)
            .lineStyle(2, 0xff8d91, 0.62)
            .lineBetween(px + 5, py + 22, px + 22, py + 5)
            .lineBetween(px + 5, py + 42, px + 42, py + 5)
            .lineBetween(px + 25, py + 42, px + 42, py + 25);
        }
        if (commandCells.has(key({ x, y })))
          this.art
            .lineStyle(
              2,
              destination ? 0xaaf2ca : 0xedcc81,
              destination ? 0.8 : 0.45,
            )
            .strokeRect(px + 2, py + 2, TILE - 4, TILE - 4);
        if (reachable.some((r) => r.pos.x === x && r.pos.y === y))
          this.art
            .fillStyle(0x4968ce, 0.18)
            .fillRect(px + 3, py + 3, TILE - 6, TILE - 6);
      }
    for (const pos of spellCenters)
      this.art
        .fillStyle(0x9d73fa, 0.25)
        .fillRect(pos.x * TILE + 4, pos.y * TILE + 4, TILE - 8, TILE - 8)
        .lineStyle(1, 0xc8a5ff, 0.85)
        .strokeRect(pos.x * TILE + 4, pos.y * TILE + 4, TILE - 8, TILE - 8);
    for (const pos of spellTiles)
      this.art
        .fillStyle(0xefcafa, 0.24)
        .fillRect(pos.x * TILE + 3, pos.y * TILE + 3, TILE - 6, TILE - 6)
        .lineStyle(3, 0xffe4ab, 1)
        .strokeRect(pos.x * TILE + 3, pos.y * TILE + 3, TILE - 6, TILE - 6);
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
      if (state.statuses.some((effect) => effect.unitId === unit.id))
        this.label(
          unit.pos.x * TILE + 30,
          unit.pos.y * TILE + 3,
          "✦",
          "#efcafa",
          12,
        );
      const planned = destination
        ? command?.bonuses.find((bonus) => bonus.unitId === unit.id)
        : undefined;
      if (
        planned &&
        (planned.before.active !== planned.after.active ||
          planned.before.at !== planned.after.at ||
          planned.before.df !== planned.after.df)
      ) {
        this.label(
          x + 1,
          y - 10,
          planned.after.active
            ? `예정 AT+${planned.after.at} DF+${planned.after.df}`
            : "예정 범위 밖",
          planned.after.active ? "#aaf2ca" : "#ffaaa0",
          9,
        );
      } else if (
        unit.kind === "mercenary" &&
        !commandBonus(state, unit, content).active
      )
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
    if (this.cursor) {
      const { x, y } = this.cursor;
      this.art
        .lineStyle(3, 0x93faff, 1)
        .strokeRect(x * TILE + 1, y * TILE + 1, TILE - 2, TILE - 2);
      this.label(x * TILE + 3, y * TILE + 3, `${x},${y}`, "#b9fbff", 10);
    }
  }
}
