import { useEffect, useMemo, useRef, useState } from "react";
import { content } from "@orden/content";
import {
  apply,
  createBattle,
  evaluate,
  nextEnemyCommand,
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

export function useBattle() {
  const [state, setState] = useState(() => createBattle(content));
  const current = useRef(state);
  const [selectedId, setSelectedId] = useState("A2");
  const [destination, setDestination] = useState<Position | null>(null);
  const [action, setAction] = useState<Action>({ type: "wait" });
  const [message, setMessage] = useState("부대를 선택하십시오.");
  const [history, setHistory] = useState<string[]>([]);
  const [fast, setFast] = useState(false);
  const [enemyActor, setEnemyActor] = useState<string | null>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const unit = state.units.find((u) => u.id === selectedId);
  const busy = state.activeSide !== "player";
  const canAct = !busy && unit?.side === "player" && !unit.acted;
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
    unit && move
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
  };
  const recordEvents = (before: BattleState, events: BattleEvent[]) => {
    const lines = events.flatMap((event) => {
      if (event.type === "phaseStarted")
        return [
          `제 ${event.round} 턴 · ${event.side === "player" ? "아군" : event.side === "enemy" ? "적군" : "중립"} 페이즈`,
        ];
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
      setHistory((old) => [...lines.reverse(), ...old].slice(0, 30));
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
    recordEvents(before, result.events);
    return true;
  };
  useEffect(() => {
    if (state.activeSide === "player") {
      setEnemyActor(null);
      return;
    }
    const timer = window.setTimeout(
      () => {
        if (current.current !== state) return;
        const cmd =
          state.activeSide === "enemy"
            ? nextEnemyCommand(content, state)
            : phaseEndCommand(state);
        if (!cmd) return;
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
  }, [state, fast]);
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
    if (current.current.activeSide !== "player") return;
    cancel();
    setConfirmEnd(false);
    dispatch(phaseEndCommand(current.current));
    setMessage("적군 턴입니다.");
  };
  const requestEnd = () => {
    if (busy) return;
    cancel();
    if (remaining) setConfirmEnd(true);
    else finishTurn();
  };
  const reset = () => {
    const initial = createBattle(content);
    current.current = initial;
    setState(initial);
    setSelectedId("A2");
    cancel();
    setHistory([]);
    setEnemyActor(null);
    setConfirmEnd(false);
    setMessage("초기 배치로 돌아왔습니다.");
  };
  const onTile = (pos: Position) => {
    if (busy || confirmEnd) return;
    const target = state.units.find((u) => samePosition(u.pos, pos));
    if (target && target.side !== "enemy") {
      if (canAct && action.type === "heal" && unit?.canHeal) {
        setDestination(destination ?? unit.pos);
        setAction({ type: "heal", targetId: target.id });
      } else select(target.id);
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
    setDestination(type === "treat" ? unit.pos : (destination ?? unit.pos));
    setAction(type === "heal" ? { type, targetId: unit.id } : { type });
    if (type === "heal") setMessage("회복할 아군을 선택하십시오.");
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
    state,
    unit,
    selectedId,
    destination,
    moves,
    preview,
    busy,
    canAct,
    remaining,
    message,
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
