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
const statsSchema = z.object({
  at: z.number().int().nonnegative(),
  df: z.number().int().nonnegative(),
  res: z.number().int().nonnegative(),
  mag: z.number().int().nonnegative(),
  maxMp: z.number().int().nonnegative(),
  move: z.number().int().positive(),
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
  canHeal: z.boolean(),
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
});
export const scenarioSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  width: z.number().int().positive().max(64),
  height: z.number().int().positive().max(64),
  tiles: z.array(z.string()),
  units: z.array(unitSchema),
  reinforcement: z.object({
    round: z.number().int().positive(),
    units: z.array(unitSchema),
  }),
  markers: z.array(
    z.object({ id: z.string(), label: z.string(), pos: positionSchema }),
  ),
});
export const contentSchema = z
  .object({
    rulesVersion: z.string(),
    terrains: z.array(terrainSchema),
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
    if (s.tiles.length !== s.width * s.height) fail("타일 수와 맵 크기 불일치");
    if (s.tiles.some((t) => !terrainIds.has(t))) fail("정의되지 않은 지형");
    const all = [...s.units, ...s.reinforcement.units];
    if (new Set(all.map((u) => u.id)).size !== all.length) fail("유닛 ID 중복");
    if (all.length > 42) fail("동시 유닛 상한 초과");
    const inside = (p: Position) => p.x < s.width && p.y < s.height;
    for (const group of [s.units, s.reinforcement.units]) {
      if (
        new Set(group.map((u) => `${u.pos.x},${u.pos.y}`)).size !== group.length
      )
        fail("배치 중복");
      for (const u of group) {
        if (!inside(u.pos)) fail(`맵 밖 유닛: ${u.id}`);
        const terrain = content.terrains.find(
          (t) => t.id === s.tiles[u.pos.y * s.width + u.pos.x],
        );
        if (
          terrain &&
          (terrain.noLanding || terrain.costs[u.moveType] === null)
        )
          fail(`진입 불가 배치: ${u.id}`);
        if (u.mp > u.stats.maxMp || u.range[0] > u.range[1])
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
