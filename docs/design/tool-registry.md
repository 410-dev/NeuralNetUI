# 도구 레지스트리

> 상태: 1~3단계 구현됨 (2026-11-17) · 4단계(워크스페이스 플러그인)는 미구현

모든 도구를 **공급자(provider)** 단위로 등록하고, 내장 도구와 설치한 MCP를 같은 경로로 다루는 구조입니다. 모델 입장에서는 모든 함수가 MCP 도구와 같은 모양(이름 · 설명 · 입력 스키마)으로 전달되고, 사용자 화면에서는 내장 도구가 "미리 설치된 MCP"처럼 연결 행 하나씩으로 보입니다.

## 1. 세 가지 출처

| 출처 (`origin`) | 누가 설치 | 누가 쓰나 | 메뉴 위치 | 상태 |
| --- | --- | --- | --- | --- |
| `builtin` | NeuralNetUI에 포함 | 조건을 만족하는 모든 계정 | 고정 카테고리: 인터넷 · 주변 인식 · 에이전트 · 상호 작용 | 구현 |
| `workspace` | 관리자 | 워크스페이스 전체 (플랜으로 제한) | `워크스페이스` 섹션 | 자리만 마련 |
| `user` | 각 계정 | 설치한 계정 | `MCP` 섹션 | 구현 (기존 MCP 연결) |

세 출처 모두 같은 `ToolProvider` 계약을 따르므로, 실행 · 승인 · 켜고 끄기 · 표시가 출처와 상관없이 같은 코드를 지납니다.

## 2. 핵심 개념

| 용어 | 뜻 | 예 |
| --- | --- | --- |
| 공급자 | 켜고 끄는 단위. 메뉴의 한 행 | `web-search`, `storage`, `mcp:<연결 ID>` |
| 함수 | 모델이 호출하는 단위. 공급자가 0개 이상 내놓음 | `internet_search`, `mcp_ab12cd34_echo` |
| 매니페스트 | 공급자의 정적 정보. 서버와 브라우저가 함께 읽음 | 이름, 섹션, 아이콘, 옵션 스키마, 사용 조건 |
| 스펙 (`ToolSpec`) | 함수 하나의 MCP `Tool` 모양 정의 | `{ name, description, inputSchema, sourceName? }` |
| 원천 (`ToolProviderSource`) | 요청마다 공급자 목록을 만드는 것 | 내장 목록, 계정의 MCP 연결 |

## 3. 파일 구성

```text
lib/tools/
  catalog.ts      매니페스트 타입, 내장 공급자 목록, 섹션 이름, MCP 매니페스트, 사용 조건 검사 (브라우저 공용)
  state.ts        켜고 끄기 상태 형식, 정규화, 기존 형식 변환, 병합 (브라우저 공용)
  types.ts        ToolProvider · ToolContext · ToolCallContext · ToolSpec 계약 (서버)
  registry.ts     resolveTools: 요청 하나의 함수 이름 → 공급자 맵, 스펙 → 모델 도구 변환
  approval.ts     공용 실행 전 승인과 세션 승인 기억
  builtin.ts      내장 도구 어댑터 9개 (기존 실행 모듈을 감쌈)
  mcp-source.ts   계정의 MCP 연결 → 연결당 공급자 하나
  index.ts        toolSources(), disposeConversationTools()
```

`web-tools.ts`, `storage-tool.ts`, `obscura.ts`, `youtube.ts`, `mcp.ts`의 실행 로직은 그대로이고, `builtin.ts`와 `mcp-source.ts`는 얇은 어댑터입니다.

## 4. 공급자 계약

```ts
interface ToolProvider {
  manifest: ToolProviderManifest;
  available?(ctx): boolean | Promise<boolean>;           // 플랜, 연결 상태 등 서버 조건
  tools(ctx): ToolSpec[] | Promise<ToolSpec[]>;           // 이번 요청에 내놓을 함수 (0개 가능)
  authorize?(name, args, ctx): Promise<AuthorizationResult>;
  execute(name, args, ctx): Promise<ToolExecution>;       // { result, content? }
  releasesModelWhileRunning?: boolean;                    // 실행·승인 대기 중 모델 점유 해제
  disposeConversation?(userId, conversationId): void | Promise<void>;
}
```

