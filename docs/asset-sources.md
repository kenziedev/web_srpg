# 외부 그림 출처와 적용 범위

2026-09-14 확인. 이번 UI와 지도·전투 연출은 아래 다섯 출처의 원본 PNG를 사용한다. 게임 이름·인물 이름·규칙·명령·저장에는 변경이 없다. 그림은 `apps/web/src/assets/vendor/`에 원본 바이트 그대로 보관한다. 초상·아이템·마법 파일의 SHA-256은 `checksums.json`, 아이템/마법 대응표는 `manifest.json`에 기록했다. 초상·아이템·마법·Exewin 확장 그림은 CC BY 3.0, Toen 지형·병사 그림은 동봉 허가문의 CC BY 4.0을 적용한다. CC BY 3.0 전문은 `CC-BY-3.0.txt`이며 다운로드 원문은 https://creativecommons.org/licenses/by/3.0/legalcode.txt 이다. Toen의 원본 허가문과 링크는 `toen/LICENSE.txt`에 보관한다.

## 인물 초상 — ZeNeRIA29 / RPG Action

- 제목: Sara, Trevor, Puck Anime Portrait and Expressions.
- 공식 배포: https://opengameart.org/content/sara-trevor-puck-anime-portrait-and-expressions
- 작가: ZeNeRIA29, 의뢰·게시자 ZaPaper / RPG Action.
- 라이선스: [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/). 작가·지정 크레딧·원본 링크·라이선스와 표시상 변경 사항을 남긴다. 상업 웹 게임과 소스 재배포가 허용된다.
- 표시 크레딧: “Portrait graphics created by RPG Action”; “Graphics designed by ZeNeRIA29”. 원문 지정 링크는 http://peterlzy.wix.com/rpgaction 및 http://zeneria29.deviantart.com/ 이다.
- 파일: `zeneria29/portrait24.png` → 카이엘(A1), `portrait25.png` → 로엔(A2), `portrait21.png` → 미라(A3).
- 적용 프레임: 모두 원본 900×760 안의 첫 표정 `(x=0,y=0,w=300,h=380)`. `Portrait.tsx`의 SVG viewport로 클립하며 원본 그림을 편집하지 않는다. 그 밖의 유닛은 기존 자체 SVG 도형을 사용한다.
- 시각 검토: 같은 작가의 애니메 손그림이라 세 인물의 선·명암이 일관된다. 카이엘은 붉은 제복/청색 망토, 로엔은 초록 두건/수염/흉터가 있는 노련한 남성, 미라는 금발/청록 복장의 여성이다. 원작 랑그릿사 인물을 복사한 파일은 사용하지 않는다.

## 아이템 — Ravenmore 2014 Icon Pack

- 공식 배포: https://opengameart.org/content/fantasy-icon-pack-by-ravenmore-0
- 원본 ZIP: https://opengameart.org/sites/default/files/RavenmoreIconPack.02.2014.zip
- 작가: Ravenmore(Krzysztof Dycha). 크레딧과 지정 링크: https://ravenmore.itch.io/
- 라이선스: CC BY 3.0. 새 itch.io 버전의 사용자 정의 약관과 혼합하지 않고, CC BY로 배포된 2014 파일만 고정해 사용한다.
- 적용: ZIP의 `64/`에 있던 19개 원본 PNG를 `ravenmore/`로 복사했다. 장착 슬롯·보관함·정식 상점에서 장비 유형을 보여준다. 정확한 파일 목록은 `ravenmore/SOURCE.md`와 `manifest.json`에 있다.
- 없는 종류: 철 아령·로브·미라쥬 로브·스피드 부츠·크로스·크라운·그레이프 닐은 `ItemIcon.tsx`의 자체 벡터 기호를 사용한다. 관련 없는 무기 그림으로 대체하지 않는다.
- 시각 검토: 금속 날·나무 손잡이·보석의 색이 40px에서 구별되는 손그림이다. 짙은 창 배경과 잘 어울리며 원작 장비의 고유 그림을 재현하지 않는다.

## 마법 — Painterly Spell Icons

- 작가: J. W. Bjerk(eleazzaar), http://www.jwbjerk.com/art
- 공식 배포: https://opengameart.org/content/painterly-spell-icons (모음); 파트별 원본은 아래 참조.
- 파트1~4 각 페이지와 동봉 저작자 안내가 제공하는 여러 라이선스 중 **CC BY 3.0**을 선택한다. 작가명·원본·라이선스·표시 변경을 표기한다.
- 파트1: https://opengameart.org/content/painterly-spell-icons-part-1 / 원본 https://opengameart.org/sites/default/files/painterly-spell-icons-1.zip
- 파트2: https://opengameart.org/content/painterly-spell-icons-part-2 / 원본 https://opengameart.org/sites/default/files/painterly-spell-icons-2.zip
- 파트3: https://opengameart.org/content/painterly-spell-icons-part-3 / 원본 https://opengameart.org/sites/default/files/painterly-spell-icons-3.zip
- 파트4: https://opengameart.org/content/painterly-spell-icons-part-4 / 원본 https://opengameart.org/sites/default/files/painterly-spell-icons-4.zip

