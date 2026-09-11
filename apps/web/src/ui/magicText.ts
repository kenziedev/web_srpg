import type { BattleEvent, BattleState, Content } from "@orden/core";

export const statusNames: Record<string, string> = {
  attack: "공격 강화",
  protection: "방어 강화",
  resist: "마법 저항 강화",
  quick: "이동 강화",
  sleep: "수면",
  mute: "침묵",
  zone: "지휘 봉쇄",
  charm: "매혹",
  decline: "마법 저항 약화",
};

export function magicEventText(
  content: Content,
  before: BattleState,
  after: BattleState,
  event: BattleEvent,
): string | null {
  if (event.type === "battleDeployed")
    return "성장한 부대로 새 연습을 시작했습니다.";
  if (event.type === "terrainChanged") {
    const name =
      content.terrains.find((terrain) => terrain.id === event.terrainId)
        ?.name ?? event.terrainId;
    return `지형 (${event.pos.x}, ${event.pos.y}) → ${name}`;
  }
  if (!("unitId" in event)) return null;
  const name =
    before.units.find((unit) => unit.id === event.unitId)?.name ??
    after.units.find((unit) => unit.id === event.unitId)?.name ??
    after.progression.roster.find((unit) => unit.id === event.unitId)?.name ??
    before.progression.roster.find((unit) => unit.id === event.unitId)?.name ??
    event.unitId;
  if (event.type === "experienceGained")
    return `${name} · EXP +${event.amount}`;
  if (event.type === "levelUp")
    return `${name} · Lv.${event.from} → Lv.${event.to}`;
  if (event.type === "spellLearned")
    return `${name} · ${content.spells.find((spell) => spell.id === event.spellId)?.name ?? event.spellId} 습득`;
  if (event.type === "classChanged")
    return `${name} · ${content.classes.find((entry) => entry.id === event.to)?.name ?? event.to} ${event.reset ? "복귀" : "전직"}`;
  if (event.type === "statusApplied")
    return `${name} · ${statusNames[event.status]}${event.power ? ` ${event.status === "decline" ? "−" : "+"}${event.power}` : ""} ${event.success ? "적용" : "저항"} (성공률 ${event.chance}%)`;
  if (event.type === "statusExpired")
    return `${name} · ${statusNames[event.status]} 종료`;
  if (event.type === "teleported")
    return `${name} · (${event.from.x}, ${event.from.y}) → (${event.to.x}, ${event.to.y})`;
  if (event.type === "summoned") return `${name} · 소환`;
  if (event.type === "refreshed") return `${name} · 행동권 회복`;
  if (event.type === "equipmentChanged")
    return `${name} · ${content.items.find((item) => item.id === event.itemId)?.name ?? "장비 해제"}`;
  return null;
}
