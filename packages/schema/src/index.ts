import { z } from "zod";

export const positionSchema = z.object({
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
});
export const moveTypeSchema = z.enum([
  "foot",
  "mounted",
  "flying",
  "amphibious",
]);
export const unitTypeSchema = z.enum([
  "infantry",
  "pike",
  "cavalry",
  "archer",
  "flier",
  "sailor",
  "cleric",
  "undead",
  "mage",
  "neutral",
]);
export const statusTypeSchema = z.enum([
  "attack",
  "protection",
  "resist",
  "quick",
  "sleep",
  "mute",
  "zone",
  "charm",
  "decline",
]);
export const statusEffectSchema = z
  .object({
    unitId: z.string().min(1).max(128),
    status: statusTypeSchema,
    power: z.number().int().nonnegative(),
    sourceId: z.string().min(1).max(128),
    expiresRound: z.number().int().positive(),
    expiresSide: z.enum(["player", "enemy", "npc"]),
    originalSide: z.enum(["player", "enemy", "npc"]).optional(),
  })
  .superRefine((effect, ctx) => {
    if ((effect.status === "charm") !== (effect.originalSide !== undefined))
      ctx.addIssue({
        code: "custom",
        path: ["originalSide"],
        message: "참 상태만 원래 진영을 보존해야 합니다.",
      });
  });
export const spellSchema = z
  .object({
    id: z.string().min(1).max(128),
    name: z
      .string()
      .min(1)
      .max(80)
      .refine((value) => value.trim().length > 0),
    mpCost: z.number().int().nonnegative(),
    range: z.tuple([
      z.number().int().min(0).max(63),
      z.number().int().min(0).max(63),
    ]),
    shape: z.enum(["single", "cross", "radius", "squad"]),
    radius: z.number().int().positive().max(63).optional(),
    learnable: z.boolean().optional(),
    effect: z.object({
      type: z.enum([
        "damage",
        "heal",
        "status",
        "teleport",
        "again",
        "summon",
        "slay-undead",
      ]),
      power: z.number().int().min(0).max(10),
      bonusAgainst: z.enum(["water", "flying"]).optional(),
      bonusPower: z.number().int().min(0).max(10).optional(),
      status: statusTypeSchema.optional(),
      hostile: z.boolean().optional(),
      duration: z.number().int().positive().optional(),
      commanderOnly: z.boolean().optional(),
      summonId: z.string().min(1).max(128).optional(),
      terrainChange: z.enum(["center", "area"]).optional(),
      groundOnly: z.boolean().optional(),
    }),
  })
  .refine((spell) => spell.range[0] <= spell.range[1], {
    message: "마법 사거리 범위 오류",
    path: ["range"],
  })
  .superRefine((spell, ctx) => {
    if ((spell.shape === "radius") !== (spell.radius !== undefined))
      ctx.addIssue({
        code: "custom",
        path: ["radius"],
        message: "반경 마법만 반경 값이 필요합니다.",
      });
    const hasBonusTarget = spell.effect.bonusAgainst !== undefined;
    const hasBonusPower = spell.effect.bonusPower !== undefined;
    if (
      hasBonusTarget !== hasBonusPower ||
      (hasBonusTarget && spell.effect.type !== "damage")
    )
      ctx.addIssue({
        code: "custom",
        path: ["effect"],
        message: "피해 마법 특효에는 대상과 위력이 함께 필요합니다.",
      });
    const effect = spell.effect;
    const fail = (message: string) =>
      ctx.addIssue({ code: "custom", path: ["effect"], message });
    if (effect.type === "status") {
      if (
        effect.status === undefined ||
        effect.hostile === undefined ||
        effect.duration === undefined
      )
        fail("상태 마법에는 종류·진영·지속이 필요합니다.");
    } else if (
      effect.status !== undefined ||
      effect.hostile !== undefined ||
      effect.duration !== undefined ||
      effect.commanderOnly !== undefined
    ) {
      fail("상태 마법만 상태 필드를 가질 수 있습니다.");
    }
    if ((effect.type === "summon") !== (effect.summonId !== undefined))
      fail("소환 마법만 소환물 참조가 필요합니다.");
    if (
      effect.type !== "damage" &&
      (effect.terrainChange !== undefined || effect.groundOnly !== undefined)
    )
      fail("피해 마법만 지형 변경·지상 대상을 지정할 수 있습니다.");
    if (
      !["damage", "heal", "status"].includes(effect.type) &&
      effect.power !== 0
    )
      fail("보조·소환·불사 제거 마법의 위력은 0이어야 합니다.");
    if (
      (effect.type === "teleport" || effect.type === "again") &&
      spell.shape !== "squad"
    )
      fail("재배치·재행동 마법은 부대 대상이어야 합니다.");
    if (effect.type === "summon" && spell.shape !== "single")
      fail("소환 마법은 단일 배치 칸을 사용합니다.");
  });
