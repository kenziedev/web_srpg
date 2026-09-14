/** Keep visible attribution alongside the full source/license ledger in docs. */
export function ArtCredits() {
  return (
    <details className="art-credits">
      <summary>그림 출처와 라이선스</summary>
      <ul>
        <li>
          마법사·성직자: Exewin / Toen —{" "}
          <a
            href="https://opengameart.org/content/characters-extension-to-toens-medieval-strategy-sprite-pack"
            target="_blank"
            rel="noreferrer"
          >
            Characters Extension
          </a>{" "}
          (CC BY 3.0).
        </li>
        <li>
          지형·병사: Andre Mari Coppola / Toën —{" "}
          <a
            href="https://opengameart.org/content/toens-medieval-strategy-sprite-pack-v10-16x16"
            target="_blank"
            rel="noreferrer"
          >
            Medieval Strategy Sprite Pack
          </a>{" "}
          (
          <a
            href="https://creativecommons.org/licenses/by/4.0/"
            target="_blank"
            rel="noreferrer"
          >
            CC BY 4.0
          </a>
          ).
        </li>
        <li>
          초상: Graphics designed by{" "}
          <a
            href="http://zeneria29.deviantart.com/"
            target="_blank"
            rel="noreferrer"
          >
            ZeNeRIA29
          </a>
          . Portrait graphics created by{" "}
          <a
            href="http://peterlzy.wix.com/rpgaction"
            target="_blank"
            rel="noreferrer"
          >
            RPG Action
          </a>
          .{" "}
          <a
            href="https://opengameart.org/content/sara-trevor-puck-anime-portrait-and-expressions"
            target="_blank"
            rel="noreferrer"
          >
            원본 초상 모음
          </a>
          .
        </li>
        <li>
          장비:{" "}
          <a href="https://ravenmore.itch.io/" target="_blank" rel="noreferrer">
            Ravenmore / Krzysztof Dycha
          </a>{" "}
          —{" "}
          <a
            href="https://opengameart.org/content/fantasy-icon-pack-by-ravenmore-0"
            target="_blank"
            rel="noreferrer"
          >
            2014 Fantasy Icon Pack
          </a>
          .
        </li>
        <li>
          마법:{" "}
          <a href="http://www.jwbjerk.com/art" target="_blank" rel="noreferrer">
            J. W. Bjerk / eleazzaar
          </a>{" "}
          —{" "}
          <a
            href="https://opengameart.org/content/painterly-spell-icons"
            target="_blank"
            rel="noreferrer"
          >
            Painterly Spell Icons, parts 1–4
          </a>
          .
        </li>
      </ul>
      <p>
        초상·장비·마법 그림은{" "}
        <a
          href="https://creativecommons.org/licenses/by/3.0/"
          target="_blank"
          rel="noreferrer"
        >
          CC BY 3.0
        </a>
        입니다. 원본 그림에서 사용할 부분을 골라 크기 조절, 좌우 반전, 대형
        배치와 동작을 적용했습니다. 창 장식·부족한 병종과 아이콘은 자체
        도형입니다.
      </p>
    </details>
  );
}
