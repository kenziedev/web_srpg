import type Phaser from "phaser";
import { content } from "@orden/content";
import { drawUnit } from "./pixelUnits";
import type { BattleAnimation } from "./BattleAnimation";
import { statusNames } from "../ui/magicText";

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
  const cast = animation.events.find((event) => event.type === "spellCast");
  const spell = cast
    ? content.spells.find((item) => item.id === cast.spellId)
    : undefined;
  const restorative = spell?.effect.type === "heal";
  const supportive =
    spell && !["heal", "damage", "slay-undead"].includes(spell.effect.type);
  const spellColor = restorative ? 0x9bf0b7 : supportive ? 0x9edaff : 0xd1a3ff;
  const reducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  const position = (id: string) =>
    animation.events
      .filter((event) => event.type === "teleported")
      .find((event) => event.unitId === id)?.to ??
    movements.find((e) => e.unitId === id)?.to ??
    animation.before.units.find((u) => u.id === id)?.pos ??
    animation.after.units.find((u) => u.id === id)?.pos;
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
    if (cast) {
      const magic = scene.add.graphics().setDepth(19);
      objects.push(magic);
      const cx = cast.center.x * 48 + 24;
      const cy = cast.center.y * 48 + 24;
      magic.fillStyle(spellColor, 0.2).fillCircle(cx, cy, 20);
      magic.lineStyle(2, spellColor, 0.9).strokeCircle(cx, cy, 21);
      const targetIds = new Set([
        ...cast.affectedIds,
        ...animation.events.flatMap((event) =>
          event.type === "summoned" ? [event.unitId] : [],
        ),
      ]);
      for (const id of targetIds) {
        const target = position(id);
        if (!target) continue;
        const x = target.x * 48 + 24;
        const y = target.y * 48 + 24;
        magic.lineStyle(2, spellColor, 0.65).lineBetween(cx, cy, x, y);
        magic.lineStyle(2, spellColor).strokeCircle(x, y, 16);
        magic.fillStyle(spellColor, 0.35).fillRect(x - 8, y - 25, 16, 33);
        magic.fillStyle(0xf9f2ff).fillRect(x - 2, y - 17, 4, 16);
        magic.fillRect(x - 8, y - 11, 16, 4);
      }
      scene.tweens.add({
        targets: magic,
        alpha: 0,
        duration: animation.impactMs * 0.75,
      });
      if (spell)
        float(
          cx,
          cy - 38,
          spell.name,
          restorative ? "#b8ffd0" : supportive ? "#b9e8ff" : "#e4c5ff",
        );
      const changed = animation.events.filter(
        (event) => event.type === "terrainChanged",
      ).length;
      if (changed > 0) float(cx, cy + 24, `지형 ${changed}칸 변화`, "#e8cda0");
    }
    for (const event of animation.events) {
      if (event.type === "terrainChanged") {
        const x = event.pos.x * 48,
          y = event.pos.y * 48;
        const fracture = scene.add.graphics().setDepth(19);
        objects.push(fracture);
        fracture.lineStyle(2, 0xe9c999, 0.75).strokeRect(x + 4, y + 4, 40, 40);
        fracture
          .lineBetween(x + 12, y + 4, x + 26, y + 23)
          .lineBetween(x + 26, y + 23, x + 17, y + 42);
        scene.tweens.add({
          targets: fracture,
          alpha: 0,
          duration: animation.impactMs,
        });
        continue;
      }
      if (event.type === "teleported") {
        const portal = scene.add.graphics().setDepth(20);
        objects.push(portal);
        const from = { x: event.from.x * 48 + 24, y: event.from.y * 48 + 24 };
        const to = { x: event.to.x * 48 + 24, y: event.to.y * 48 + 24 };
        portal
          .lineStyle(3, 0x9edaff)
          .strokeEllipse(from.x, from.y, 32, 42)
          .strokeEllipse(to.x, to.y, 32, 42);
        portal
          .lineStyle(1, 0x9edaff, 0.35)
          .lineBetween(from.x, from.y, to.x, to.y);
        scene.tweens.add({
          targets: portal,
          alpha: 0,
          duration: animation.impactMs,
        });
        float(to.x, to.y - 12, "순간이동", "#b9e8ff");
        continue;
      }
      if (event.type === "summoned") {
        const unit = animation.after.units.find(
          (candidate) => candidate.id === event.unitId,
        );
        if (!unit) continue;
        const emergence = scene.add
          .graphics()
          .setDepth(18)
          .setPosition(unit.pos.x * 48, unit.pos.y * 48);
        objects.push(emergence);
        drawUnit(emergence, unit, 0, 0);
        emergence.lineStyle(3, 0x9edaff).strokeCircle(24, 24, 23);
        scene.tweens.add({
          targets: emergence,
          alpha: 0,
          duration: animation.impactMs,
        });
        float(unit.pos.x * 48 + 24, unit.pos.y * 48 + 12, "소환", "#b9e8ff");
        continue;
      }
      if (
        event.type === "statusApplied" ||
        event.type === "statusExpired" ||
        event.type === "refreshed"
      ) {
        const pos = position(event.unitId);
        if (!pos) continue;
        const text =
          event.type === "refreshed"
            ? "행동권 회복"
            : event.type === "statusExpired"
              ? `${statusNames[event.status]} 종료`
              : event.success
                ? (statusNames[event.status] ?? event.status)
                : "저항";
        float(pos.x * 48 + 24, pos.y * 48 + 12, text, "#b9e8ff");
        continue;
      }
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
      const color =
        event.type === "healed" ? 0x8cf0b3 : cast ? spellColor : 0xffe4a7;
      const flash = scene.add.graphics().setDepth(20);
      objects.push(flash);
      flash.lineStyle(3, color).strokeRect(x - 17, y - 11, 34, 32);
      if (event.type === "damaged" && event.amount > 0 && !cast) {
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
        event.type === "healed" ? "#a3ffbf" : cast ? "#e4c5ff" : "#fff1bc",
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
      if (cast) {
        const sourceX = destination.x * 48 + 24;
        const sourceY = destination.y * 48 + 20;
        const charge = scene.add.graphics().setDepth(21);
        objects.push(charge);
        charge.lineStyle(2, spellColor).strokeCircle(sourceX, sourceY, 19);
        charge
          .lineStyle(1, spellColor, 0.45)
          .lineBetween(
            sourceX,
            sourceY,
            cast.center.x * 48 + 24,
            cast.center.y * 48 + 24,
          );
        scene.tweens.add({
          targets: charge,
          alpha: 0,
          duration: animation.impactMs * 0.65,
        });
        if (reducedMotion) {
          impact();
          return;
        }
        const orb = scene.add
          .graphics()
          .setDepth(22)
          .setPosition(sourceX, sourceY);
        objects.push(orb);
        orb.fillStyle(spellColor, 0.4).fillCircle(0, 0, 10);
        orb.fillStyle(0xf9f2ff).fillRect(-3, -6, 6, 12).fillRect(-6, -3, 12, 6);
        scene.tweens.add({
          targets: orb,
          x: cast.center.x * 48 + 24,
          y: cast.center.y * 48 + 24,
          duration: animation.impactMs * 0.25,
          ease: "Cubic.InOut",
          onComplete: () => {
            orb.setVisible(false);
            impact();
          },
        });
        return;
      }
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
        if (Math.abs(dx) + Math.abs(dy) > 1) {
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
