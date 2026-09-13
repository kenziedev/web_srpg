# 성장 구현 계약 — S04/S05, rulesVersion 0.7

0.8 갱신: 1차 Lv10의 6계열 마스터리 해금·한 슬롯 장착·전직/룬스톤 보존을 추가했다. 구체 효과와 수용 기준은 `combat-rules.md`의 0.8 절을 따른다. 정식 출격의 고용 제한과 패배 시 준비 진입 명부 복원은 `operation-system.md`를 따른다. 아래 0.7 기록의 마스터리·고용 미구현 표기는 해당 버전의 이력이다.

현재 작업의 구현 기준. 상세 검증 결과는 handoff.md에 기록한다. 원작 복제가 아니라 plan.md의 기여 EXP와 고정 성장 설계를 적용한다.

## 공용 데이터

- `Unit.progression?`: `{ classId, baseClassId, growthId, level, exp, totalExp, learnedSpellIds: string[], classHistory: string[] }`. 현재 출격하는 아군 정규 지휘관만 갖는다. Lv1~~10, 일반 EXP 0~~99, Lv10은 보관 EXP 0~100. 초기 Lv1/EXP0이며 현재 배치·능력치·미라 4마법을 유지한다.
- `Content.classes`: `{ id, name, tier:1|2, promotions:string[], unitType, moveType, move, range:[min,max], command:{radius,at,df}, statBonus:{at?,df?,mag?,res?}, learns:{level,spellIds:string[]}[], description, squadRes?:number }` 18종. 초기에는 클래스 이동/병종을 덮어쓰지 않으며 전직할 때 적용한다.
- `Content.growthProfiles`: `{id, name, levels:{level,gains:{at?,df?,mag?,res?,maxMp?}}[]}`. Lv2~10 고정 성장, AT/DF/MAG/RES 증가 합계 4 이내. 미라 MP는 Lv2·4·6·8·10 각 +2. 다른 지휘관의 프로필도 콘텐츠에서 지정한다.
- 아이템: `modifiers.expMultiplier?: 2`, `useEffect?: "class-reset"`. 메사이얀 소드의 사용 불가를 해제하고 EXP 배율 적용. 룬스톤은 장착이 아니라 전직 화면에서 소모한다.

`BattleState.progression`은 다음을 필수로 저장한다.

```ts
{
  roster: Unit[]; // 최초 출격한 아군 정규 지휘관의 지속 기록, 사망해도 보존
  contributions: Record<string, {damage:number,kills:number,retreats:number,healing:number,clear:number}>;
  damageAwarded: Record<string, number>; // 적 개체별 배율 전 피해 EXP 누적, 최대20
  healingAwarded: Record<string, number>; // 지휘관별 배율 전 회복 EXP 누적, 최대30
  defeated: string[];
  lastDamageOwner: Record<string, string>;
  rewardedScenarioIds: string[];
  battleStartRevision: number; // 이번 출격 전 준비의 시작 revision
  settlement: null | {
    scenarioId: string;
    outcome: "victory" | "defeat";
    duplicate: boolean;
    entries: {
      unitId:string;
      earned:{damage:number,kills:number,retreats:number,healing:number,clear:number};
      awardedExp:number;
      previousLevel:number; level:number;
      previousExp:number; exp:number;
      learnedSpellIds:string[];
      statGains:{at?:number,df?:number,mag?:number,res?:number,maxMp?:number};
    }[];
  };
}
```

`roster`는 각 유효 준비/전투 명령의 생존한 원래 아군 지휘관 스냅샷을 동기화한다. 매혹된 진영은 원래 player로 정규화하고 사망 전 마지막 스냅샷은 유지한다. 승리 후 성장은 전장 유닛 대신 roster에 적용한다. 따라서 그 전투의 HP·능력치·피해와 기존 재현 경로는 바뀌지 않는다. 정산 후에는 전장 스냅샷으로 roster를 다시 덮어쓰지 않는다.

## 규칙과 명령

