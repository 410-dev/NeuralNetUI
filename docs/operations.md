# 운영과 백업

## 회귀 검증

코드를 바꾼 뒤에는 다음 순서로 실행합니다.

```bash
npm test
npx tsc --noEmit
npm run build
```

- `npm test` — `lib/*.test.ts`의 단위 테스트를 Node 내장 테스트 러너로 실행합니다.
- `npx tsc --noEmit` — 타입 검사만 수행합니다.
- `npm run build` — 프로덕션 standalone 빌드를 만듭니다.

### 통합 검증 스크립트

빌드 후 실행하는 시나리오 검증 스크립트입니다. 모두 임시 DB와 로컬 모의 서버를 쓰며, **실제 연결 설정과 모델에는 접근하지 않습니다.**

```bash
node scripts/test-audit-integration.mjs
```

| 스크립트 | 검증 대상 |
| --- | --- |
| `test-audit-integration.mjs` | 설정 권한, 모델 라우팅, 스트림 실패, 대화 삭제, 질문 복구, 작업 캐시 제한 |
| `test-harness-integration.mjs` | 하네스 설정과 컨텍스트 처리 |
| `test-progress-integration.mjs` | 모델 로드·프롬프트 진행률 (`--live`로 localhost:1234 사용, `--keep`으로 QA 서버 유지) |
| `test-residency-integration.mjs` | 모델 상주 admission과 축출 |
| `test-image-integration.mjs` | 이미지 첨부 파이프라인 |
| `test-compaction-integration.mjs` | 컨텍스트 압축과 재개 |
| `test-browser-view-integration.mjs` | 실시간 브라우저 분할 화면 |
| `test-google-browser-smoke.mjs` | 브라우저 도구 호환성 스모크 |
| `test-mcp-integration.mjs` | MCP Streamable HTTP 인증·도구 발견, 자격 증명 비노출, 플랜 한도·비활성화, 암호화 백업 복원 |
| `test-beta*-integration.mjs` | 해당 베타 릴리스의 중점 변경 |

## 백업과 복원

실행 중인 DB는 WAL 파일만 단순 복사하면 안 됩니다. SQLite의 online backup으로 받은 뒤 `uploads` 디렉터리도 함께 보관하세요.

```bash
sqlite3 /var/lib/neural-chat/neural-chat.sqlite3 ".backup '/backup/neural-chat.sqlite3'"
cp -a /var/lib/neural-chat/uploads /backup/uploads
```

복원은 서비스를 멈춘 뒤 두 대상을 같은 시점의 것으로 되돌려 놓고 다시 시작하는 순서입니다. DB와 `uploads`의 시점이 어긋나면 참조가 깨진 첨부가 생깁니다.

### 인스턴스 제약

SQLite와 로컬 업로드 파일을 쓰므로 **한 데이터 디렉터리를 여러 앱 인스턴스가 동시에 공유하면 안 됩니다.** 다중 인스턴스가 필요하면 PostgreSQL과 객체 스토리지로 이전해야 합니다.

## 업그레이드

1. 백업합니다.
2. 배포 방식에 맞는 업데이트 절차를 따릅니다([배포 → 업데이트](deployment.md#업데이트)).
3. 서버를 시작합니다. 필요한 스키마 마이그레이션은 기동 시 자동 적용됩니다.
4. 오래된 설치라면 `설정 > 연결`에서 모델을 다시 감지하고 저장해 레거시 메타데이터를 갱신합니다.

## 문제 해결

| 증상 | 확인할 것 |
| --- | --- |
| 브라우저 도구가 메뉴에 없음 | `설정 > 실험실`에서 브라우저 도구를 켰는지 |
| 브라우저 도구 실행 실패 | Chrome/Edge 설치 여부, `npm run browser:install`, `NEURAL_CHAT_BROWSER_EXECUTABLE` |
| MCP가 도구 메뉴에 없음 | 현재 플랜의 MCP 사용 여부, 연결의 사용 스위치, 채팅 도구 메뉴의 MCP 선택 상태 |
| MCP 연결 테스트 실패 | Streamable HTTP URL인지, Bearer 토큰이 유효한지, 일반 계정에서 사설망 주소를 쓰지 않았는지 |
| 인터넷 검색 실패 | Python과 `requirements.txt` 설치 여부, `NEURAL_CHAT_PYTHON` |
| 응답이 도중에 잘림 | 하네스의 최대 출력 토큰. `0`이면 컨텍스트 창 전체를 사용 |
| 컨텍스트 초과 오류 | 컨텍스트 모드를 `compacting`으로, 임계값을 낮춤. 모델 컨텍스트 길이 설정 확인 |
| 모델이 목록에 없음 | 연결의 감지 실행 여부, 모델의 **메인 인터페이스에 표시** 상태 |
| 같은 모델인데 다른 서버로 감 | 연결 순서. 같은 identifier는 가장 위 연결이 선택됨 |
| 업로드가 할당량 초과로 거부 | `설정 > 사용자`의 계정 할당량, `설정 > 도구`의 기본값 |
| 파일이 삭제되지 않음 | 활성 대화가 참조 중인지. 참조 목록에서 관련 대화와 함께 삭제 |
| 진행률이 안 보임 | LM Studio 연결인지, `설정 > 모양`의 진행률 표시 방식 |
| 복사 버튼이 동작하지 않음 | 비보안 HTTP 출처에서는 선택 기반 복사로 대체됩니다 |
| 포트 충돌 | `app-config.json`의 `server.port`, 또는 `PORT` 환경 변수 |
| 설정 파일이 잘못됨 | `node scripts/start-server.mjs --check` |

## 로그

| 배포 방식 | 위치 |
| --- | --- |
| 소스 / 호스팅 스크립트 | 표준 출력 |
| Docker | `docker compose logs -f neural-chat` |
| Windows MSI | `%ProgramData%\Neural Chat\data` |
| systemd | `journalctl -u neural-chat -f` |

## 릴리스 기록

릴리스별 검증 내용, MSI 파일 크기와 SHA-256 해시는 [`docs/audits/`](audits/)에 남아 있습니다. 사용자 관점의 변경 요약은 [`Changelogs.md`](../Changelogs.md)에 있습니다.
