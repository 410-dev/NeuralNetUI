# NeuralNetUI

로컬·원격 OpenAI 호환 추론 서버를 한 화면에서 다루는 셀프 호스팅 채팅 UI입니다. Next.js 프론트엔드와 스트리밍 프록시 백엔드를 한 프로세스에서 실행하고, 모든 데이터는 로컬 SQLite와 로컬 파일에 저장됩니다.

![NeuralNetUI](neuralnetui.png)

`3.0.0-rc4-b24` · Node.js 22+ · Next.js 16 · SQLite

## 주요 기능

| 기능 | 요약 |
| --- | --- |
| **다중 서버 라우팅** | OpenAI API·LM Studio·NNUI Server 드라이버, 연결 우선순위, 서버별 모델 설정 |
| **브랜치 대화** | 메시지 편집·재생성이 기존 경로를 보존한 새 브랜치를 만들고 `< m / n >`으로 전환 |
| **Reasoning 제어** | 내장 effort와 커스텀 템플릿, 서버 능력 자동 감지, 추론 스트리밍 표시 |
| **도구** | 인터넷 검색, 페이지 방문, 실제 Chromium 브라우저, 저장소 접근, 선택형 질문, 사용자 등록 MCP, 호스트 컴퓨터 |
| **컨텍스트 관리** | 롤링 또는 자동 압축과 재개, 실시간 사용량 도넛, 응답 길이 상한 |
| **개인 저장소** | 계정별 할당량, 아티팩트·생성 이미지 자동 저장, 청크 업로드, 휴지통과 보존 기간, 참조 보호 |
| **이미지 생성** | OpenAI Compatible Images API의 base64 응답 수신, GPT Image 2 자동 감지, 생성 결과의 채팅·개인 저장소 연동 |
| **첨부** | 이미지·PDF·일반 파일, 모델별 이미지 입력 허용 여부와 해상도 제어 |
| **다중 사용자** | 세 단계 역할, 데이터 격리, 감사 권한, 워크스페이스 기본값 |
| **백업·복원** | 사용자별 고압축 7z 이미지, 순차 버전 승계, 병합·대체 복원, 관리자 데이터 이미지 |
| **플랜·한도** | 모델 접근, MCP 사용·등록 수, 복수 시간 구간, 모델 가중치, 저장소, 리셋권, 실시간 사용률 도넛 |
| **배포** | 호스팅 스크립트, Windows MSI 서비스, Docker, LXC/systemd |

## 빠른 시작

### 소스에서 실행

```bash
npm install
npm run dev
```

`http://localhost:3000`을 엽니다.

### 상시 구동 (권장)

Node.js 22 이상과 Python 3가 있으면 스크립트 하나가 의존성 설치, 프로덕션 빌드, 서버 시작을 처리합니다.

```bat
host-windows.bat
```

```bash
chmod +x host-linux.sh
./host-linux.sh
```

소스를 업데이트한 뒤에는 `--rebuild`, 시작하지 않고 상태만 확인하려면 `--check`를 붙입니다.

### Docker

```bat
deploy-docker-windows.bat
```

```bash
chmod +x deploy-docker-linux.sh
./deploy-docker-linux.sh
```

### Windows 설치 프로그램