`ToolContext`에는 사용자 · 역할 · 대화 · 언어 · 설정 · 모델 · 취소 신호, 이 공급자의 옵션 값, 대화의 이전 도구 이벤트(`history()`), 격리된 모델 호출(`services.complete`)이 들어 있습니다. 호출 시점의 `ToolCallContext`는 여기에 `updateEvent`, `waitForUser`, `setWaitPhase`, 원본 인자 문자열을 더합니다.

### 요청 하나의 흐름

1. `requestToolState(job.input.tools)`로 이번 요청의 상태를 만듭니다.
2. `resolveTools`가 모든 원천에서 공급자를 모은 뒤, 꺼진 공급자, 매니페스트 조건(`requires`)이나 `available()`을 통과하지 못한 공급자를 뺍니다.
3. 남은 공급자의 `tools()`를 모아, 이름 형식(`^[a-zA-Z0-9_-]{1,64}$`) · 매니페스트 선언(`functions` 또는 `functionPrefix`) · 중복을 검사합니다. 걸린 함수는 빼고 서버 로그에 남깁니다. 이름이 겹치면 먼저 등록된 공급자가 이깁니다.
4. 대화별 함수 선택(`functions`)은 공급자 고유 이름(`sourceName`)으로 거릅니다.
5. 모든 스펙은 `toModelTool` 하나로 OpenAI 호환 `tools` 항목이 됩니다. 모델은 출처를 구분할 수 없습니다.
6. 모델 호출은 이 맵으로만 실행됩니다. 맵에 없는 이름(꺼진 도구, 지어낸 이름)은 `Tool … is not enabled.` 오류로 끝납니다.

## 5. 상태 형식

```ts
interface ToolState {
  version: 2;
  providers: Record<string, { enabled: boolean; options?: Record<string, boolean | number>; functions?: string[] }>;
}
```

- 항목이 없는 공급자는 매니페스트 `defaultEnabled`를 따릅니다. 새 내장 도구를 추가해도 저장값을 옮길 필요가 없습니다.
- 지금 목록에 없는 공급자(꺼진 MCP 연결, 잠시 사라진 플러그인)의 항목도 버리지 않고 보존합니다.
- `options`는 매니페스트 옵션 스키마로 정규화합니다 (예: 저장소 `read` · `write` · `maxFiles` 1~20).
- `functions`는 대화별 선택이라 계정에 저장하지 않습니다 (`persistableToolState`).

### 기존 형식과의 호환

| 입력 | 처리 |
| --- | --- |
| 저장된 계정 설정 (기존 형식) | `normalizeToolState`가 변환. 지정 안 된 스위치는 기본값을 따름. 다음 저장 때 새 형식으로 바뀜 |
| 채팅 요청 (기존 형식) | `requestToolState`가 변환. 예전처럼 **true인 것만** 켜짐 |
| 채팅 요청에 `tools` 없음 | 예전처럼 도구 없음 |
| `PUT /api/preferences/tools` | 바뀐 공급자만 담은 부분 상태를 받아 병합. 기존 형식 본문도 받음 |

기존 형식 키와 공급자 ID 대응은 `state.ts`의 `LEGACY_SWITCHES`에 있습니다 (`internetSearch → web-search`, `storageAccess/Read/Write/WriteMaxFiles → storage`, `mcpConnectionIds/mcpToolNames → mcp:<id>` 등).

## 6. 화면

- `+` 메뉴는 `TOOL_SECTION_ORDER` 순서로 섹션을 그립니다. 내장 공급자는 매니페스트의 `section`에 따라 고정 카테고리에, MCP 연결은 `MCP` 섹션에 들어갑니다.
- 모든 행은 같은 컴포넌트(`ToolProviderEntry`)입니다: 아이콘 · 이름 · 설명 · 펼치기 · 스위치. 펼치면 옵션과 함수 목록이 나옵니다. 함수가 둘 이상이거나 MCP 연결이면 함수별 스위치가 붙습니다.
- 옵션은 매니페스트 스키마로 그립니다. 불리언은 스위치, 정수는 `pairedWith`로 지정한 불리언 행 옆의 숫자 칸입니다.
- 승인 카드 · 위치 요청 · 브라우저 넘겨받기 · 선택형 질문 카드 · 아티팩트 카드는 도구 이름 대신 매니페스트(`clientRenderer`, `transcriptCard`)와 이벤트에 기록된 승인 정보(`pendingApprovalKind`)로 판단합니다.

## 7. 승인

`approval.ts`의 `requestApproval(ctx, subject, policy, present)`를 모든 공급자가 씁니다.

