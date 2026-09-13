import { content } from "@orden/content";
import { apply, createBattle, type BattleState } from "@orden/core";
import {
  battleSaveSchema,
  MAX_SAVE_BYTES,
  SAVE_SCHEMA_VERSION,
  type BattleSave,
  type SaveContinuation,
} from "@orden/schema";

export type { BattleSave, SaveContinuation } from "@orden/schema";
export {
  MAX_SAVE_BYTES,
  MAX_SAVE_COMMANDS,
  SAVE_SCHEMA_VERSION,
} from "@orden/schema";

const encoder = new TextEncoder();

/** Stable JSON ordering; rejects values JSON would otherwise silently discard. */
function canonicalStringify(input: unknown): string {
  const ancestors = new Set<object>();
  let nodes = 0;
  const visit = (value: unknown, depth: number): string => {
    if (++nodes > 200_000 || depth > 32)
      throw new Error("저장 데이터의 중첩 또는 항목 수가 너무 많습니다.");
    if (value === null) return "null";
    if (typeof value === "boolean") return String(value);
    if (typeof value === "number" && Number.isFinite(value))
      return JSON.stringify(value);
    if (typeof value === "string") {
      if (value.length > MAX_SAVE_BYTES)
        throw new Error("저장 파일은 2MiB 이하여야 합니다.");
      return JSON.stringify(value);
    }
    if (typeof value !== "object" || !value)
      throw new Error("저장 데이터에 JSON으로 표현할 수 없는 값이 있습니다.");
    if (ancestors.has(value))
      throw new Error("저장 데이터에 순환 참조가 있습니다.");
    ancestors.add(value);
    let result: string;
    if (Array.isArray(value)) {
      if (value.length > 200_000 || Object.keys(value).length !== value.length)
        throw new Error("저장 데이터의 배열 형식이 올바르지 않습니다.");
      result = `[${Array.from(value, (item) => visit(item, depth + 1)).join(",")}]`;
    } else {
      if (
        Object.getPrototypeOf(value) !== Object.prototype &&
        Object.getPrototypeOf(value) !== null
      )
        throw new Error("저장 데이터에 JSON 객체가 아닌 값이 있습니다.");
      const record = value as Record<string, unknown>;
      const keys = Object.keys(record).sort();
      if (Reflect.ownKeys(record).length !== keys.length)
        throw new Error("저장 데이터에 JSON에 없는 속성이 있습니다.");
      result = `{${keys.map((key) => `${JSON.stringify(key)}:${visit(record[key], depth + 1)}`).join(",")}}`;
    }
    ancestors.delete(value);
    if (result.length > MAX_SAVE_BYTES)
      throw new Error("저장 파일은 2MiB 이하여야 합니다.");
    return result;
  };
  return visit(input, 0);
}

function boundedJson(input: unknown): string {
  const text = canonicalStringify(input);
  if (encoder.encode(text).byteLength > MAX_SAVE_BYTES)
    throw new Error("저장 파일은 2MiB 이하여야 합니다.");
  return text;
}

/** FNV-1a detects accidental corruption; it is not authentication or anti-cheat. */
function hash(text: string): string {
  let value = 0x811c9dc5;
  for (const byte of encoder.encode(text)) {
    value ^= byte;
    value = Math.imul(value, 0x01000193);
  }
  return (value >>> 0).toString(16).padStart(8, "0");
}

export function checksumForSave(save: Omit<BattleSave, "checksum">): string {
  return hash(boundedJson(save));
}

const currentContentHash = hash(canonicalStringify(content));

function fail(message: string): never {
  throw new Error(message);
}

