import { z } from "zod";
import {
  statusEffectSchema,
  unitSchema,
  unitProgressionSchema,
  type Unit,
} from "./index";

export const SAVE_SCHEMA_VERSION = 1;
export const MAX_SAVE_COMMANDS = 1024;
export const MAX_SAVE_BYTES = 2 * 1024 * 1024;

const id = z.string().min(1).max(128);
const revision = z.number().int().nonnegative().max(MAX_SAVE_COMMANDS);
const side = z.enum(["player", "enemy", "npc"]);
const position = z
  .object({
    x: z.number().int().nonnegative().max(63),
    y: z.number().int().nonnegative().max(63),
  })
  .strict();

export const savedCommandSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("act"),
      commandId: id,
      expectedRevision: revision,
      unitId: id,
      path: z.array(position).max(4096),
      action: z.discriminatedUnion("type", [
        z.object({ type: z.literal("wait") }).strict(),
        z.object({ type: z.literal("treat") }).strict(),
        z.object({ type: z.literal("attack"), targetId: id }).strict(),
        z.object({ type: z.literal("heal"), targetId: id }).strict(),
        z
          .object({
            type: z.literal("cast"),
            spellId: id,
            target: position,
            destination: position.optional(),
          })
          .strict(),
      ]),
    })
    .strict(),
  z
    .object({
      type: z.literal("equip"),
      commandId: id,
      expectedRevision: revision,
      unitId: id,
      slot: z.enum(["weapon", "armor"]),
      itemId: id.nullable(),
    })
    .strict(),
  z
    .object({
      type: z.literal("train"),
      commandId: id,
      expectedRevision: revision,
      unitId: id,
      spellIds: z
        .array(id)
        .max(64)
        .refine((ids) => new Set(ids).size === ids.length, {
          message: "학습 마법 ID 중복",
        }),
    })
    .strict(),
  z
    .object({
      type: z.literal("endPhase"),
      commandId: id,
      expectedRevision: revision,
      side,
    })
    .strict(),
  z
    .object({
      type: z.literal("promote"),
      commandId: id,
      expectedRevision: revision,
      unitId: id,
      classId: id,
    })
    .strict(),
  z
    .object({
      type: z.literal("reclass"),
      commandId: id,
      expectedRevision: revision,
      unitId: id,
    })
    .strict(),
  z
    .object({
      type: z.literal("deploy"),
      commandId: id,
      expectedRevision: revision,
    })
    .strict(),
]);

// Resolve the shared content schema lazily because index.ts also exports saves.
// Every nested object is strict: imports must never silently drop corrupt fields.
const savedUnitSchema: z.ZodType<Unit> = z.lazy(() =>
  unitSchema
    .extend({
      id,
      commanderId: id.nullable(),
      pos: position,
      // Content may omit an empty list; saved snapshots must never fill it in.
      spellIds: z.array(id).refine((ids) => new Set(ids).size === ids.length, {
        message: "학습 마법 ID 중복",
      }),
      stats: unitSchema.shape.stats.strict(),
      command: unitSchema.shape.command.unwrap().strict().nullable(),
      equipment: z
        .object({ weapon: id.nullable(), armor: id.nullable() })
        .strict()
        .optional(),
      summon: z.object({ ownerId: id, templateId: id }).strict().optional(),
      progression: z.lazy(() => unitProgressionSchema.strict()).optional(),
    })
    .strict(),
);

const expAmount = z.number().int().min(0).max(1_000_000_000);
const uniqueIds = z
  .array(id)
  .max(4096)
  .refine((ids) => new Set(ids).size === ids.length, {
    message: "성장 기록 ID 중복",
  });
export const experienceContributionSchema = z
  .object({
    damage: expAmount,
    kills: expAmount,
    retreats: expAmount,
    healing: expAmount,
    clear: expAmount,
  })
  .strict();