- 적용: `painterly/`의 원본 256×256 PNG를 마법 편성 카드와 전투 중 마법 메뉴의 장식으로 표시한다. 전체 35마법의 대응표는 `manifest.json`이다. 26일반마법과 9소환 모두 대응이 있으며 실제 편성 가능 여부는 기존 코어 판정을 따른다.
- 시각 검토: 회복은 빛나는 심장, 불은 화염구, 번개는 낙뢰처럼 색과 형상이 뚜렷하다. 고전 판타지 창과 어울리는 채색 그림이며 34~40px에 표시한다. 사진·생성 AI·상용 게임 추출 그림은 포함하지 않는다.

## 표시와 크레딧

모든 `ItemIcon`/`SpellIcon`은 `aria-hidden`이며 함께 표시하는 아이템·마법 이름이 기존 접근성 이름을 유지한다. 실제 동작 버튼·입력 이름은 변경하지 않는다. 이 문서는 소스 배포용 출처 장부다. 실행 화면의 안내 창에도 다섯 출처의 작가·원본 링크·각 라이선스(CC BY 3.0 또는 CC BY 4.0)를 표시한다. 원본 프레임 선택·클립·크기 조절·좌우 반전·대형 배치와 동작 등 화면에 적용한 변경도 함께 안내한다.

## 지형·병사 — Toen's Medieval Strategy Sprite Pack v1.0

- 작가: Andre Mari Coppola / Toen.
- 공식 배포: https://opengameart.org/content/toens-medieval-strategy-sprite-pack-v10-16x16
- 작가 배포처: http://toen.itch.io/toens-medieval-strategy
- 원본 ZIP: https://opengameart.org/sites/default/files/Toen%27s%20Medieval%20Strategy%20Sprite%20Pack%20v.1.0%20%20%2816x16%29.zip
- 적용 라이선스: **CC BY 4.0**. 게시 페이지의 분류 표시는 3.0이지만 작가의 본문·시트 하단·동봉 `License and atribution info.txt`는 모두 4.0을 명시한다. 동봉 원문을 `toen/LICENSE.txt`에 그대로 보존하고 이 명시적 허락을 따른다. 전문과 조건: https://creativecommons.org/licenses/by/4.0/
- 파일: `toen/medieval-strategy.png`, 원본 112×832. 16×16 셀을 7열로 배치한 시트이며 하단 저작권 안내 영역은 그림으로 사용하지 않는다. 파일 이름만 바꾸고 원본 PNG 바이트는 수정하지 않았다.
- 적용: 지형은 가장 가까운 픽셀 보간으로 3배 확대해 기존 48px 타일에 합성한다. 평지·숲·언덕·강·여울·도로·다리·회복소·봉화의 모양과 연결 방향만 바꾸며 좌표와 지형 규칙은 유지한다. 최초 표시와 실제 지형 변화 때만 합성한다.
- 병사: 0부터 세는 청색 16행·적색 17행의 궁병(0열)·보병(1열)·창병(2열)·기병(3열)을 사용한다. 비병은 기병 프레임에 자체 날개를 표시하며, 수병은 35/36행의 청색/적색 인물 프레임을 사용한다. 2배 확대·대형 배치·적군 좌우 반전·행동 완료 투명도 및 기존 지휘관 깃발·소속·체력 표시를 적용한다.
- 원본은 정지 프레임이다. 이동과 피격, 상세 전투 동작은 앱에서 위치·부분 표시를 움직이는 연출이며 원본에 보행 프레임이 있는 것으로 안내하지 않는다. 호위대와 9종 소환수, 지원하지 않는 병종 및 로드 실패 시에는 기존 자체 픽셀 도형을 사용한다.

## 마법사·성직자 — Characters Extension to Toen's Medieval Strategy Sprite Pack

- 작가: Exewin. 원작 그림·협력자: Toen(Andre Mari Coppola).
- 공식 배포: https://opengameart.org/content/characters-extension-to-toens-medieval-strategy-sprite-pack
- 원본 ZIP: https://opengameart.org/sites/default/files/characters_3.zip
- 라이선스: [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/). 페이지의 원본 팩과 함께 사용해야 한다는 안내에 따라 위 Toen 본팩과 함께 사용한다. 출처·저작자·라이선스와 표시 변경을 `toen-characters/SOURCE.md` 및 화면 안내에 기록한다.
- 파일: `toen-characters/uran.png`와 `hermit.png`, 각각 원본 16×16. ZIP 안의 PNG를 바이트 변경 없이 복사했다. Uran의 검은 두건·지팡이를 마법사, Hermit의 흰 옷·수염을 성직자 표시에 쓴다. 물리 공격 규칙은 궁병이지만 마법을 편성한 지휘관도 마법사 표시를 사용하며 규칙·콘텐츠는 바꾸지 않는다.
- 표시 변경: 프레임 선택·크기 조절·대형 배치·좌우 반전·행동 완료 투명도·위치와 부분 표시의 동작. 원본 그림 자체의 색이나 픽셀은 편집하지 않았다.
