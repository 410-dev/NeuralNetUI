# 아키텍처

## 기술 스택

| 영역 | 사용 기술 |
| --- | --- |
| 프레임워크 | Next.js 16 (App Router), React 19, TypeScript 5.9 |
| 데이터 | `better-sqlite3` (WAL 모드) |
| 검증 | zod 4 |
| 렌더링 | `react-markdown`, `remark-gfm`, `remark-math`, `rehype-katex`, KaTeX |
| 아이콘 | `lucide-react` |
| 이미지 처리 | `sharp` |
| 브라우저 자동화 | `playwright-core` (Chromium) |
| LM Studio | `@lmstudio/sdk` |
| NNUI Server | OpenAI 호환 HTTP와 인증된 SSE 이벤트 스트림 |
| 보조 런타임 | Python (`ddgs` 검색, PDF 처리) |

프론트엔드와 스트리밍 프록시 백엔드는 **하나의 Node 프로세스**에서 실행됩니다. `scripts/start-server.mjs`가 `app-config.json`과 환경 변수를 읽어 수신 주소·포트·접근 범위를 정한 뒤 Next.js standalone 서버를 띄웁니다.

## 디렉터리

| 경로 | 내용 |
| --- | --- |
| `app/` | 페이지, UI 컴포넌트, API 라우트 |
| `app/api/` | 서버 라우트 핸들러 |
| `lib/` | 도메인 로직과 단위 테스트(`*.test.ts`) |
| `scripts/` | 서버 부트스트랩, Python 헬퍼, 통합 검증 스크립트 |
| `installer/` | Windows MSI 빌드(WiX 5), 서비스·트레이 호스트 |
| `native/` | 네이티브 클라이언트 실험 코드 |
| `deploy/` | systemd 유닛 예시 |
| `docs/` | 문서와 릴리스 감사 기록 |
| `design/` | 프론트엔드 디자인 언어 규칙 |
| `data/` | 런타임 데이터(커밋하지 않음) |

## 주요 모듈

| 모듈 | 역할 |
| --- | --- |
| `lib/database.ts` | SQLite 연결, 스키마 마이그레이션 |
| `lib/config.ts` | 설정 스키마, 기본값, 권한별 공개 범위, 워크스페이스 기본값 |
| `lib/auth.ts` | 계정, 세션, 계정별 환경설정 |
| `lib/chat-runtime.ts` | 채팅 작업 수명, 스트리밍, 도구 라운드, 압축 |
| `lib/harness.ts` | 토큰 추정, 롤링, 재개 프롬프트, 컨텍스트 초과 해석 |
| `lib/connection-drivers.ts` / `driver-capabilities.ts` | 드라이버별 동작과 지원 범위 |
| `lib/model-residency.ts` / `residency-adapter.ts` | 모델 상주 admission, 축출 |
| `lib/web-tools.ts` | 검색·페이지 방문·시간·위치·선택형 질문 도구 |
| `lib/mcp.ts` / `mcp-utils.ts` | 사용자별 MCP CRUD, Streamable HTTP 실행, 도구 네임스페이스, 네트워크 경계 |
| `lib/browser-tool.ts` | Chromium 세션, 탭, 스냅샷, 스크린샷 |
| `lib/storage-tool.ts` / `uploads.ts` / `storage-chunk-upload.ts` | 개인 저장소와 업로드 |
| `lib/host-computer-tool.ts` / `host-permissions.ts` | 호스트 컴퓨터 도구와 권한 매트릭스 |
| `lib/document-processing.ts` | 문서 분류, 텍스트 디코딩, PDF 처리 |
| `lib/transcript.ts` | 메시지 단계 기록과 구버전 레이아웃 복원 |
| `lib/appearance.ts` / `greetings.ts` | 표시 전용 환경설정 |

## 데이터베이스

`schema_migrations` 테이블이 적용된 버전을 추적하고, 기동 시 부족한 마이그레이션만 순서대로 적용합니다.

| 버전 | 내용 |
| --- | --- |
| 1 | `app_config`, `conversations`, `branches`, `messages`, `branch_messages`, `uploads`, `message_attachments`, `storage_migrations` |
| 2 | `users`, `sessions` |
| 3 | 토큰 사용량 컬럼 |
| 4 | 스트림 타이밍 컬럼 |
| 5 | 도구 이벤트 |
| 6 | 문서 업로드 재구성 |
| 7 | `model_usage` (서버·모델별 LFU 횟수와 마지막 사용 시각) |
| 8 | `context_summaries` (브랜치 요약, 보호된 제목 메타데이터, 메시지 컨텍스트 토큰) |
| 9 | 임시 대화 플래그 |
| 10 | 메시지 단계(`steps`) |
| 11 | 사용자 저장소 컬럼, `admin_audit_log` |
| 12 | 일반 파일 저장(제한 없는 MIME 메타데이터) |
| 13 | 소프트 삭제와 보존 |
| 14 | 할당량 기본값 상속 |
| 15 | `storage_upload_sessions` (청크 업로드) |

파일 기반 구버전 데이터의 1회성 이관은 `storage_migrations`에 따로 기록되며 원본을 삭제하지 않습니다.

## API 라우트

모든 라우트는 세션 인증을 요구합니다(`/api/auth/status`와 최초 설정 제외).

### 인증