| 정책 | 동작 |
| --- | --- |
| `allow` | 바로 실행 |
| `always_ask` | 매번 확인 |
| `session_ask` | 대화마다 한 번 확인, 12시간 또는 대화 삭제까지 기억 |
| `blocked` | 실행 안 함 |

승인 기억은 `globalThis`에 있어 모든 라우트 번들이 같은 값을 봅니다. MCP는 연결별 도구 정책을 그대로 넘깁니다.

## 8. 수명 주기

대화를 지우는 모든 경로(단건 · 일괄 · 조건 삭제 · 저장소 파일과 함께 삭제)는 `disposeConversationTools(userId, ids)`를 부릅니다. 이 함수는 세션 승인을 지우고 각 공급자의 `disposeConversation`을 호출합니다. 브라우저 세션과 프로필이 여기서 정리되며, 여러 번 불러도 안전합니다.

## 9. 클라이언트에서 실행되는 공급자: 코드 실행

`code-runner`(`run_javascript`, `run_python`)는 실행을 브라우저에 맡기는 공급자의 예입니다. 서버 쪽은 `builtin.ts`의 어댑터 하나이고, 레지스트리는 바꾸지 않았습니다.

1. `execute`가 요청을 정규화해 도구 이벤트 인자(`{ language, code, timeoutSeconds }`)에 기록하고 `waitForUser()`로 기다립니다. 실행 중에는 `releasesModelWhileRunning`으로 모델 점유를 풉니다.
2. 채팅을 보고 있는 브라우저는 매니페스트의 `clientRenderer: "code-runner"`를 보고 대기 중인 이벤트를 찾아 `lib/code-runner-client.ts`로 실행합니다.
3. 실행 환경은 언어별 숨김 iframe(`sandbox="allow-scripts"`, 불투명 출처)과 그 안의 Web Worker입니다. iframe의 CSP는 JavaScript에 네트워크를 전혀 허용하지 않고, Python에는 Pyodide CDN(jsDelivr)만 허용합니다. 제한 시간이 지나면 Worker를 종료합니다.
4. 결과는 `/api/chat/:id/input`으로 돌아오고, 서버가 `normalizeCodeRunResult`로 다시 길이를 제한해 모델에 넘깁니다.

요청 · 결과 형식과 한도는 서버와 브라우저가 함께 쓰는 `lib/tools/code-runner.ts`에 있습니다.

같은 계약으로 더 복잡한 도구를 붙일 때 쓰는 부분:

| 필요한 것 | 계약에서 쓰는 부분 |
| --- | --- |
| 함수 여러 개 | 매니페스트 `functions` 여러 개 → 메뉴에서 함수별 스위치 자동 표시 |
| 사용자 옵션 | 매니페스트 `options` 스키마 → 메뉴에 자동 표시, 서버에서 범위 검사 |
| 런타임 설치 여부, 관리자 활성화 | `requires.experimental` 또는 `available()` |
| 대화별 상태 유지 · 정리 | 공급자 내부 세션 맵 + `disposeConversation` |
| 긴 실행과 중단 | `ctx.signal` (생성 중단 시 취소) |
| 진행 표시 | `ctx.updateEvent` |
| 브라우저에 실행 맡기기 | `waitForUser` + `clientRenderer` |
| 그림 · 표 결과를 모델에 전달 | `ToolExecution.content`의 이미지 · 텍스트 파트 |
| 누적 한도 (대화당 실행 횟수 등) | `ctx.history()` |

남은 부분: 관리자용 공급자 설정을 그릴 공용 화면은 아직 없습니다. 필요해지면 매니페스트에 관리자 설정 스키마를 추가해 일반화하는 것을 권장합니다.

## 10. 다음 단계: 워크스페이스 플러그인

- 관리자가 설치하는 공용 MCP 서버를 저장할 테이블과 `설정 > 플러그인` 화면.
- `lib/tools/workspace-source.ts`: 설치 항목마다 `origin: "workspace"`, `section: "workspace"`, `functionPrefix: "plg_<id>_"` 공급자. 실행은 기존 MCP 클라이언트 코드를 재사용.
- 플랜에 워크스페이스 플러그인 허용 항목 추가, `available()`에서 검사.
- `toolSources()`에 원천 추가, `disposeConversationTools`가 이 원천의 공급자도 정리하도록 확장.
- 외부 플러그인은 `clientRenderer`를 선언할 수 없고 공용 승인 카드만 씁니다.
