import type { Item } from "@orden/schema";
import type { BattleState, Content, Unit } from "./types";

/** The current MVP command radius ceiling applies after all equipment bonuses. */
export const MAX_COMMAND_RADIUS = 4;

/** Only the two equipped slots contribute; ownership is validated by equip commands. */
export function equippedItems(content: Content, unit: Unit): Item[] {
  if (unit.kind !== "commander") return [];
  return (["weapon", "armor"] as const).flatMap((slot) => {
    const id = unit.equipment?.[slot];
    const item = content.items.find((candidate) => candidate.id === id);
    return item && item.slot === slot && !item.unavailableReason ? [item] : [];
  });
}

export function equipmentSpellIds(content: Content, unit: Unit): string[] {
  return [
    ...new Set(
      equippedItems(content, unit).flatMap((item) => item.grantedSpellIds),
    ),
  ];
}

export function spellRangeBonus(content: Content, unit: Unit): number {
  return equippedItems(content, unit).reduce(
    (sum, item) => sum + (item.modifiers.spellRange ?? 0),
    0,
  );
}

/**
 * Derive a display/rules view from a stored base unit. Never persist this view or
 * apply this function twice to it: the serializable unit keeps its base stats.
 */
export function effectiveUnit(
  content: Content,
  state: BattleState,
  unit: Unit,
): Unit {
  const items = equippedItems(content, unit);
  const leader =
    unit.kind === "mercenary"
      ? state.units.find(
          (candidate) =>
            candidate.id === unit.commanderId &&
            candidate.kind === "commander" &&
            candidate.hp > 0 &&
            candidate.side === unit.side,
        )
      : undefined;
  const squadItems = leader ? equippedItems(content, leader) : items;
  const squadClass = leader
    ? content.classes.find((entry) => entry.id === leader.progression?.classId)
    : undefined;
  const sum = (key: keyof Item["modifiers"]) =>
    items.reduce((total, item) => {
      const value = item.modifiers[key];
      return total + (typeof value === "number" ? value : 0);
    }, 0);
  const squadSum = (key: "squadMove" | "squadRes") =>
    squadItems.reduce((total, item) => total + (item.modifiers[key] ?? 0), 0);
  const statuses = state.statuses.filter((effect) => effect.unitId === unit.id);
  const statusPower = (status: (typeof statuses)[number]["status"]) =>
    Math.max(
      0,
      ...statuses
        .filter((effect) => effect.status === status)
        .map((effect) => effect.power),
    );
  const personalBuff = (status: "attack" | "protection") => {
    // A squad buff belongs to its commander and reaches mercenaries through the
    // existing command bonus. Tolerate redundant follower records without doubling it.
    if (
      leader &&
      state.statuses.some(
        (effect) => effect.unitId === leader.id && effect.status === status,
      )
    )
      return 0;
    return statusPower(status);
  };
  const maxMp = Math.max(
    0,
    Math.floor(
      unit.stats.maxMp *
        items.reduce(
          (value, item) => value * (item.modifiers.maxMpMultiplier ?? 1),
          1,
        ),
    ),
  );
  const stats: Unit["stats"] = {
    at: Math.max(0, unit.stats.at + sum("at") + personalBuff("attack")),
    df: Math.max(0, unit.stats.df + sum("df") + personalBuff("protection")),
    mag: Math.max(0, unit.stats.mag + sum("mag")),
    res: Math.max(
      0,
      unit.stats.res +
        sum("res") +
        squadSum("squadRes") +
        (squadClass?.squadRes ?? 0) +
        statusPower("resist") -
        statusPower("decline"),
    ),
    move: statuses.some((effect) => effect.status === "sleep")
      ? 0
      : Math.max(
          1,
          unit.stats.move +
            sum("move") +
            squadSum("squadMove") +
            statusPower("quick"),
        ),
    maxMp,
  };
  const weaponRange = items.find((item) => item.modifiers.attackRange)
    ?.modifiers.attackRange;
  return {
    ...unit,
    stats,
    range: weaponRange ? [...weaponRange] : [...unit.range],
    command: unit.command
      ? {
          radius: statuses.some((effect) => effect.status === "zone")
            ? 0
            : Math.min(
                MAX_COMMAND_RADIUS,
                Math.max(0, unit.command.radius + sum("commandRadius")),
              ),
          at: Math.max(
            0,
            unit.command.at + sum("commandAt") + statusPower("attack"),
          ),
          df: Math.max(
            0,
            unit.command.df + sum("commandDf") + statusPower("protection"),
          ),
        }
      : null,
  };
}

export const effectiveMaxMp = (
  content: Content,
  state: BattleState,
  unit: Unit,
): number => effectiveUnit(content, state, unit).stats.maxMp;
