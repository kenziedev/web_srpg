import type Phaser from "phaser";
import { drawUnit } from "./pixelUnits";
import type { BattleAnimation } from "./BattleAnimation";

export function playBattleAnimation(
  scene: Phaser.Scene,
  animation: BattleAnimation,
) {
  const objects: (Phaser.GameObjects.Graphics | Phaser.GameObjects.Text)[] = [];
  let cancelled = false;
  const actorId =
    animation.command.type === "act"
      ? animation.command.unitId
      : animation.events.find((e) => e.type === "moved")?.unitId;
  const actor = animation.before.units.find((u) => u.id === actorId);
  const movements = animation.events.filter((e) => e.type === "moved");
  const movement = movements.find((e) => e.unitId === actorId);
  const destination = movement?.to ?? actor?.pos;
  const position = (id: string) =>
    movements.find((e) => e.unitId === id)?.to ??
    animation.before.units.find((u) => u.id === id)?.pos;
  const float = (x: number, y: number, text: string, color: string) => {
    const label = scene.add
      .text(x, y, text, {
        fontFamily: "sans-serif",
        fontStyle: "bold",
        fontSize: 20,
        color,
        stroke: "#10172b",
        strokeThickness: 5,
      })
      .setOrigin(0.5)
      .setDepth(30);
    objects.push(label);
    scene.tweens.add({
      targets: label,
      y: y - 23,
      alpha: 0,
      duration: animation.impactMs,
      delay: 20,
      ease: "Cubic.Out",
    });
  };
  const impact = () => {
    if (cancelled) return;
    for (const event of animation.events) {
      if (
        event.type !== "damaged" &&
        event.type !== "healed" &&
        event.type !== "removed"
      )
        continue;
      const pos = position(event.unitId);
      if (!pos) continue;
      const x = pos.x * 48 + 24,
        y = pos.y * 48 + 18;
      if (event.type === "removed") {
        float(
          x,
          y + 28,
          event.reason === "retreated" ? "퇴각" : "격파",
          "#f1d6a3",
        );
        continue;
      }
      if (event.type === "healed" && event.amount === 0) continue;
      const color = event.type === "healed" ? 0x8cf0b3 : 0xffe4a7;
      const flash = scene.add.graphics().setDepth(20);
      objects.push(flash);
      flash.lineStyle(3, color).strokeRect(x - 17, y - 11, 34, 32);
      if (event.type === "damaged" && event.amount > 0) {
        flash.lineStyle(4, 0xfffae3).lineBetween(x - 14, y + 15, x + 14, y - 9);
        flash.lineStyle(2, 0xf09e63).lineBetween(x - 7, y - 13, x + 9, y + 20);
        for (let i = 0; i < 4; i++)
          flash
            .fillStyle(color)
            .fillRect(x - 20 + i * 12, y + (i % 2 ? 20 : -14), 4, 4);
      }
      scene.tweens.add({
        targets: flash,
        alpha: 0,
        duration: animation.impactMs,
      });
      float(
        x,
        y + (event.unitId === actorId ? 14 : -8),
        event.type === "healed"
          ? `+${event.amount}`
          : event.amount
            ? `−${event.amount}`
            : "방어 0",
        event.type === "healed" ? "#a3ffbf" : "#fff1bc",
      );
    }
  };
  if (actor && destination) {
    const ghost = scene.add
      .graphics()
      .setDepth(12)
      .setPosition(actor.pos.x * 48, actor.pos.y * 48);
    objects.push(ghost);
    drawUnit(ghost, { ...actor, acted: false }, 0, 0);
    const focus = destination;
    if (
      !scene.cameras.main.worldView.contains(
        focus.x * 48 + 24,
        focus.y * 48 + 24,
      )
    )
      scene.cameras.main.centerOn(focus.x * 48 + 24, focus.y * 48 + 24);
    const attack = () => {
      if (cancelled) return;
      const command = animation.command;
      const target =
        command.type === "act" && command.action.type === "attack"
          ? position(command.action.targetId)
          : null;
      if (target) {
        const dx = target.x - destination.x,
          dy = target.y - destination.y;
        const norm = Math.max(1, Math.abs(dx) + Math.abs(dy));
        scene.tweens.add({
          targets: ghost,
          x: ghost.x + (dx / norm) * 9,
          y: ghost.y + (dy / norm) * 9,
          duration: animation.impactMs / 4,
          yoyo: true,
        });
        if (actor.range[0] > 1) {
          const bolt = scene.add
            .graphics()
            .setDepth(21)
            .setPosition(destination.x * 48 + 24, destination.y * 48 + 20);
          objects.push(bolt);
          bolt.fillStyle(0xffe7a5).fillRect(-4, -2, 8, 4);
          scene.tweens.add({
            targets: bolt,
            x: target.x * 48 + 24,
            y: target.y * 48 + 20,
            duration: animation.impactMs / 4,
            onComplete: () => {
              bolt.setVisible(false);
              impact();
            },
          });
        } else impact();
      } else impact();
    };
    const path =
      animation.command.type === "act"
        ? animation.command.path
        : movement
          ? [movement.to]
          : [];
    const step = (index: number) => {
      if (cancelled) return;
      const pos = path[index];
      if (!pos) {
        attack();
        return;
      }
      scene.tweens.add({
        targets: ghost,
        x: pos.x * 48,
        y: pos.y * 48,
        duration: animation.moveMs / path.length,
        ease: "Linear",
        onComplete: () => step(index + 1),
      });
    };
    step(0);
  } else impact();
  return () => {
    cancelled = true;
    objects.forEach((o) => {
      scene.tweens.killTweensOf(o);
      o.destroy();
    });
  };
}
