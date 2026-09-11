import type { Spell } from "@orden/schema";
import type { BattleState, Content, Position, Unit } from "./types";
import {
  allied,
  canStop,
  distance,
  samePosition,
  stepCost,
  terrainAt,
} from "./movement";
import { effectiveUnit, equipmentSpellIds, spellRangeBonus } from "./effective";
import { hasStatus, statusChance, statusRoll } from "./statuses";
import { squadMembers, teleportPlacements } from "./spellPlacement";

export interface SpellTarget {
  unitId: string;
  amount: number;
  chance?: number;
  success?: boolean;
}
export type SpellPreview =
  | { ok: false; error: string }
  | {
      ok: true;
      spell: Spell;
      tiles: Position[];
      targets: SpellTarget[];
      placements?: { unitId: string; pos: Position }[];
      summon?: Unit;
      terrainChanges?: { pos: Position; terrainId: string }[];
    };

export function knownSpells(content: Content, unit: Unit): Spell[] {
  if (unit.kind !== "commander" && !unit.summon) return [];
  return [
    ...new Set([...unit.spellIds, ...equipmentSpellIds(content, unit)]),
  ].flatMap((id) => {
    const spell = content.spells.find((candidate) => candidate.id === id);
    return spell ? [spell] : [];
  });
}

export function effectiveSpellRange(
  content: Content,
  unit: Unit,
  spell: Spell,
): [number, number] {
  return [
    spell.range[0],
    spell.range[1] === 0 ? 0 : spell.range[1] + spellRangeBonus(content, unit),
  ];
}

/** Legal centers are independent of occupants and MP. */
export function spellTargetTiles(
  content: Content,
  unit: Unit,
  spell: Spell,
  origin = unit.pos,
): Position[] {
  const tiles: Position[] = [];
  const limits = effectiveSpellRange(content, unit, spell);
  for (let y = 0; y < content.scenario.height; y += 1)
    for (let x = 0; x < content.scenario.width; x += 1) {
      const pos = { x, y };
      const range = distance(origin, pos);
      if (range >= limits[0] && range <= limits[1]) tiles.push(pos);
    }
  return tiles;
}

export function spellArea(
  content: Content,
  spell: Spell,
  center: Position,
  state?: BattleState,
  caster?: Unit,
  origin = caster?.pos,
): Position[] {
  if (spell.shape === "squad") {
    if (!state) return [];
    const position = (target: Unit) =>
      target.id === caster?.id && origin ? origin : target.pos;
    const anchor = state.units.find(
      (target) => target.hp > 0 && samePosition(position(target), center),
    );
    return anchor
      ? squadMembers(state, anchor).map((target) => ({ ...position(target) }))
      : [];
  }
  if (spell.shape === "radius") {
    const tiles: Position[] = [];
    for (let y = 0; y < content.scenario.height; y += 1)
      for (let x = 0; x < content.scenario.width; x += 1) {
        const pos = { x, y };
        if (distance(center, pos) <= spell.radius!) tiles.push(pos);
      }
    return tiles;
  }
  const { x, y } = center;
  const tiles = [{ x, y }];
  if (spell.shape === "cross")
    tiles.push(
      { x, y: y - 1 },
      { x: x - 1, y },
      { x: x + 1, y },
      { x, y: y + 1 },
    );
  return tiles.filter((pos) => !!terrainAt(content, pos, state));
}

export function friendlySpell(spell: Spell) {
  return (
    spell.effect.type === "heal" ||
    spell.effect.type === "teleport" ||
    spell.effect.type === "again" ||
    (spell.effect.type === "status" && !spell.effect.hostile)
  );
}