MSI는 Node.js, Chromium, Python, Windows 서비스, 트레이 앱을 함께 설치하고 부팅 시 자동으로 시작합니다. 자세한 내용은 [배포 문서](docs/deployment.md#windows-msi)를 참고하세요.

## 처음 실행할 때

1. 첫 접속에서 **최고 관리자 계정**을 만듭니다.
2. `설정 > 연결`에서 드라이버와 Base URL, API 키를 입력하고 **모델 감지**를 실행합니다.
3. 입력창 위에서 모델과 추론 강도를 고르고 대화를 시작합니다.

자세한 절차는 [시작하기](docs/getting-started.md)에 있습니다.

## 문서

| 문서 | 내용 |
| --- | --- |
| [시작하기](docs/getting-started.md) | 요구 사항, 설치, 최초 설정 |
| [배포](docs/deployment.md) | MSI, Docker, LXC/systemd, 업데이트 |
| [설정 파일과 환경 변수](docs/configuration.md) | `app-config.json`, 환경 변수, 데이터 위치 |
| [대화](docs/features/chat.md) | 브랜치, 첨부, 렌더링, 검색, 내보내기 |
| [모델과 연결](docs/features/models.md) | 드라이버, 커스텀 모델, 상주 관리 |
| [Reasoning](docs/features/reasoning.md) | 프리셋, 능력 감지, 표시 |
| [도구](docs/features/tools.md) | 검색, 브라우저, 저장소 접근, MCP, 호스트 컴퓨터 |
| [개인 저장소](docs/features/storage.md) | 업로드, 할당량, 휴지통 |
| [하네스와 컨텍스트](docs/features/harness.md) | 압축, 재개, 제목 생성, 한도 |
| [사용자와 권한](docs/features/users.md) | 역할, 감사, 격리 |
| [모양과 언어](docs/features/appearance.md) | 액센트, 스트리밍 표현, 인사말 |
| [설정 레퍼런스](docs/settings-reference.md) | 모든 설정 항목, 범위, 기본값 |
| [운영과 백업](docs/operations.md) | 검증, 백업, 문제 해결 |
| [아키텍처](docs/architecture.md) | 구조, 데이터베이스, API |

변경 이력은 [`Changelogs.md`](Changelogs.md), 릴리스별 검증 기록은 [`docs/audits/`](docs/audits/)에 있습니다.

## 개발

```bash
npm test          # lib/*.test.ts 단위 테스트
npx tsc --noEmit  # 타입 검사
npm run build     # 프로덕션 빌드
```

빌드 후 `node scripts/test-audit-integration.mjs`로 임시 DB와 모의 서버를 사용한 통합 검증을 실행할 수 있습니다. 실제 연결 설정과 모델에는 접근하지 않습니다. 전체 목록은 [운영 문서](docs/operations.md#통합-검증-스크립트)에 있습니다.

프론트엔드 디자인 규칙은 [`design/MASTER.md`](design/MASTER.md)를 따릅니다.

## 저장소 구조

```
app/        페이지, UI, API 라우트
lib/        도메인 로직과 단위 테스트
scripts/    서버 부트스트랩, Python 헬퍼, 통합 검증
installer/  Windows MSI 빌드와 서비스·트레이 호스트
deploy/     systemd 유닛 예시
docs/       문서와 릴리스 감사 기록
design/     디자인 언어 규칙
```

### Beta 16 encrypted backups

Backup creates an authenticated AES-256-GCM `.nnbak` image containing a high-compression 7z payload. A random salt and scrypt derive its key from the owner's username and password; neither a server secret nor the source instance is required to restore. Personal/per-user backups require the data owner's current login credentials; global/account backups require the exporting administrator's credentials. Restore requires the credentials used **when that image was created**, even after a subsequent password change.

Sign in on the destination, select the backup scope and merge/replace mode, then supply the original image credentials. Personal and per-user images are interchangeable and migrate IDs and attachment links to the destination owner. Account restore requires a superadmin, matches existing usernames to local IDs, and retains the executing destination superadmin. Restore still respects destination storage limits. Beta 15 plaintext `.7z` files must be recreated as encrypted images on the source installation.

Validation: `npm test`, `npx tsc --noEmit`, `npm run build`, and `node --experimental-strip-types scripts/test-beta16-backup-integration.mjs`. The integration covers every scope/mode, ciphertext tampering, wrong credentials, rollback, and a separate fresh destination. Set `BACKUP_QA_APP_DIR` and `BACKUP_QA_NODE` to verify the packaged standalone runtime. No standalone lint command is configured in this repository.
