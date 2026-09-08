import { content } from "./index";

const { scenario } = content;
console.log(
  `콘텐츠 검증 통과: ${scenario.title}, ${scenario.width}×${scenario.height}, 초기 ${scenario.units.length}기 + 증원 ${scenario.reinforcement.units.length}기`,
);
