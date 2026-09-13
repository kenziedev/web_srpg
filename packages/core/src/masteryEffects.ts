import type { Content, Unit } from "./types";

export type MasteryEffect = NonNullable<Content["masteries"]>[number]["effect"];

/** Unlocks are lasting growth data. Effects are derived only from the one slot. */
export function unlockMasteries(content: Content, unit: Unit): void {
  const progression = unit.progression;
  if (!progression || progression.level !== 10) return;
  const job = content.classes.find((entry) => entry.id === progression.classId);
  if (job?.tier !== 1) return;
  const earned = (content.masteries ?? [])
    .filter((entry) => entry.sourceClassId === job.id)
    .map((entry) => entry.id);
  if (earned.length)
    progression.unlockedMasteryIds = [
      ...new Set([...(progression.unlockedMasteryIds ?? []), ...earned]),
    ];
}

export function hasMastery(
  content: Content,
  unit: Unit,
  effect: MasteryEffect,
): boolean {
  const progression = unit.progression;
  const id = progression?.equippedMasteryId;
  return !!(
    unit.kind === "commander" &&
    !unit.summon &&
    id &&
    progression.unlockedMasteryIds?.includes(id) &&
    content.masteries?.some(
      (entry) => entry.id === id && entry.effect === effect,
    )
  );
}