const statsSchema = z.object({
  at: z.number().int().nonnegative(),
  df: z.number().int().nonnegative(),
  res: z.number().int().nonnegative(),
  mag: z.number().int().nonnegative(),
  maxMp: z.number().int().nonnegative(),
  move: z.number().int().positive(),
});
const growthId = z.string().min(1).max(128);
export const growthGainsSchema = z.object({
  at: z.number().int().min(1).max(4).optional(),
  df: z.number().int().min(1).max(4).optional(),
  mag: z.number().int().min(1).max(4).optional(),
  res: z.number().int().min(1).max(4).optional(),
  maxMp: z.number().int().min(1).max(32).optional(),
});
export const unitProgressionSchema = z
  .object({
    classId: growthId,
    baseClassId: growthId,
    growthId,
    level: z.number().int().min(1).max(10),
    exp: z.number().int().min(0).max(100),
    totalExp: z.number().int().min(0).max(1_000_000_000),
    learnedSpellIds: z.array(growthId).max(64),
    classHistory: z.array(growthId).min(1).max(1024),
  })
  .superRefine((progression, ctx) => {
    if (progression.level < 10 && progression.exp >= 100)
      ctx.addIssue({
        code: "custom",
        message: "Lv10 미만 EXP는 100 미만이어야 합니다.",
      });
    if (
      new Set(progression.learnedSpellIds).size !==
      progression.learnedSpellIds.length
    )
      ctx.addIssue({ code: "custom", message: "성장 학습 마법 ID 중복" });
    if (
      progression.classHistory[0] !== progression.baseClassId ||
      progression.classHistory.at(-1) !== progression.classId
    )
      ctx.addIssue({
        code: "custom",
        message: "전직 이력의 시작·현재 직업 불일치",
      });
  });
