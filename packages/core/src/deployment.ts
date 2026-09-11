import type { BattleState, Content, DeployCommand, Evaluation } from "./types";
import { createBattle } from "./types";
import { canStop, distance } from "./movement";
import { effectiveMaxMp } from "./effective";

/** A new practice sortie retains growth and the once-per-scenario reward ledger. */
export function evaluateDeploy(
  content: Content,
  state: BattleState,
  command: DeployCommand,
): Evaluation {
  if (
    !state.outcome ||
    state.progression.settlement?.outcome !== state.outcome.status
  )
    return {
      ok: false,
      error: "전투 정산을 마친 뒤 성장을 유지하며 다시 출격할 수 있습니다.",
    };
  const next = createBattle(content);
  next.revision = state.revision + 1;
  next.commands = [
    ...structuredClone(state.commands),
    structuredClone(command),
  ];
  next.inventory = structuredClone(state.inventory);
  next.progression.roster = structuredClone(state.progression.roster);
  next.progression.rewardedScenarioIds = [
    ...state.progression.rewardedScenarioIds,
  ];
  next.progression.battleStartRevision = next.revision;
  for (let index = 0; index < next.units.length; index += 1) {
    const deployed = next.units[index]!;
    const veteran = next.progression.roster.find(
      (unit) => unit.id === deployed.id,
    );
    if (!veteran) continue;
    next.units[index] = {
      ...structuredClone(veteran),
      side: "player",
      pos: { ...deployed.pos },
      hp: 10,
      acted: false,
    };
    delete next.units[index]!.refreshedRound;
  }
  for (const unit of next.units) {
    if (!canStop(content, next, unit, unit.pos)) {
      const origin = unit.pos;
      const candidates = Array.from(
        { length: content.scenario.width * content.scenario.height },
        (_, index) => ({
          x: index % content.scenario.width,
          y: Math.floor(index / content.scenario.width),
        }),
      )
        .filter((pos) => canStop(content, next, unit, pos))
        .sort(
          (a, b) =>
            distance(a, origin) - distance(b, origin) || a.y - b.y || a.x - b.x,
        );
      if (!candidates[0])
        return {
          ok: false,
          error: `${unit.name}의 전직 병종을 배치할 수 있는 칸이 없습니다.`,
        };
      unit.pos = { ...candidates[0] };
    }
    if (unit.side === "player") unit.mp = effectiveMaxMp(content, next, unit);
  }
  next.progression.roster = next.progression.roster.map((veteran) =>
    structuredClone(next.units.find((unit) => unit.id === veteran.id)!),
  );
  return {
    ok: true,
    nextState: next,
    events: [{ type: "battleDeployed", scenarioId: content.scenario.id }],
  };
}