/** Checks a detached snapshot before callers replace any live or stored state. */
export function validateSave(input: unknown): BattleSave {
  boundedJson(input);
  if (typeof input !== "object" || !input || Array.isArray(input))
    fail("저장 파일은 전투 저장 객체여야 합니다.");
  const candidate = input as Record<string, unknown>;
  if (candidate.schemaVersion !== SAVE_SCHEMA_VERSION)
    fail("지원하지 않는 저장 형식 버전입니다.");
  if (candidate.rulesVersion !== content.rulesVersion)
    fail("현재 게임과 저장 파일의 규칙 버전이 다릅니다.");
  if (candidate.contentHash !== currentContentHash)
    fail("현재 게임과 저장 파일의 콘텐츠 버전이 다릅니다.");
  const parsed = battleSaveSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    fail(
      `저장 데이터 형식이 올바르지 않습니다${issue?.path.length ? ` (${issue.path.join(".")})` : ""}.`,
    );
  }
  const save = parsed.data;
  const { checksum, ...body } = save;
  if (checksumForSave(body) !== checksum)
    fail("저장 파일이 손상되었습니다. 체크섬이 일치하지 않습니다.");
  if (
    canonicalStringify(save.initialState) !==
    canonicalStringify(createBattle(content, save.initialState.mode))
  )
    fail("저장 파일의 초기 배치가 현재 시나리오와 다릅니다.");
  if (
    save.revision !== save.commands.length ||
    save.battle.revision !== save.revision
  )
    fail("저장 파일의 명령 개수와 revision이 일치하지 않습니다.");
  if (save.lastCommandId !== (save.commands.at(-1)?.commandId ?? null))
    fail("저장 파일의 마지막 명령 ID가 일치하지 않습니다.");
  if (
    canonicalStringify(save.commands) !==
    canonicalStringify(save.battle.commands)
  )
    fail("저장 파일의 전투 명령 기록이 일치하지 않습니다.");
  if (
    save.continuation.finishing &&
    (save.battle.activeSide !== "player" || save.battle.outcome)
  )
    fail("턴 종료 진행 정보가 현재 전투 페이즈와 일치하지 않습니다.");

  let replay = createBattle(content, save.initialState.mode);
  const commandIds = new Set<string>();
  for (const [index, command] of save.commands.entries()) {
    if (commandIds.has(command.commandId))
      fail("저장 파일에 중복 명령 ID가 있습니다.");
    commandIds.add(command.commandId);
    if (command.expectedRevision !== index)
      fail(`${index + 1}번째 명령의 revision이 올바르지 않습니다.`);
    const result = apply(content, replay, command);
    if (!result.ok)
      fail(`${index + 1}번째 저장 명령을 재현할 수 없습니다: ${result.error}`);
    replay = result.nextState;
  }
  if (canonicalStringify(replay) !== canonicalStringify(save.battle))
    fail("저장 파일의 전투 상태가 명령 재현 결과와 다릅니다.");
  return save;
}

export function createSave(
  state: BattleState,
  continuation: SaveContinuation = { finishing: false, autoFollow: true },
): BattleSave {
  const body: Omit<BattleSave, "checksum"> = {
    schemaVersion: SAVE_SCHEMA_VERSION,
    rulesVersion: content.rulesVersion,
    contentHash: currentContentHash,
    revision: state.revision,
    lastCommandId: state.commands.at(-1)?.commandId ?? null,
    initialState: createBattle(content, state.mode),
    commands: structuredClone(state.commands),
    battle: structuredClone(state),
    continuation: { ...continuation },
    updatedAt: new Date().toISOString(),
  };
  return validateSave({ ...body, checksum: checksumForSave(body) });
}

export function serializeSave(save: BattleSave): string {
  return boundedJson(validateSave(save));
}

/** Backup original JSON without interpreting its version, fields, or checksum. */
export function serializeStoredSave(input: unknown): string {
  return boundedJson(input);
}

export function parseSave(text: string): BattleSave {
  if (
    text.length > MAX_SAVE_BYTES ||
    encoder.encode(text).byteLength > MAX_SAVE_BYTES
  )
    fail("저장 파일은 2MiB 이하여야 합니다.");
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch {
    fail("저장 파일이 올바른 JSON 형식이 아닙니다.");
  }
  return validateSave(input);
}
