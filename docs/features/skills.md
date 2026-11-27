# 스킬

스킬은 모델에게 "일하는 방법"을 가르치는 묶음입니다. 지침(시스템 프롬프트에 붙는 글)과 그 스킬 전용 함수로 이루어집니다.
입력창 **+ 메뉴 → 스킬**에서 채팅별로 켜고 끕니다. 켜는 동안 지침과 함수 정의가 모든 요청에 함께 가므로, 그 토큰이
컨텍스트 도넛의 초기 추산(시스템 프롬프트·도구 정의)에 바로 반영됩니다.

구현: 스킬은 도구 제공자(`lib/tools/catalog.ts`의 `section: "skill"`)이고, 제공자의 `instructions()`가 시스템 프롬프트
뒤에 붙습니다(`resolveTools().instructions`). 켜짐 상태는 도구와 같은 `ToolState`로 저장되며 플랜에서 끌 수 있습니다.

## 생성형 UI (A2UI v1.0)

모델이 `render_ui` 함수로 [A2UI v1.0](https://a2ui.org/specification/v1.0-a2ui/) 메시지를 보내면 채팅 안에 카드·폼·목록·탭·
대화상자를 그립니다. 앱의 기존 컨트롤로 그리므로 디자인이 다른 화면과 같습니다.

- 메시지: `createSurface`, `updateComponents`, `updateDataModel`, `deleteSurface` (기본 카탈로그
  `https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json`만 지원).
- 컴포넌트 18종(Text, Image, Icon, Video, AudioPlayer, Row, Column, List, Card, Tabs, Modal, Divider, Button, TextField,
  CheckBox, ChoicePicker, Slider, DateTimeInput)과 함수 14종(+`@index`), `@path` 바인딩, 템플릿 목록, `@checks` 검증,
  `formatString`의 `${...}` 식.
- 서버가 각 호출을 검증합니다(`lib/a2ui/validate.ts`). 틀리면 아무것도 그리지 않고 모델에게 고칠 점을 돌려줍니다.
- 나중 호출의 `updateComponents`/`updateDataModel`은 처음 그린 자리의 UI를 갱신합니다.
- 버튼의 `event` 동작은 다음 사용자 메시지로 보내집니다. 화면에는 `userMessage`(없으면 버튼 글자)만 보이고, 모델은 숨은
  `<a2ui-action>` 블록(이벤트 이름, surfaceId, 풀린 context, `sendDataModel`이면 데이터 모델 전체)을 읽습니다.
- 입력한 값은 브라우저에 UI별로 보관되어 새로고침해도 남습니다. 모델이 그 UI를 갱신하면 모델의 데이터가 우선합니다.

## 생성형 UI (A2UI Express)

같은 UI를 구글이 권장하는 압축 문법 [A2UI Express](https://a2ui.org/concepts/inference-formats/)로 만듭니다. 모델은
`render_ui_express` 도구에 Express 프로그램(문자열)을 넘기고, 서버가 공식 SDK(`@a2ui/agent`)로 v1.0 메시지로 컴파일한 뒤
JSON 스킬과 같은 검증을 거쳐 같은 렌더러로 그립니다. 모델에게는 컴파일 결과 대신 짧은 확인만 돌려주므로 출력과
다음 턴 입력 토큰이 모두 줄어듭니다. 지침은 SDK의 Express 계약에서 매개변수 설명만 뺀 것입니다(약 3,300 토큰).

- `surface("id", sendDataModel=true)`, `$/path = 값`, `root = Card(...)`, `_template($/list, item)`, `?required(...)`,
  `Event("name", {ctx}, userMessage=...)`, `deleteSurface("id")`.
- 이미 그린 UI는 같은 `surface("id")`로 바뀌는 변수나 데이터만 다시 보내 갱신합니다(이전 호출로 SDK 상태를 다시 만듦).
- 카탈로그: `lib/a2ui/vendor/basic-catalog-v1_0.json`(Apache-2.0, `NOTICE.md`).

지원하지 않는 것: 다른 카탈로그, `callRendererFunction`/`callAgentFunction`(렌더러·에이전트 함수 호출), 에이전트 모드.
