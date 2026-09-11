import type { Spell } from "@orden/schema";

export function spellShapeLabel(spell: Spell): string {
  switch (spell.shape) {
    case "single":
      return "단일 대상";
    case "cross":
      return "십자 범위";
    case "radius":
      return `반경 ${spell.radius}칸`;
    case "squad":
      return "소속 부대 전체";
  }
}

export function spellRangeLabel(spell: Spell): string {
  return spell.range[1] === 0 ? "자신 중심" : `사거리 ${spell.range[1]}칸`;
}

export function spellEffectLabel(spell: Spell): string {
  const effect = spell.effect;
  if (effect.type === "heal") return `HP 최대 ${effect.power} 회복`;
  if (effect.type === "damage")
    return `위력 ${effect.power}${effect.groundOnly ? " · 지상 대상" : ""}${effect.terrainChange ? " · 지형 파괴" : ""}`;
  if (effect.type === "teleport") return "부대 선택 후 도착 칸 선택";
  if (effect.type === "again") return "행동 완료한 아군 재행동 · 1회/라운드";
  if (effect.type === "summon") return "지휘관당 1기 · 기존 소환물 교체";
  if (effect.type === "slay-undead") return "언데드 용병 소멸 · 지휘관 제외";
  const effects: Record<string, string> = {
    attack: `AT +${effect.power}`,
    protection: `DF +${effect.power}`,
    resist: `RES +${effect.power}`,
    decline: `RES −${effect.power}`,
    quick: `이동 +${effect.power}`,
    sleep: "이동·행동·반격 봉쇄",
    mute: "마법 봉쇄",
    zone: "지휘 범위 0",
    charm: "부대 진영 변경 · 자동 행동",
  };
  return `${effects[effect.status ?? ""] ?? "상태 변화"} · 시전자 다음 턴까지${effect.hostile ? " · 저항 가능" : ""}`;
}