const settlementEntrySchema = z
  .object({
    unitId: id,
    earned: experienceContributionSchema,
    awardedExp: expAmount,
    previousLevel: z.number().int().min(1).max(10),
    level: z.number().int().min(1).max(10),
    previousExp: z.number().int().min(0).max(100),
    exp: z.number().int().min(0).max(100),
    learnedSpellIds: uniqueIds,
    statGains: z
      .object({
        at: expAmount.optional(),
        df: expAmount.optional(),
        mag: expAmount.optional(),
        res: expAmount.optional(),
        maxMp: expAmount.optional(),
      })
      .strict(),
  })
  .strict()
  .superRefine((entry, ctx) => {
    if (
      (entry.previousLevel < 10 && entry.previousExp >= 100) ||
      (entry.level < 10 && entry.exp >= 100)
    )
      ctx.addIssue({ code: "custom", message: "정산 Lv10 미만 EXP 범위 오류" });
  });
export const savedProgressionSchema = z
  .object({
    roster: z
      .array(savedUnitSchema)
      .max(42)
      .refine(
        (units) => new Set(units.map((unit) => unit.id)).size === units.length,
        { message: "성장 명부 유닛 중복" },
      ),
    contributions: z.record(id, experienceContributionSchema),
    damageAwarded: z.record(id, z.number().int().min(0).max(20)),
    healingAwarded: z.record(id, z.number().int().min(0).max(30)),
    defeated: uniqueIds,
    lastDamageOwner: z.record(id, id),
    rewardedScenarioIds: uniqueIds,
    battleStartRevision: revision,
    settlement: z
      .object({
        scenarioId: id,
        outcome: z.enum(["victory", "defeat"]),
        duplicate: z.boolean(),
        entries: z
          .array(settlementEntrySchema)
          .max(42)
          .refine(
            (entries) =>
              new Set(entries.map((entry) => entry.unitId)).size ===
              entries.length,
            { message: "정산 지휘관 중복" },
          ),
      })
      .strict()
      .nullable(),
  })
  .strict();

export const savedBattleSchema = z
  .object({
    rulesVersion: id,
    revision,
    round: z.number().int().positive(),
    activeSide: side,
    units: z.array(savedUnitSchema).max(42),
    statuses: z.array(z.lazy(() => statusEffectSchema.strict())).max(378),
    terrainChanges: z.record(
      z
        .string()
        .regex(/^(?:[0-9]|[1-5][0-9]|6[0-3]),(?:[0-9]|[1-5][0-9]|6[0-3])$/),
      id,
    ),
    inventory: z.record(id, z.number().int().nonnegative().max(9999)),
    rngSeed: z.number().int().min(0).max(0xffffffff),
    progression: savedProgressionSchema,
    commands: z.array(savedCommandSchema).max(MAX_SAVE_COMMANDS),
    mission: z
      .object({
        capturedRound: z.number().int().positive().nullable(),
        reinforcement: z.enum([
          "scheduled",
          "deferred",
          "spawned",
          "cancelled",
        ]),
      })
      .strict(),
    outcome: z
      .object({
        status: z.enum(["victory", "defeat"]),
        reason: z.string().min(1).max(4096),
        round: z.number().int().positive(),
        bonuses: z.array(z.string().min(1).max(128)).max(64),
      })
      .strict()
      .nullable(),
  })
  .strict();

export const saveContinuationSchema = z
  .object({
    finishing: z.boolean(),
    autoFollow: z.boolean(),
  })
  .strict();

export const battleSaveSchema = z
  .object({
    schemaVersion: z.literal(SAVE_SCHEMA_VERSION),
    rulesVersion: id,
    contentHash: z.string().regex(/^[0-9a-f]{8}$/),
    revision,
    lastCommandId: id.nullable(),
    initialState: savedBattleSchema,
    commands: z.array(savedCommandSchema).max(MAX_SAVE_COMMANDS),
    battle: savedBattleSchema,
    continuation: saveContinuationSchema,
    updatedAt: z.string().datetime(),
    checksum: z.string().regex(/^[0-9a-f]{8}$/),
  })
  .strict();

export type BattleSave = z.infer<typeof battleSaveSchema>;
export type SaveContinuation = z.infer<typeof saveContinuationSchema>;
export type BattleProgression = z.infer<typeof savedProgressionSchema>;
export type ExperienceContribution = z.infer<
  typeof experienceContributionSchema
>;