| 라우트 | 메서드 | 설명 |
| --- | --- | --- |
| `/api/auth/status` | GET | 설정 필요 여부와 로그인 화면 액센트(비인증) |
| `/api/auth/setup` | POST | 최초 최고 관리자 생성 |
| `/api/auth/login` | POST | 로그인 |
| `/api/auth/logout` | POST | 로그아웃 |
| `/api/auth/password` | PUT | 비밀번호 변경 |

### 설정과 모델

| 라우트 | 메서드 | 설명 |
| --- | --- | --- |
| `/api/config` | GET, PUT | 권한에 맞게 걸러진 설정 읽기·쓰기 |
| `/api/config/defaults` | PUT | 워크스페이스 기본값 한 키를 모든 계정에 적용(관리자) |
| `/api/models/detect` | POST | 연결의 모델 목록 감지 |
| `/api/mcp-connections` | GET, POST | 현재 사용자의 MCP 목록 조회·등록 |
| `/api/mcp-connections/[id]` | PUT, DELETE | 소유 MCP 수정·삭제 |
| `/api/mcp-connections/test` | POST | 저장 전후 MCP 연결·도구 목록 테스트 |
| `/api/models/context` | POST | 모델 컨텍스트 길이 조회 |
| `/api/inference/unload` | POST | 로드된 모델 언로드(관리자) |

### 대화와 채팅

| 라우트 | 메서드 | 설명 |
| --- | --- | --- |
| `/api/conversations` | GET, POST, DELETE | 목록·요약, 생성, 일괄 삭제 |
| `/api/conversations/[id]` | GET, PUT, PATCH, DELETE | 전체 읽기, 저장, 이름 변경·승격, 삭제 |
| `/api/chat` | POST | 채팅 작업 시작(SSE 스트림) |
| `/api/chat/[id]` | GET, DELETE | 작업 스냅샷 구독, 중단 |
| `/api/chat/[id]/input` | POST | 선택형 질문 답변, 호스트 승인 응답 |
| `/api/browser-view` | GET, POST | 실시간 브라우저 화면 조회와 조작 |

### 저장소

| 라우트 | 메서드 | 설명 |
| --- | --- | --- |
| `/api/storage` | GET, DELETE | 개인 저장소 목록(검색·정렬·페이징), 삭제 |
| `/api/storage/files` | POST | Markdown·텍스트 파일 생성 |
| `/api/storage/[id]/references` | GET | 이 파일을 참조하는 활성 대화 |
| `/api/storage/uploads` | POST | 청크 업로드 세션 시작 |
| `/api/storage/uploads/[id]/chunks/[index]` | PUT | 청크 전송 |
| `/api/storage/uploads/[id]/complete` | POST | 검증 후 원자적 등록 |
| `/api/storage/uploads/[id]` | DELETE | 세션 취소 |
| `/api/uploads` | POST | 채팅 첨부 업로드 |
| `/api/uploads/[id]` | GET, DELETE | 파일 조회(`no-store`), 삭제 |

### 사용자

| 라우트 | 메서드 | 설명 |
| --- | --- | --- |
| `/api/users` | GET, POST | 목록(검색·페이징), 생성 |
| `/api/users/[id]` | PATCH, DELETE | 표시 이름·역할·감사 권한·할당량 수정, 삭제 |
| `/api/users/[id]/audit` | GET, PATCH, DELETE | 감사 열람, 휴지통 복원, 영구 삭제 (감사 권한 필요) |
| `/api/users/defaults` | PATCH | 계정 기본 모델·추론 저장 |

## 스트리밍

`/api/chat`이 채팅 작업을 등록하고 SSE로 스냅샷을 내보냅니다. 스냅샷에는 전달된 본문, 추론, 도구 이벤트, 토큰 사용량, 대기 상태(`waitPhase`)가 담깁니다.

| `waitPhase` | 의미 |
| --- | --- |
| `waiting-session` | 세션 확보 대기 |
| `freeing-space` | 상주 공간 확보 |
| `loading-model` | 모델 로드 |
| `waiting-server` | 서버 응답 대기 |
| `preparing-response` | 응답 준비 |
| `processing-prompt` | 프롬프트 처리 |
| `compacting-context` | 컨텍스트 압축 |

작업은 대화와 사용자에 묶이며, 대화나 사용자가 삭제되면 폐기됩니다. 종료된 작업은 이력을 해제하고 60초 뒤 만료되며 최대 64개까지 보관됩니다. SSE 오류와 불완전한 스트림은 사용자에게 드러냅니다.

## 디자인 규칙

프론트엔드 디자인 언어는 [`design/MASTER.md`](../design/MASTER.md)에 정리되어 있습니다. 핵심 규칙 몇 가지:

- 알약 모양 버튼·입력·드롭다운 트리거, 큰 반경 토큰, 색조 없는 표면과 글자, 접시 없는 흰 아이콘.
- 네이티브 `<select>`는 쓰지 않고 공용 `SelectMenu` 하나로 통일합니다.
- 액센트는 계정별 팔레트를 `--accent-rgb` / `--accent-bright-rgb`로 전달합니다. CSS에 액센트 색을 직접 적지 않습니다.
- 팝오버는 `usePopoverPresence`로 열고 닫는 애니메이션을 처리하며, 스타일이 적용된 버튼은 자체 배경을 지정해야 합니다.