export const classSchema = z.object({
  id: growthId,
  name: z.string().min(1).max(80),
  tier: z.union([z.literal(1), z.literal(2)]),
  promotions: z.array(growthId).max(8),
  unitType: unitTypeSchema,
  moveType: moveTypeSchema,
  move: z.number().int().positive().max(12),
  range: z.tuple([
    z.number().int().min(1).max(63),
    z.number().int().min(1).max(63),
  ]),
  command: z.object({
    radius: z.number().int().min(0).max(4),
    at: z.number().int().min(0).max(8),
    df: z.number().int().min(0).max(8),
  }),
  statBonus: z.object({
    at: z.literal(1).optional(),
    df: z.literal(1).optional(),
    mag: z.literal(1).optional(),
    res: z.literal(1).optional(),
  }),
  learns: z
    .array(
      z.object({
        level: z.number().int().min(1).max(10),
        spellIds: z.array(growthId).min(1).max(64),
      }),
    )
    .max(10),
  description: z.string().min(1).max(1024),
  squadRes: z.number().int().min(0).max(8).optional(),
});
export const growthProfileSchema = z.object({
  id: growthId,
  name: z.string().min(1).max(80),
  levels: z
    .array(
      z.object({
        level: z.number().int().min(2).max(10),
        gains: growthGainsSchema,
      }),
    )
    .max(9),
});
export const unitSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  side: z.enum(["player", "enemy", "npc"]),
  kind: z.enum(["commander", "mercenary", "escort"]),
  commanderId: z.string().nullable(),
  unitType: unitTypeSchema,
  moveType: moveTypeSchema,
  pos: positionSchema,
  hp: z.number().int().min(1).max(10),
  mp: z.number().int().nonnegative(),
  stats: statsSchema,
  range: z.tuple([
    z.number().int().nonnegative(),
    z.number().int().nonnegative(),
  ]),
  command: z
    .object({
      radius: z.number().int().nonnegative(),
      at: z.number().int().nonnegative(),
      df: z.number().int().nonnegative(),
    })
    .nullable(),
  acted: z.boolean(),
  spellIds: z.array(z.string().min(1).max(128)).default([]),
  equipment: z
    .object({
      weapon: z.string().min(1).max(128).nullable(),
      armor: z.string().min(1).max(128).nullable(),
    })
    .optional(),
  summon: z
    .object({
      ownerId: z.string().min(1).max(128),
      templateId: z.string().min(1).max(128),
    })
    .optional(),
  refreshedRound: z.number().int().positive().optional(),
  progression: unitProgressionSchema.optional(),
});
export const summonSchema = z.object({
  id: z.string().min(1).max(128),
  name: z.string().min(1).max(80),
  unitType: unitTypeSchema,
  moveType: moveTypeSchema,
  stats: statsSchema,
  range: z.tuple([
    z.number().int().nonnegative().max(63),
    z.number().int().nonnegative().max(63),
  ]),
  spellIds: z.array(z.string().min(1).max(128)),
});
const modifier = z.number().int().min(-64).max(64);
export const itemSchema = z
  .object({
    id: z.string().min(1).max(128),
    name: z.string().min(1).max(80),
    slot: z.enum(["weapon", "armor"]),
    description: z.string().min(1).max(1024),
    allowedUnitTypes: z.array(unitTypeSchema).min(1).optional(),
    modifiers: z.object({
      at: modifier.optional(),
      df: modifier.optional(),
      mag: modifier.optional(),
      res: modifier.optional(),
      move: modifier.optional(),
      commandAt: modifier.optional(),
      commandDf: modifier.optional(),
      commandRadius: modifier.optional(),
      spellRange: modifier.optional(),
      maxMpMultiplier: z.number().int().positive().max(4).optional(),
      expMultiplier: z.literal(2).optional(),
      squadMove: modifier.optional(),
      squadRes: modifier.optional(),
      attackRange: z
        .tuple([
          z.number().int().nonnegative().max(63),
          z.number().int().nonnegative().max(63),
        ])
        .optional(),
    }),
    grantedSpellIds: z.array(z.string().min(1).max(128)),
    unavailableReason: z.string().min(1).max(1024).optional(),
    useEffect: z.literal("class-reset").optional(),
  })
  .superRefine((item, ctx) => {
    if (
      item.modifiers.attackRange &&
      item.modifiers.attackRange[0] > item.modifiers.attackRange[1]
    )
      ctx.addIssue({ code: "custom", message: "장비 공격 사거리 범위 오류" });
    if (new Set(item.grantedSpellIds).size !== item.grantedSpellIds.length)
      ctx.addIssue({ code: "custom", message: "장비 마법 ID 중복" });
    if (
      item.allowedUnitTypes &&
      new Set(item.allowedUnitTypes).size !== item.allowedUnitTypes.length
    )
      ctx.addIssue({ code: "custom", message: "장비 허용 병종 중복" });
  });