- 실제 피해 HP당2, 적 개체당 배율 전 최대20. 용병 직접 격파20/정규 지휘관60, 지휘관 사망으로 살아서 퇴각한 용병5. 적 소환물은 피해·격파·퇴각 EXP 대상에서 제외하여 재소환 반복을 막는다.
- 용병·소환 기여는 원래 아군 지휘관에게 100% 귀속한다. 매혹으로 아군을 공격하거나 적에게 조종된 동안에는 기여하지 않는다. 반격 기여는 방어자 소유자에게 지급한다.
- 실제 마법 HP 회복당2, 지휘관당 배율 전 합계30. 정비·자동 회복 제외. 강화/약화/재행동/소환 자체에는 EXP가 없다.
- 메사이얀 소드는 기여가 생긴 순간 소유 지휘관이 장착했으면 위 전투 기여만2배. 피해/회복 상한은 배율 적용 전 집계한다. 고정 클리어180은 배율 적용 제외다.
- 승리 때만 출격 정규 지휘관마다 클리어180과 기여를1회 정산한다. 패배는 기여를 폐기한다. 같은 시나리오는 보상을 다시 주지 않는다.
- EXP100마다 레벨업, 전투 중 능력치는 그대로. 고정 성장과 현재 직업의 레벨별 마법을 습득한다. 기존 학습 마법은 유지하고 새 마법은 활성 목록에도 추가한다. 기존 자유 선택 `train`은 명시된 **연습 마법 편성**으로 유지하며 정식 직업 습득과 구별한다.
- `promote {unitId,classId}`: 공통commandId/expectedRevision. 첫 전투 명령 전 또는 승리 정산 뒤, 정규 지휘관 Lv10에서 현재 클래스가 지정한 후속 클래스만 허용. 기존 성장 스탯 보존+직업 보너스, Lv1으로 바꾸고 보관 EXP 최대100 적용. 부적합 장비는 보관함으로 해제하며 MP는 비율 유지. 변경된 이동형으로 현재 칸에 착지할 수 없는 준비 중 전직은 원자 거절한다. 사전 비교 후 **전직 확정 즉시 경로 고정**. 출격 시까지 자유 재선택하는 계획안은 이번 범위에서 제외한다.
- `reclass {unitId}`: 2차 Lv10에서 소유 룬스톤1개를 소모해 원래 기본 직업 Lv1로 돌아간다. 기존 능력치/배운 마법 보존, 보관 EXP는0으로 초기화, 초기직업 보너스를 다시 더하지 않는다. 반복 사용·불법 조건은 원자 거절한다.
- `deploy`: 승리 또는 패배 정산 뒤 같은 맵에 다시 출격한다. 이전에 얻은 성장은 패배해도 보존하고 이미 클리어한 시나리오의 추가 EXP는 없다. 전장만 초기화하고 성장 roster·소유 인벤토리·보상 장부·전역 명령/revision은 유지한다. 부적합 시작 지형은 콘텐츠의 합법 빈 칸 중 시작점 가까운 순으로 배치하며 core에서 원자 검증한다. 모든 지휘관과 원래 용병을 회복·재배치하고 임시 상태/지형변경/소환물은 제거한다. battleStartRevision은 deploy 적용 후revision이다.
- 기존 `연습 초기화`는 전체 진행을 처음으로 돌리는 별도 동작이다. 캠페인·새 맵·상점·고용·마스터리는 이번 범위에서 확장하지 않는다.

## 공용 코어 함수

- experience 담당: `gainExperience(content, unit, amount): {unit:Unit, learnedSpellIds:string[], statGains:{...}}` 입력 불변. roster 동기화·기여·정산도 담당.
- 전직 담당: `classChangeOptions(content,state,unitId)`와 `evaluatePromotion`/`evaluateReclass`; GrowthPanel 후보 미리보기 제공. 마도지휘관의 `squadRes`는 같은 진영인 소속 용병에게만 클래스 패시브로 적용한다.
- 루트: `evaluateDeploy`, canPrepare의 이번 출격 기준 변경, 장비 소비형 제한, effective 클래스 패시브, UI/저장 통합과 문서.
- 성장 이벤트: `experienceGained {unitId,amount}`, `levelUp {unitId,from,to}`, `spellLearned {unitId,spellId}`, `classChanged {unitId,from,to,reset:boolean}`, `battleDeployed {scenarioId}`. 상세 정산 내역은 settlement에서 표시한다.
