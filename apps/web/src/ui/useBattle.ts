import { magicEventText } from "./magicText";
import type { BattleAnimation } from "../game/BattleAnimation";
import { useEffect, useMemo, useRef, useState } from "react";
import { content } from "@orden/content";
import {
  createCurrentBattleSaveStore,
  type StoredSaveSlot,
  type StoredSlotInfo,
  type ManualSaveSlot,
  type ManagedSaveSlot,
} from "../storage/battleSaveStore";
import {
  createSave,
  MAX_SAVE_BYTES,
  parseSave,
  serializeSave,
  serializeStoredSave,
  type BattleSave,
  type SaveContinuation,
} from "../storage/saveFormat";
import { MAX_SAVE_COMMANDS } from "@orden/schema";
import {
  apply,
  createBattle,
  evaluate,
  knownSpells,
  spellArea,
  spellTargetTiles,
  nextEnemyCommand,
  nextNpcCommand,
  type EquipmentSlot,
  nextFollowerCommand,
  phaseEndCommand,
  reachable,
  samePosition,
  type Action,
  type ActCommand,
  type BattleEvent,
  type Command,
  type Position,
  type BattleState,
} from "@orden/core";

function downloadJson(text: string, filename: string) {
  const url = URL.createObjectURL(
    new Blob([text], { type: "application/json" }),
  );
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export function useBattle() {
  const [state, setState] = useState(() => {
    let mode: "practice" | "operation" = "practice";
    try {
      if (localStorage.getItem("orden-play-mode") === "operation")
        mode = "operation";
    } catch {
      /* Optional preference. */
    }
    return createBattle(content, mode);
  });
  const current = useRef(state);
  const [selectedId, setSelectedId] = useState("A2");
  const [destination, setDestination] = useState<Position | null>(null);
  const [action, setAction] = useState<Action>({ type: "wait" });
  const [spellId, setSpellId] = useState<string | null>(null);
  const [spellAnchor, setSpellAnchor] = useState<Position | null>(null);
  const [showEquipment, setShowEquipment] = useState(false);
  const [showGrowth, setShowGrowth] = useState(false);
  const [showOperation, setShowOperation] = useState(false);
  const [preparationError, setPreparationError] = useState("");
  const [spellMenuOpen, setSpellMenuOpen] = useState(false);
  const [message, setMessage] = useState("부대를 선택하십시오.");
  const [feedback, setFeedback] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [combatMode, setCombatMode] = useState<"simple" | "detailed">(() => {
    try {
      return localStorage.getItem("orden-combat-mode") === "detailed"
        ? "detailed"
        : "simple";
    } catch {
      return "simple";
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("orden-combat-mode", combatMode);
    } catch {
      /* Rendering preferences are optional when storage is unavailable. */
    }
  }, [combatMode]);
  const [fast, setFast] = useState(false);
  const [enemyActor, setEnemyActor] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [autoFollow, setAutoFollow] = useState(true);
  const [animation, setAnimation] = useState<BattleAnimation | null>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [saveStore, setSaveStore] = useState(() =>
    createCurrentBattleSaveStore(state.mode),
  );
  const [saveSlots, setSaveSlots] = useState<StoredSlotInfo[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsError, setSlotsError] = useState("");
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [showSaves, setShowSaves] = useState(false);
  const [saveStatus, setSaveStatus] = useState("저장 확인 중…");
  const [saveError, setSaveError] = useState("");
  const [saveNotice, setSaveNotice] = useState("");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const saveGeneration = useRef(0);
  const preserveUnreadSave = useRef(false);
  const session = useRef(0);
  const restore = (save: BattleSave) => {
    const restored = structuredClone(save.battle);
    session.current++;
    current.current = restored;
    setState(restored);
    setFinishing(
      save.revision < MAX_SAVE_COMMANDS && save.continuation.finishing,
    );
    setAutoFollow(save.continuation.autoFollow);
    setAnimation(null);
    setSelectedId(restored.units.find((u) => u.side === "player")?.id ?? "");
    setDestination(null);
    setAction({ type: "wait" });
    setSpellId(null);
    setSpellAnchor(null);
    setSpellMenuOpen(false);
    setEnemyActor(null);
    setConfirmEnd(false);
    setHistory([]);
    setFeedback("");
    setMessage("저장된 전투를 이어갑니다.");
  };
  useEffect(() => {
    let cancelled = false;
    void saveStore
      .load()
      .then(async (loaded) => {
        if (cancelled) return;
        if (loaded.save) {
          restore(loaded.save);
          setSavedAt(loaded.save.updatedAt);
          setSaveStatus(
            loaded.recoveredPrevious ? "직전 저장 복구" : "저장 복구 완료",
          );
        } else {
          const legacy = await saveStore.readLegacyRaw("latest");
          const legacyPrevious = await saveStore.readLegacyRaw("previous");
          if (cancelled) return;
          setSaveStatus(
            loaded.warning
              ? "저장 확인 실패"
              : legacy !== undefined || legacyPrevious !== undefined
                ? "새 전투 · 이전 버전 원본 보존"
                : "새 전투 · 아직 저장 없음",
          );
          if (legacy !== undefined || legacyPrevious !== undefined)
            setSaveNotice(
              "이전 버전 기록은 별도로 보존됩니다. 아래 이전 버전 원본 백업에서 내보낼 수 있습니다.",
            );
          preserveUnreadSave.current = !!loaded.warning;
        }
        setSaveError(loaded.warning ?? "");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        preserveUnreadSave.current = true;
        setSaveStatus("저장 확인 실패");
        setSaveError(
          error instanceof Error ? error.message : "저장소를 열 수 없습니다.",
        );
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [saveStore]);
  const refreshSlots = async () => {
    setSlotsLoading(true);
    setSlotsError("");
    try {
      setSaveSlots(await saveStore.listSlots());
    } catch (error) {
      setSlotsError(
        error instanceof Error ? error.message : "저장 목록을 읽지 못했습니다.",
      );
    } finally {
      setSlotsLoading(false);
    }
  };
  useEffect(() => {
    if (showSaves && ready) void refreshSlots();
  }, [showSaves, ready, saveStore]);
  // Persist each committed boundary before allowing the next automatic command.
  // A failed write leaves play available and the failure visible for file backup.
  const persist = async (next: BattleState, continuation: SaveContinuation) => {
    if (preserveUnreadSave.current) {
      setSaveStatus("자동 저장 중지");
      return;
    }
    const generation = ++saveGeneration.current;
    setSaving(true);
    setSaveStatus("저장 중…");
    try {
      const save = createSave(next, continuation);
      await saveStore.write(save);
      if (generation !== saveGeneration.current) return;
      setSavedAt(save.updatedAt);
      setSaveStatus("자동 저장 완료");
      setSaveError("");
    } catch (error) {
      if (generation !== saveGeneration.current) return;
      setSaveStatus("저장 실패 · 파일 백업 가능");
      setSaveError(
        error instanceof Error ? error.message : "저장에 실패했습니다.",
      );
    } finally {
      if (generation === saveGeneration.current) setSaving(false);
    }
  };
  const unit = state.units.find((u) => u.id === selectedId);
  const commandLimit = state.commands.length >= MAX_SAVE_COMMANDS;
  const operationPreparing = state.operation?.phase === "preparation";
  const busy =
    !ready ||
    saving ||
    restoring ||
    showSaves ||
    showEquipment ||
    showGrowth ||
    showOperation ||
    operationPreparing ||
    commandLimit ||
    state.activeSide !== "player" ||
    !!state.outcome ||
    finishing ||
    !!animation;
  const canAct = !busy && unit?.side === "player" && !unit.acted;
  const spells = unit ? knownSpells(content, unit) : [];
  const healingSpell = spells.find((spell) => spell.effect.type === "heal");
  const selectedSpell =
    spells.find((spell) => spell.id === spellId) ??
    (action.type === "heal" ? healingSpell : undefined);
  const spellCenter =
    action.type === "cast"
      ? action.target
      : action.type === "heal"
        ? action.targetId === unit?.id
          ? (destination ?? unit.pos)
          : state.units.find((target) => target.id === action.targetId)?.pos
        : undefined;
  const spellCenters =
    canAct && unit && selectedSpell
      ? spellTargetTiles(content, unit, selectedSpell, destination ?? unit.pos)
      : [];
  const spellTiles =
    canAct && unit && selectedSpell && spellCenter
      ? spellArea(
          content,
          selectedSpell,
          spellCenter,
          state,
          unit,
          destination ?? unit.pos,
        )
      : [];
  const remaining = state.units.filter(
    (u) => u.side === "player" && !u.acted,
  ).length;
  const moves = useMemo(
    () => (unit && canAct ? reachable(content, state, unit) : []),
    [state, unit, canAct],
  );
  const move = destination
    ? moves.find((r) => samePosition(r.pos, destination))
    : undefined;
  const command: ActCommand | null =
    unit && move && (!spellId || action.type === "cast")
      ? {
          type: "act",
          commandId: `action-${state.revision + 1}`,
          expectedRevision: state.revision,
          unitId: unit.id,
          path: move.path,
          action,
        }
      : null;
  const preview = command ? evaluate(content, state, command) : null;
  const cancel = () => {
    setDestination(null);
    setAction({ type: "wait" });
    setSpellId(null);
    setSpellAnchor(null);
    setSpellMenuOpen(false);
  };
  const recordEvents = (
    before: BattleState,
    after: BattleState,
    events: BattleEvent[],
  ) => {
    const lines = events.flatMap((event) => {
      if (event.type === "scenario") return [event.message];
      if (event.type === "phaseStarted")
        return [
          `제 ${event.round} 턴 · ${event.side === "player" ? "아군" : event.side === "enemy" ? "적군" : "중립"} 페이즈`,
        ];
      if (event.type === "spellCast")
        return [
          `${before.units.find((u) => u.id === event.unitId)?.name ?? event.unitId}: ${content.spells.find((s) => s.id === event.spellId)?.name ?? event.spellId} 시전`,
        ];
      const special = magicEventText(content, before, after, event);
      if (special) return [special];
      if (!("unitId" in event)) return [];
      const name =
        before.units.find((u) => u.id === event.unitId)?.name ?? event.unitId;
      if (event.type === "damaged" && event.amount)
        return [`${name} 피해 ${event.amount}`];
      if (event.type === "healed" && event.amount)
        return [`${name} 회복 ${event.amount}`];
      if (event.type === "removed")
        return [
          `${name} ${event.reason === "retreated" ? "퇴각" : "전투불능"}`,
        ];
      return [];
    });
    if (lines.length)
      setHistory((old) => [...lines.reverse(), ...old].slice(0, 60));
  };
  // The synchronous ref prevents duplicate clicks and old timers from applying to a stale render.
  const dispatch = (cmd: Command) => {
    const before = current.current;
    const result = apply(content, before, cmd);
    if (!result.ok) {
      setMessage(result.error);
      return false;
    }
    current.current = result.nextState;
    setState(result.nextState);
    void persist(result.nextState, {
      finishing:
        finishing &&
        result.nextState.activeSide === "player" &&
        !result.nextState.outcome,
      autoFollow,
    });
    recordEvents(before, result.nextState, result.events);
    if (cmd.type === "act" && cmd.commandId.startsWith("follow-")) {
      const name =
        before.units.find((u) => u.id === cmd.unitId)?.name ?? cmd.unitId;
      setHistory((old) =>
        [
          `${name} 자동 ${cmd.action.type === "attack" ? "공격" : cmd.path.length ? "추종 이동" : "대기"}`,
          ...old,
        ].slice(0, 60),
      );
    }
    setFeedback(
      result.events
        .flatMap((e) => {
          if (e.type === "spellCast")
            return [
              content.spells.find((s) => s.id === e.spellId)?.name ?? e.spellId,
            ];
          const special = magicEventText(content, before, result.nextState, e);
          if (special) return [special];
          if (e.type !== "damaged" && e.type !== "healed") return [];
          const name =
            before.units.find((u) => u.id === e.unitId)?.name ?? e.unitId;
          return [
            `${name} ${e.type === "damaged" ? `피해 ${e.amount}` : `회복 +${e.amount}`}`,
          ];
        })
        .join(" · ") || "부대 이동",
    );
    if (
      result.events.some(
        (e) =>
          e.type === "spellCast" ||
          e.type === "moved" ||
          e.type === "damaged" ||
          (e.type === "healed" && e.amount > 0),
      )
    ) {
      const detailed =
        combatMode === "detailed" &&
        cmd.type === "act" &&
        (cmd.action.type === "attack" ||
          cmd.action.type === "heal" ||
          cmd.action.type === "cast");
      const moved = result.events.some((e) => e.type === "moved");
      setAnimation({
        id: result.nextState.revision,
        before,
        after: result.nextState,
        detailed,
        command: cmd,
        events: result.events,
        moveMs: !detailed && moved ? (fast ? 80 : 240) : 0,
        impactMs: detailed ? (fast ? 1500 : 4200) : fast ? 140 : 420,
      });
    }
    return true;
  };
  useEffect(() => {
    if (!animation) return;
    const timer = window.setTimeout(
      () => setAnimation((old) => (old === animation ? null : old)),
      animation.moveMs + animation.impactMs + 60,
    );
    return () => window.clearTimeout(timer);
  }, [animation]);
  useEffect(() => {
    if (
      !ready ||
      saving ||
      restoring ||
      showSaves ||
      showEquipment ||
      showGrowth ||
      showOperation ||
      animation
    )
      return;
    if (commandLimit || operationPreparing) {
      setEnemyActor(null);
      setFinishing(false);
      if (commandLimit)
        setMessage(
          "명령 기록 상한에 도달했습니다. 저장·복구에서 백업하거나 준비 상태를 불러오세요.",
        );
      return;
    }
    if ((state.activeSide === "player" && !finishing) || state.outcome) {
      setEnemyActor(null);
      return;
    }
    const timer = window.setTimeout(
      () => {
        if (current.current !== state) return;
        const cmd =
          state.activeSide === "player" && autoFollow
            ? (nextFollowerCommand(content, state) ?? phaseEndCommand(state))
            : state.activeSide === "enemy"
              ? nextEnemyCommand(content, state)
              : state.activeSide === "npc"
                ? nextNpcCommand(content, state)
                : phaseEndCommand(state);
        if (!cmd) return;
        if (cmd.type === "endPhase" && state.activeSide === "player")
          setFinishing(false);
        if (cmd.type === "act") {
          setEnemyActor(cmd.unitId);
          setMessage(
            `${state.units.find((u) => u.id === cmd.unitId)?.name ?? "적군"} 행동 중…`,
          );
        } else
          setMessage(
            state.activeSide === "npc"
              ? "아군 턴입니다. 부대를 선택하십시오."
              : "페이즈를 진행합니다.",
          );
        dispatch(cmd);
      },
      fast ? 45 : 240,
    );
    return () => window.clearTimeout(timer);
    // Only state and speed restart the timer; selection and transient UI do not.
  }, [
    state,
    fast,
    finishing,
    autoFollow,
    animation,
    ready,
    saving,
    restoring,
    showSaves,
    showEquipment,
    showGrowth,
    showOperation,
    commandLimit,
    operationPreparing,
  ]);
  const select = (id: string) => {
    if (busy) return;
    setSelectedId(id);
    cancel();
    setMessage("이동할 칸 또는 공격 대상을 선택하십시오.");
  };
  const commit = () => {
    if (busy || !command) return;
    if (dispatch(command)) {
      setMessage(`${unit!.name} 행동 완료.`);
      cancel();
    }
  };
  const finishTurn = () => {
    if (
      busy ||
      current.current.activeSide !== "player" ||
      current.current.outcome
    )
      return;
    cancel();
    setConfirmEnd(false);
    setFinishing(true);
    void persist(current.current, { finishing: true, autoFollow });
    setMessage(
      autoFollow
        ? "미행동 용병이 지휘관을 따라 행동합니다."
        : "아군 턴을 종료합니다.",
    );
  };
  const requestEnd = () => {
    if (busy) return;
    cancel();
    if (remaining) setConfirmEnd(true);
    else finishTurn();
  };
  const reset = () => {
    if (!ready || restoring) return;
    if (
      current.current.mode === "operation" &&
      !window.confirm(
        "현재 정식 출격 기록을 처음부터 시작합니다. 필요한 진행은 저장 슬롯이나 파일에 보관하세요. 초기화할까요?",
      )
    )
      return;
    session.current++;
    preserveUnreadSave.current = false;
    const initial = createBattle(content, current.current.mode);
    current.current = initial;
    setState(initial);
    setAnimation(null);
    setFinishing(false);
    setSelectedId("A2");
    cancel();
    setHistory([]);
    setEnemyActor(null);
    setConfirmEnd(false);
    setMessage("초기 배치로 돌아왔습니다.");
    void persist(initial, { finishing: false, autoFollow });
  };
  const switchMode = async () => {
    if (!ready || saving || restoring || animation || finishing) return;
    if (preserveUnreadSave.current) {
      setSaveNotice(
        "현재 진행을 안전하게 보관한 뒤 모드를 전환하세요. 기존 저장 원본을 백업하고 현재 전투 다시 저장을 이용할 수 있습니다.",
      );
      setShowSaves(true);
      return;
    }
    if (saveError || !savedAt) {
      setRestoring(true);
      try {
        await saveStore.write(
          createSave(current.current, { finishing, autoFollow }),
        );
      } catch (error) {
        setSaveNotice(
          error instanceof Error
            ? error.message
            : "현재 진행을 저장하지 못해 모드 전환을 멈췄습니다.",
        );
        setShowSaves(true);
        return;
      } finally {
        setRestoring(false);
      }
    }
    const mode = state.mode === "operation" ? "practice" : "operation";
    session.current++;
    saveGeneration.current++;
    preserveUnreadSave.current = false;
    const initial = createBattle(content, mode);
    current.current = initial;
    setState(initial);
    setReady(false);
    setShowOperation(false);
    setFinishing(false);
    setEnemyActor(null);
    setAnimation(null);
    setConfirmEnd(false);
    setHistory([]);
    setSaveSlots([]);
    setSavedAt(null);
    setSaveError("");
    setSaveNotice("");
    setPreparationError("");
    cancel();
    setSaveStore(createCurrentBattleSaveStore(mode));
    try {
      localStorage.setItem("orden-play-mode", mode);
    } catch {
      /* Optional preference. */
    }
    setMessage(
      mode === "operation"
        ? "정식 출격 기록입니다. 출격 준비에서 편성을 확인하세요."
        : "연습 기록으로 돌아왔습니다.",
    );
  };
  const exportSave = () => {
    try {
      const save = createSave(current.current, { finishing, autoFollow });
      downloadJson(
        serializeSave(save),
        `orden-round-${save.battle.round}-rev-${save.revision}.json`,
      );
      setSaveNotice("현재 전투를 파일로 내보냈습니다.");
    } catch (error) {
      setSaveNotice(
        error instanceof Error ? error.message : "파일을 내보낼 수 없습니다.",
      );
    }
  };
  const exportStoredSave = async (slot: StoredSaveSlot, legacy = false) => {
    if (!ready || saving || restoring) return;
    setSaveNotice("");
    const label = slot === "latest" ? "최신" : "직전";
    try {
      const original =
        legacy && (slot === "latest" || slot === "previous")
          ? await saveStore.readLegacyRaw(slot)
          : await saveStore.readRaw(slot);
      if (original === undefined)
        throw new Error(`백업할 기존 ${label} 저장이 없습니다.`);
      downloadJson(serializeStoredSave(original), `original-save-${slot}.json`);
      setSaveNotice(`기존 ${label} 저장 원본을 파일로 내보냈습니다.`);
    } catch (error) {
      setSaveNotice(
        error instanceof Error
          ? error.message
          : "기존 저장 원본을 내보낼 수 없습니다. 기존 저장은 보존했습니다.",
      );
    }
  };
  const loadSave = async (file?: File, slot?: ManagedSaveSlot) => {
    if (!ready || saving || restoring) return;
    const expectedSession = session.current;
    setRestoring(true);
    setSaveNotice("");
    try {
      if (file && file.size > MAX_SAVE_BYTES)
        throw new Error("저장 파일은 2MiB 이하여야 합니다.");
      const save = file
        ? parseSave(await file.text())
        : slot
          ? await saveStore.loadSlot(slot)
          : await saveStore.loadPrevious();
      if (!save) throw new Error("복구할 저장이 없습니다.");
      if (save.battle.mode !== current.current.mode)
        throw new Error(
          "다른 모드의 파일입니다. 연습/정식 기록을 먼저 전환한 뒤 가져오세요.",
        );
      if (session.current !== expectedSession) return;
      // Validate and commit to disk before replacing the live battle.
      await saveStore.write(save);
      if (session.current !== expectedSession) return;
      preserveUnreadSave.current = false;
      restore(save);
      setSavedAt(save.updatedAt);
      setSaveStatus("저장 복구 완료");
      setSaveError("");
      setSaveNotice(
        file
          ? "파일의 전투를 불러왔습니다. 창을 닫으면 이어갑니다."
          : slot
            ? "선택한 저장을 복구했습니다. 창을 닫으면 이어갑니다."
            : "직전 저장을 복구했습니다. 창을 닫으면 이어갑니다.",
      );
      await refreshSlots();
    } catch (error) {
      setSaveNotice(
        error instanceof Error ? error.message : "전투를 불러올 수 없습니다.",
      );
    } finally {
      setRestoring(false);
    }
  };
  const saveManual = async (slot: ManualSaveSlot) => {
    if (!ready || saving || restoring) return;
    setRestoring(true);
    setSaveNotice("");
    try {
      await saveStore.saveManual(
        slot,
        createSave(current.current, { finishing, autoFollow }),
      );
      setSaveNotice("선택한 슬롯에 현재 진행을 저장했습니다.");
      await refreshSlots();
    } catch (error) {
      setSaveNotice(
        error instanceof Error ? error.message : "슬롯 저장에 실패했습니다.",
      );
    } finally {
      setRestoring(false);
    }
  };
  const onTile = (pos: Position) => {
    if (busy || confirmEnd) return;
    const target = state.units.find((u) => samePosition(u.pos, pos));
    if (canAct && unit && spellId) {
      setDestination(destination ?? unit.pos);
      if (selectedSpell?.effect.type === "teleport") {
        if (!spellAnchor) {
          setSpellAnchor(pos);
          setAction({ type: "cast", spellId, target: pos });
          setMessage("도착 칸을 선택하십시오.");
        } else
          setAction({
            type: "cast",
            spellId,
            target: spellAnchor,
            destination: pos,
          });
      } else setAction({ type: "cast", spellId, target: pos });
      return;
    }
    if (canAct && action.type === "heal" && unit && healingSpell) {
      if (target) {
        setDestination(destination ?? unit.pos);
        setAction({ type: "heal", targetId: target.id });
      } else setMessage("회복할 아군이 있는 칸을 선택하십시오.");
      return;
    }
    if (target && target.side !== "enemy") {
      select(target.id);
    } else if (target && canAct && unit) {
      setDestination(destination ?? unit.pos);
      setAction({ type: "attack", targetId: target.id });
    } else if (target) select(target.id);
    else if (canAct && moves.some((r) => samePosition(r.pos, pos))) {
      setDestination(pos);
      setAction({ type: "wait" });
    } else {
      cancel();
      setMessage(`(${pos.x}, ${pos.y})에는 이동할 수 없습니다.`);
    }
  };
  const prepare = (type: "wait" | "treat" | "heal") => {
    if (!unit || !canAct) return;
    setSpellId(null);
    setSpellAnchor(null);
    setSpellMenuOpen(false);
    setDestination(type === "treat" ? unit.pos : (destination ?? unit.pos));
    setAction(type === "heal" ? { type, targetId: unit.id } : { type });
    if (type === "heal") setMessage("회복할 아군을 선택하십시오.");
  };
  const prepareSpell = (id: string) => {
    if (!unit || !canAct) return;
    const spell = spells.find((entry) => entry.id === id);
    if (!spell) return;
    setSpellId(id);
    setSpellAnchor(null);
    setSpellMenuOpen(false);
    setDestination(destination ?? unit.pos);
    setAction({ type: "wait" });
    setMessage(
      `${spell.name}: 빛나는 사거리 안에서 대상 중심 칸을 선택하십시오.`,
    );
  };
  const prepareCommand = (command: Command) => {
    if (
      !ready ||
      saving ||
      restoring ||
      animation ||
      current.current.revision !== command.expectedRevision
    )
      return;
    const result = evaluate(content, current.current, command);
    if (!result.ok) {
      setPreparationError(result.error);
      return false;
    }
    setPreparationError("");
    cancel();
    return dispatch(command);
  };
  const equip = (unitId: string, slot: EquipmentSlot, itemId: string | null) =>
    prepareCommand({
      type: "equip",
      commandId: `equip-${current.current.revision + 1}`,
      expectedRevision: current.current.revision,
      unitId,
      slot,
      itemId,
    });
  const train = (unitId: string, spellIds: string[]) =>
    prepareCommand({
      type: "train",
      commandId: `train-${current.current.revision + 1}`,
      expectedRevision: current.current.revision,
      unitId,
      spellIds,
    });
  const promote = (unitId: string, classId: string) =>
    prepareCommand({
      type: "promote",
      commandId: `promote-${current.current.revision + 1}`,
      expectedRevision: current.current.revision,
      unitId,
      classId,
    });
  const reclass = (unitId: string) =>
    prepareCommand({
      type: "reclass",
      commandId: `reclass-${current.current.revision + 1}`,
      expectedRevision: current.current.revision,
      unitId,
    });
  const mastery = (unitId: string, masteryId: string | null) =>
    prepareCommand({
      type: "mastery",
      commandId: `mastery-${current.current.revision + 1}`,
      expectedRevision: current.current.revision,
      unitId,
      masteryId,
    });
  const hire = (unitId: string, templateId: string | null) =>
    prepareCommand({
      type: "hire",
      commandId: `hire-${current.current.revision + 1}`,
      expectedRevision: current.current.revision,
      unitId,
      templateId,
    });
  const trade = (type: "buy" | "sell", itemId: string) =>
    prepareCommand({
      type,
      commandId: `${type}-${current.current.revision + 1}`,
      expectedRevision: current.current.revision,
      itemId,
      quantity: 1,
    });
  const startBattle = () => {
    if (
      prepareCommand({
        type: "startBattle",
        commandId: `start-${current.current.revision + 1}`,
        expectedRevision: current.current.revision,
      })
    ) {
      setShowOperation(false);
      setMessage("출격했습니다. 부대를 선택하십시오.");
    }
  };
  const deploy = () => {
    if (
      !prepareCommand({
        type: "deploy",
        commandId: `deploy-${current.current.revision + 1}`,
        expectedRevision: current.current.revision,
      })
    )
      return;
    session.current++;
    setFinishing(false);
    setAnimation(null);
    setEnemyActor(null);
    setConfirmEnd(false);
    setSelectedId(current.current.progression.roster[0]?.id ?? "A1");
    setShowGrowth(false);
    setMessage(
      current.current.mode === "operation"
        ? "다음 출격을 준비합니다. 고용·장비·마법을 확인하세요."
        : "성장한 부대로 다시 연습합니다. 장비와 마법을 준비하세요.",
    );
    if (current.current.mode === "operation") setShowOperation(true);
  };
  const nextUnit = () => {
    const available = state.units.filter(
      (u) => u.side === "player" && !u.acted,
    );
    const index = available.findIndex((u) => u.id === selectedId);
    const next = available[(index + 1) % available.length];
    if (next) select(next.id);
  };
  return {
    ready,
    saving,
    restoring,
    showSaves,
    setShowSaves,
    showEquipment,
    setShowEquipment,
    showGrowth,
    setShowGrowth,
    promote,
    reclass,
    mastery,
    hire,
    trade,
    startBattle,
    switchMode,
    showOperation,
    setShowOperation,
    operationPreparing,
    commandLimit,
    saveSlots,
    slotsLoading,
    slotsError,
    saveManual,
    deploy,
    preparationError,
    equip,
    train,
    spellAnchor,
    spellDestination: action.type === "cast" ? action.destination : undefined,
    saveStatus,
    saveError,
    saveNotice,
    savedAt,
    exportSave,
    exportStoredSave,
    loadSave,
    retrySave: () => {
      preserveUnreadSave.current = false;
      void persist(current.current, { finishing, autoFollow });
    },
    state,
    unit,
    selectedId,
    destination,
    moves,
    preview,
    spells,
    healingSpell,
    selectedSpell,
    spellCenter,
    spellCenters,
    spellTiles:
      selectedSpell?.effect.type === "teleport" && preview?.ok
        ? preview.events.flatMap((event) =>
            event.type === "teleported" ? [event.to] : [],
          )
        : spellTiles,
    spellMenuOpen,
    setSpellMenuOpen,
    prepareSpell,
    busy,
    finishing,
    animation,
    combatMode,
    setCombatMode,
    skipAnimation: () =>
      setAnimation((old) => (old === animation ? null : old)),
    autoFollow,
    setAutoFollow,
    canAct,
    remaining,
    message,
    feedback,
    history,
    fast,
    setFast,
    enemyActor,
    confirmEnd,
    setConfirmEnd,
    select,
    commit,
    cancel,
    requestEnd,
    finishTurn,
    reset,
    onTile,
    prepare,
    nextUnit,
  };
}