export const terrainSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
  costs: z.object({
    foot: z.number().int().positive().nullable(),
    mounted: z.number().int().positive().nullable(),
    flying: z.number().int().positive().nullable(),
    amphibious: z.number().int().positive().nullable(),
  }),
  defense: z.number().int(),
  recovery: z.number().int().nonnegative(),
  noLanding: z.boolean(),
  water: z.boolean(),
  destroyedTo: z.string().min(1).max(128).optional(),
});
export const enemyPlanSchema = z.object({
  commanderId: z.string().min(1),
  stages: z
    .array(
      z.object({
        fromRound: z.number().int().positive(),
        label: z
          .string()
          .min(1)
          .max(80)
          .refine((value) => value.trim().length > 0),
        target: positionSchema,
      }),
    )
    .min(1),
});
export const scenarioSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  width: z.number().int().positive().max(64),
  height: z.number().int().positive().max(64),
  tiles: z.array(z.string()),
  units: z.array(unitSchema),
  inventory: z
    .record(z.string().min(1).max(128), z.number().int().nonnegative())
    .optional(),
  seed: z.number().int().min(0).max(0xffffffff).optional(),
  enemyPlans: z.array(enemyPlanSchema).optional(),
  reinforcement: z.object({
    round: z.number().int().positive(),
    units: z.array(unitSchema),
    reserves: z.record(z.string(), z.array(positionSchema).min(1)).default({}),
  }),
  mission: z
    .object({
      protectedIds: z.array(z.string()).min(1),
      escortId: z.string(),
      route: z.array(positionSchema).min(2),
      escapeTiming: z.literal("immediate"),
      captureTiming: z.literal("roundEnd"),
      beacon: positionSchema,
      bonusDeadline: z.number().int().positive(),
      healthyEscapeHp: z.number().int().min(1).max(10),
      maxRounds: z.number().int().positive(),
      unitLimit: z.number().int().positive().max(42),
    })
    .optional(),
  markers: z.array(
    z.object({ id: z.string(), label: z.string(), pos: positionSchema }),
  ),
});
export const contentSchema = z
  .object({
    rulesVersion: z.string(),
    terrains: z.array(terrainSchema),
    spells: z.array(spellSchema),
    summons: z.array(summonSchema),
    items: z.array(itemSchema),
    classes: z.array(classSchema).min(1),
    growthProfiles: z.array(growthProfileSchema).min(1),
    scenario: scenarioSchema,
    affinities: z.array(
      z.object({
        from: unitTypeSchema,
        to: unitTypeSchema,
        percent: z.number().int().positive(),
      }),
    ),
  })
  .superRefine((content, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: "custom", message });
    const { scenario: s } = content;
    const terrainIds = new Set(content.terrains.map((t) => t.id));
    if (terrainIds.size !== content.terrains.length) fail("지형 ID 중복");
    for (const terrain of content.terrains)
      if (
        terrain.destroyedTo &&
        (!terrainIds.has(terrain.destroyedTo) ||
          terrain.destroyedTo === terrain.id)
      )
        fail(`지형 파괴 참조 오류: ${terrain.id}`);
    const spellIds = new Set(content.spells.map((spell) => spell.id));
    if (spellIds.size !== content.spells.length) fail("마법 ID 중복");
    const classIds = new Set(content.classes.map((job) => job.id));
    if (classIds.size !== content.classes.length) fail("직업 ID 중복");
    const growthIds = new Set(
      content.growthProfiles.map((profile) => profile.id),
    );
    if (growthIds.size !== content.growthProfiles.length)
      fail("성장 프로필 ID 중복");
    const learnableSpellIds = new Set(
      content.spells
        .filter((spell) => spell.learnable !== false)
        .map((spell) => spell.id),
    );
    const parentCount = new Map<string, number>();
    for (const job of content.classes) {
      if (job.range[0] > job.range[1]) fail(`직업 사거리 오류: ${job.id}`);
      if (new Set(job.promotions).size !== job.promotions.length)
        fail(`전직 경로 중복: ${job.id}`);
      const bonus = Object.values(job.statBonus).reduce(
        (sum, value) => sum + value,
        0,
      );
      if ((job.tier === 1 && bonus !== 0) || (job.tier === 2 && bonus !== 1))
        fail(`직업 보너스는 2차에서 능력치 하나 +1이어야 합니다: ${job.id}`);
      if (
        (job.tier === 1 && job.promotions.length === 0) ||
        (job.tier === 2 && job.promotions.length > 0)
      )
        fail(`직업 차수와 전직 경로 불일치: ${job.id}`);
      for (const promotion of job.promotions) {
        const target = content.classes.find((entry) => entry.id === promotion);
        if (job.tier !== 1 || target?.tier !== 2)
          fail(`전직 대상 참조 오류: ${job.id}`);
        parentCount.set(promotion, (parentCount.get(promotion) ?? 0) + 1);
      }
      const learned = new Set<string>();
      let lastLevel = 0;
      for (const entry of job.learns) {
        if (entry.level <= lastLevel)
          fail(`직업 학습 레벨 순서 오류: ${job.id}`);
        lastLevel = entry.level;
        for (const id of entry.spellIds) {
          if (!learnableSpellIds.has(id))
            fail(`직업 학습 마법 참조 오류: ${job.id}`);
          if (learned.has(id)) fail(`직업 학습 마법 중복: ${job.id}`);
          learned.add(id);
        }
      }
    }
    for (const job of content.classes)
      if (job.tier === 2 && parentCount.get(job.id) !== 1)
        fail(`2차 직업의 기본 직업은 하나여야 합니다: ${job.id}`);
    for (const profile of content.growthProfiles) {
      let lastLevel = 1;
      let total = 0;
      for (const entry of profile.levels) {
        if (entry.level <= lastLevel)
          fail(`고정 성장 레벨 순서 오류: ${profile.id}`);
        lastLevel = entry.level;
        if (Object.keys(entry.gains).length === 0)
          fail(`빈 성장 항목: ${profile.id}`);
        total +=
          (entry.gains.at ?? 0) +
          (entry.gains.df ?? 0) +
          (entry.gains.mag ?? 0) +
          (entry.gains.res ?? 0);
      }
      if (total > 4) fail(`일반 능력치 성장 합계 상한 4 초과: ${profile.id}`);
    }
    const summonIds = new Set(content.summons.map((summon) => summon.id));
    if (summonIds.size !== content.summons.length) fail("소환물 ID 중복");
    for (const summon of content.summons) {
      if (summon.range[0] > summon.range[1])
        fail(`소환물 사거리 범위 오류: ${summon.id}`);
      if (new Set(summon.spellIds).size !== summon.spellIds.length)
        fail(`소환물 마법 ID 중복: ${summon.id}`);
      if (summon.spellIds.some((id) => !spellIds.has(id)))
        fail(`소환물 마법 참조 오류: ${summon.id}`);
    }
    for (const spell of content.spells)
      if (spell.effect.summonId && !summonIds.has(spell.effect.summonId))
        fail(`소환 마법 참조 오류: ${spell.id}`);
    const itemIds = new Set(content.items.map((item) => item.id));
    if (itemIds.size !== content.items.length) fail("장비 ID 중복");
    for (const item of content.items) {
      if (item.grantedSpellIds.some((id) => !spellIds.has(id)))
        fail(`장비 마법 참조 오류: ${item.id}`);
      if (
        item.useEffect &&
        (Object.keys(item.modifiers).length > 0 ||
          item.grantedSpellIds.length > 0)
      )
        fail(`소모 아이템은 장착 보정을 가질 수 없습니다: ${item.id}`);
    }
    for (const id of Object.keys(s.inventory ?? {}))
      if (!itemIds.has(id)) fail(`소유 장비 참조 오류: ${id}`);
    if (s.tiles.length !== s.width * s.height) fail("타일 수와 맵 크기 불일치");
    if (s.tiles.some((t) => !terrainIds.has(t))) fail("정의되지 않은 지형");
    const all = [...s.units, ...s.reinforcement.units];
    if (new Set(all.map((u) => u.id)).size !== all.length) fail("유닛 ID 중복");
    if (all.length > 42) fail("동시 유닛 상한 초과");
    const inside = (p: Position) => p.x < s.width && p.y < s.height;
    const plans = s.enemyPlans ?? [];
    if (new Set(plans.map((plan) => plan.commanderId)).size !== plans.length)
      fail("적 행동 계획 지휘관 중복");
    for (const plan of plans) {
      const commander = all.find(
        (unit) =>
          unit.id === plan.commanderId &&
          unit.kind === "commander" &&
          unit.side === "enemy",
      );
      if (!commander)
        fail(`적 행동 계획 지휘관 참조 오류: ${plan.commanderId}`);
      const squad = all.filter(
        (unit) =>
          unit.id === plan.commanderId || unit.commanderId === plan.commanderId,
      );
      plan.stages.forEach((stage, index) => {
        const previous = plan.stages[index - 1];
        if (
          (index === 0 && stage.fromRound !== 1) ||
          (previous && stage.fromRound <= previous.fromRound) ||
          (s.mission && stage.fromRound > s.mission.maxRounds)
        )
          fail(`적 행동 계획 시간 오류: ${plan.commanderId}`);
        const terrain = content.terrains.find(
          (tile) =>
            tile.id === s.tiles[stage.target.y * s.width + stage.target.x],
        );
        if (
          !inside(stage.target) ||
          !terrain ||
          terrain.noLanding ||
          squad.some((unit) => terrain.costs[unit.moveType] === null)
        )
          fail(`적 행동 계획 목표 좌표 오류: ${plan.commanderId}`);
      });
    }
    for (const [id, positions] of Object.entries(s.reinforcement.reserves)) {
      const unit = s.reinforcement.units.find((u) => u.id === id);
      if (!unit) fail(`예비 배치 유닛 참조 오류: ${id}`);
      for (const pos of positions) {
        const tile = content.terrains.find(
          (t) => t.id === s.tiles[pos.y * s.width + pos.x],
        );
        if (
          !inside(pos) ||
          !tile ||
          tile.noLanding ||
          (unit && tile.costs[unit.moveType] === null)
        )
          fail(`예비 배치 좌표 오류: ${id}`);
      }
    }
    if (s.mission) {
      const m = s.mission;
      const escort = s.units.find(
        (u) => u.id === m.escortId && u.kind === "escort" && u.side === "npc",
      );
      if (
        !escort ||
        escort.pos.x !== m.route[0]!.x ||
        escort.pos.y !== m.route[0]!.y
      )
        fail("호송대 출발점 오류");
      if (
        !m.protectedIds.includes(m.escortId) ||
        new Set(m.protectedIds).size !== m.protectedIds.length ||
        m.protectedIds.some(
          (id) => !s.units.some((u) => u.id === id && u.side !== "enemy"),
        )
      )
        fail("보호 대상 참조 오류");
      if (
        !inside(m.beacon) ||
        m.bonusDeadline > m.maxRounds ||
        s.reinforcement.round >= m.maxRounds ||
        s.units.length > m.unitLimit
      )
        fail("목표 시간·배치 오류");
      const beaconTerrain = content.terrains.find(
        (t) => t.id === s.tiles[m.beacon.y * s.width + m.beacon.x],
      );
      if (
        !beaconTerrain ||
        beaconTerrain.noLanding ||
        beaconTerrain.costs.foot === null
      )
        fail("점령 불가 봉화");
      if (new Set(m.route.map((p) => `${p.x},${p.y}`)).size !== m.route.length)
        fail("호송 경로 중복");
      m.route.forEach((pos, i) => {
        const tile = content.terrains.find(
          (t) => t.id === s.tiles[pos.y * s.width + pos.x],
        );
        const prev = m.route[i - 1];
        if (
          !inside(pos) ||
          !tile ||
          tile.noLanding ||
          (escort && tile.costs[escort.moveType] === null) ||
          (prev && Math.abs(prev.x - pos.x) + Math.abs(prev.y - pos.y) !== 1)
        )
          fail("호송 경로 오류");
      });
    }
    for (const group of [s.units, s.reinforcement.units]) {
      if (
        new Set(group.map((u) => `${u.pos.x},${u.pos.y}`)).size !== group.length
      )
        fail("배치 중복");
      for (const u of group) {
        if (u.summon || u.refreshedRound !== undefined)
          fail(`시나리오 유닛에 전투 임시 상태 지정 불가: ${u.id}`);
        if (u.equipment) {
          if (u.kind !== "commander") fail(`지휘관만 장비 장착 가능: ${u.id}`);
          for (const slot of ["weapon", "armor"] as const) {
            const id = u.equipment[slot];
            if (id === null) continue;
            const item = content.items.find((value) => value.id === id);
            if (
              !item ||
              item.slot !== slot ||
              item.useEffect ||
              item.unavailableReason ||
              (item.allowedUnitTypes &&
                !item.allowedUnitTypes.includes(u.unitType))
            )
              fail(`장착 장비 참조·슬롯·제한 오류: ${u.id}`);
          }
        }
        if (u.progression) {
          const progression = u.progression;
          if (u.kind !== "commander" || u.side !== "player" || u.summon)
            fail(`정규 아군 지휘관만 성장 가능: ${u.id}`);
          const currentClass = content.classes.find(
            (entry) => entry.id === progression.classId,
          );
          const baseClass = content.classes.find(
            (entry) => entry.id === progression.baseClassId,
          );
          if (
            !currentClass ||
            baseClass?.tier !== 1 ||
            !growthIds.has(progression.growthId)
          )
            fail(`성장 직업·프로필 참조 오류: ${u.id}`);
          if (
            currentClass &&
            currentClass.id !== baseClass?.id &&
            !baseClass?.promotions.includes(currentClass.id)
          )
            fail(`성장 직업 계열 불일치: ${u.id}`);
          if (
            progression.classHistory.some(
              (id) =>
                !classIds.has(id) ||
                (id !== baseClass?.id && !baseClass?.promotions.includes(id)),
            )
          )
            fail(`전직 이력 참조 오류: ${u.id}`);
          if (
            progression.learnedSpellIds.some((id) => !learnableSpellIds.has(id))
          )
            fail(`성장 학습 마법 참조 오류: ${u.id}`);
        }
        if (new Set(u.spellIds).size !== u.spellIds.length)
          fail(`학습 마법 ID 중복: ${u.id}`);
        if (u.spellIds.some((id) => !spellIds.has(id)))
          fail(`정의되지 않은 학습 마법: ${u.id}`);
        if (u.kind !== "commander" && u.spellIds.length > 0)
          fail(`지휘관만 마법 학습 가능: ${u.id}`);
        if (!inside(u.pos)) fail(`맵 밖 유닛: ${u.id}`);
        const terrain = content.terrains.find(
          (t) => t.id === s.tiles[u.pos.y * s.width + u.pos.x],
        );
        if (
          terrain &&
          (terrain.noLanding || terrain.costs[u.moveType] === null)
        )
          fail(`진입 불가 배치: ${u.id}`);
        const mpMultiplier = Object.values(u.equipment ?? {}).reduce(
          (value, itemId) =>
            value *
            (content.items.find((item) => item.id === itemId)?.modifiers
              .maxMpMultiplier ?? 1),
          1,
        );
        if (u.mp > u.stats.maxMp * mpMultiplier || u.range[0] > u.range[1])
          fail(`능력치 범위 오류: ${u.id}`);
        if ((u.kind === "commander") !== (u.command !== null))
          fail(`지휘 정보 오류: ${u.id}`);
        if (u.kind === "mercenary") {
          const commander = group.find(
            (c) =>
              c.id === u.commanderId &&
              c.kind === "commander" &&
              c.side === u.side,
          );
          if (!commander) fail(`소속 지휘관 누락: ${u.id}`);
        } else if (u.commanderId !== null) fail(`잘못된 소속 지정: ${u.id}`);
      }
    }
    const worn = new Map<string, number>();
    for (const unit of s.units.filter((unit) => unit.side === "player"))
      for (const itemId of Object.values(unit.equipment ?? {}))
        if (itemId) worn.set(itemId, (worn.get(itemId) ?? 0) + 1);
    for (const [itemId, count] of worn)
      if ((s.inventory?.[itemId] ?? 0) < count)
        fail(`장착 수량이 소유 수량 초과: ${itemId}`);
    if (s.markers.some((m) => !inside(m.pos))) fail("목표 좌표가 맵 밖");
    if (
      new Set(content.affinities.map((a) => `${a.from}/${a.to}`)).size !==
      content.affinities.length
    )
      fail("상성 쌍 중복");
  });

export type Position = z.infer<typeof positionSchema>;
export type Unit = z.infer<typeof unitSchema>;
export type Content = z.infer<typeof contentSchema>;
export type Terrain = z.infer<typeof terrainSchema>;
export type EnemyPlan = z.infer<typeof enemyPlanSchema>;
export type Spell = z.infer<typeof spellSchema>;
export type StatusEffect = z.infer<typeof statusEffectSchema>;
export type Item = z.infer<typeof itemSchema>;
export type Summon = z.infer<typeof summonSchema>;
export type UnitProgression = z.infer<typeof unitProgressionSchema>;
export type ClassDefinition = z.infer<typeof classSchema>;
export type GrowthProfile = z.infer<typeof growthProfileSchema>;
export type GrowthGains = z.infer<typeof growthGainsSchema>;

export * from "./save";
