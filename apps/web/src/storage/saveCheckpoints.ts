import { content } from "@orden/content";
import { apply, canPrepare, type BattleState } from "@orden/core";
import { checksumForSave, validateSave, type BattleSave } from "./saveFormat";

let recent: { save: BattleSave; checkpoint: BattleSave | null } | undefined;

function checkpointSnapshot(
  source: BattleSave,
  state: BattleState,
): BattleSave {
  const { checksum: _checksum, ...body } = source;
  const checkpoint = {
    ...body,
    revision: state.revision,
    lastCommandId: state.commands.at(-1)?.commandId ?? null,
    commands: structuredClone(state.commands),
    battle: structuredClone(state),
    continuation: { ...source.continuation, finishing: false },
  };
  return validateSave({ ...checkpoint, checksum: checksumForSave(checkpoint) });
}

/**
 * A preparation checkpoint retains its complete verified command prefix. It is
 * never a trusted replacement initial state, so reward history is replayed too.
 */
export function preparationCheckpoint(input: BattleSave): BattleSave | null {
  const save = validateSave(input);
  if (canPrepare(save.battle)) {
    const checkpoint = checkpointSnapshot(save, save.battle);
    recent = { save, checkpoint };
    return structuredClone(checkpoint);
  }
  const reusable =
    recent &&
    JSON.stringify(recent.save.initialState) ===
      JSON.stringify(save.initialState) &&
    recent.save.commands.length <= save.commands.length &&
    recent.save.commands.every(
      (command, index) =>
        JSON.stringify(command) === JSON.stringify(save.commands[index]),
    );
  let state = structuredClone(
    reusable ? recent!.save.battle : save.initialState,
  );
  let checkpoint = reusable
    ? recent!.checkpoint
    : canPrepare(state)
      ? checkpointSnapshot(save, state)
      : null;
  let latestPreparation: BattleState | null = null;
  for (const command of save.commands.slice(state.commands.length)) {
    const result = apply(content, state, command);
    if (!result.ok)
      throw new Error(`출격 준비 기록을 재현할 수 없습니다: ${result.error}`);
    state = result.nextState;
    if (canPrepare(state)) latestPreparation = state;
  }
  // Only the final preparation prefix matters. Validating every intermediate
  // prefix would replay long equipment/hiring histories quadratically again.
  if (latestPreparation)
    checkpoint = checkpointSnapshot(save, latestPreparation);
  recent = { save, checkpoint };
  return checkpoint ? structuredClone(checkpoint) : null;
}