/** Shared by temporary movement, AI and command execution; never mutates state. */
export function previewSpell(
  content: Content,
  state: BattleState,
  unit: Unit,
  spellId: string,
  center: Position,
  origin = unit.pos,
  destination?: Position,
): SpellPreview {
  const spell = knownSpells(content, unit).find((item) => item.id === spellId);
  if (!spell || unit.hp <= 0)
    return { ok: false, error: "사용할 수 없는 마법입니다." };
  if (hasStatus(state, unit, "mute") || hasStatus(state, unit, "sleep"))
    return {
      ok: false,
      error: "뮤트·슬립 상태에서는 마법을 사용할 수 없습니다.",
    };
  if (unit.mp < spell.mpCost)
    return { ok: false, error: "마법을 사용할 MP가 부족합니다." };
  if (!terrainAt(content, center, state) || !terrainAt(content, origin, state))
    return { ok: false, error: "마법 대상이 맵을 벗어났습니다." };
  const limits = effectiveSpellRange(content, unit, spell);
  if (
    distance(origin, center) < limits[0] ||
    distance(origin, center) > limits[1]
  )
    return { ok: false, error: "마법 사거리를 벗어났습니다." };
  if (destination && spell.effect.type !== "teleport")
    return { ok: false, error: "텔레포트만 도착 위치를 지정합니다." };
  const virtual = {
    ...state,
    units: state.units.map((target) =>
      target.id === unit.id ? { ...target, pos: { ...origin } } : target,
    ),
  };
  const caster = effectiveUnit(content, virtual, { ...unit, pos: origin });
  const tiles = spellArea(content, spell, center, virtual, caster, origin);
  const anchor = virtual.units.find(
    (target) => target.hp > 0 && samePosition(target.pos, center),
  );
  if (
    spell.shape === "squad" &&
    (!anchor || allied(unit.side, anchor.side) !== friendlySpell(spell))
  )
    return { ok: false, error: "대상 부대를 확인하세요." };

  if (spell.effect.type === "summon") {
    const template = content.summons.find(
      (candidate) => candidate.id === spell.effect.summonId,
    );
    if (!template) return { ok: false, error: "소환물 데이터가 없습니다." };
    const cleared = {
      ...virtual,
      units: virtual.units.filter(
        (target) => target.summon?.ownerId !== unit.id,
      ),
    };
    const summon: Unit = {
      ...structuredClone(template),
      id: `summon-${unit.id}-${state.revision + 1}`,
      kind: "commander",
      commanderId: unit.id,
      side: unit.side,
      pos: { ...center },
      hp: 10,
      mp: template.stats.maxMp,
      command: null,
      acted: true,
      summon: { ownerId: unit.id, templateId: template.id },
    };
    if (
      cleared.units.some((target) => target.id === summon.id) ||
      cleared.units.length >= (content.scenario.mission?.unitLimit ?? 42)
    )
      return { ok: false, error: "소환할 유닛 공간이 부족합니다." };
    if (
      !canStop(content, cleared, summon, center) ||
      stepCost(content, cleared, summon, center) === null
    )
      return { ok: false, error: "소환물이 착지할 수 없는 칸입니다." };
    return { ok: true, spell, tiles: [{ ...center }], targets: [], summon };
  }

  if (spell.effect.type === "teleport") {
    if (!anchor || anchor.kind === "escort")
      return { ok: false, error: "호송대는 텔레포트할 수 없습니다." };
    if (!destination)
      return { ok: false, error: "텔레포트 도착 칸을 선택하세요." };
    if (
      !terrainAt(content, destination, state) ||
      distance(origin, destination) > limits[1]
    )
      return { ok: false, error: "텔레포트 도착 칸이 사거리를 벗어났습니다." };
    const group = squadMembers(virtual, anchor);
    const placements = teleportPlacements(
      content,
      virtual,
      group,
      anchor,
      destination,
    );
    if (!placements)
      return {
        ok: false,
        error: "도착 지점 주변에 부대 전체를 배치할 수 없습니다.",
      };
    if (
      placements.every((placement) =>
        samePosition(
          placement.pos,
          virtual.units.find((target) => target.id === placement.unitId)!.pos,
        ),
      )
    )
      return { ok: false, error: "부대의 현재 위치와 같습니다." };
    return {
      ok: true,
      spell,
      tiles: placements.map((placement) => placement.pos),
      targets: placements.map((placement) => ({
        unitId: placement.unitId,
        amount: 0,
      })),
      placements,
    };
  }

  const isFriendly = friendlySpell(spell);
  const charmLeader =
    spell.effect.status === "charm" && anchor
      ? (squadMembers(virtual, anchor).find(
          (target) => target.kind === "commander",
        ) ?? anchor)
      : undefined;
  const targets = virtual.units.flatMap((target): SpellTarget[] => {
    if (
      target.hp <= 0 ||
      !tiles.some((pos) => samePosition(pos, target.pos)) ||
      allied(unit.side, target.side) !== isFriendly
    )
      return [];
    const effect = spell.effect;
    if (effect.type === "heal")
      return target.hp === 10
        ? []
        : [
            {
              unitId: target.id,
              amount: Math.min(effect.power, 10 - target.hp),
            },
          ];
    if (effect.type === "slay-undead")
      return target.unitType === "undead" && target.kind === "mercenary"
        ? [{ unitId: target.id, amount: target.hp }]
        : [];
    if (effect.type === "again")
      return target.kind !== "escort" &&
        target.id !== unit.id &&
        target.acted &&
        target.refreshedRound !== state.round
        ? [{ unitId: target.id, amount: 0 }]
        : [];
    if (effect.type === "status") {
      if (
        target.kind === "escort" ||
        (effect.commanderOnly && target.kind !== "commander")
      )
        return [];
      const chanceTarget = effectiveUnit(
        content,
        virtual,
        charmLeader ?? target,
      );
      const chance = effect.hostile
        ? statusChance(content, caster, chanceTarget)
        : 100;
      const success =
        !effect.hostile ||
        statusRoll(state, unit, charmLeader ?? target, spell.id) < chance;
      return [{ unitId: target.id, amount: 0, chance, success }];
    }
    if (
      effect.type !== "damage" ||
      (effect.groundOnly && target.moveType === "flying")
    )
      return [];
    const effectiveTarget = effectiveUnit(content, virtual, target);
    const bonus =
      (effect.bonusAgainst === "water" &&
        terrainAt(content, target.pos, virtual)?.water) ||
      (effect.bonusAgainst === "flying" && target.moveType === "flying")
        ? (effect.bonusPower ?? 0)
        : 0;
    return [
      {
        unitId: target.id,
        amount: Math.min(
          target.hp,
          Math.max(
            0,
            Math.min(
              10,
              Math.floor(
                effect.power +
                  bonus +
                  caster.stats.mag / 2 -
                  effectiveTarget.stats.res +
                  0.5,
              ),
            ),
          ),
        ),
      },
    ];
  });
  const terrainChanges = (
    spell.effect.terrainChange === "center"
      ? [center]
      : spell.effect.terrainChange === "area"
        ? tiles
        : []
  ).flatMap((pos) => {
    const terrain = terrainAt(content, pos, state);
    return terrain?.destroyedTo && terrain.destroyedTo !== terrain.id
      ? [{ pos: { ...pos }, terrainId: terrain.destroyedTo }]
      : [];
  });
  if (targets.length === 0 && terrainChanges.length === 0)
    return { ok: false, error: "범위 안에 유효한 마법 대상이 없습니다." };
  return {
    ok: true,
    spell,
    tiles,
    targets,
    ...(terrainChanges.length ? { terrainChanges } : {}),
  };
}
