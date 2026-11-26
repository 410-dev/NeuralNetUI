# NeuralNetUI

**한국어** · [English](README.en.md)

로컬·원격 OpenAI 호환 추론 서버를 한 화면에서 다루는 셀프 호스팅 채팅 UI입니다. Next.js 프론트엔드와 스트리밍 프록시 백엔드를 한 프로세스에서 실행하고, 모든 데이터는 로컬 SQLite와 로컬 파일에 저장됩니다.

![NeuralNetUI](neuralnetui.png)

`2.0-devel` · Node.js 22+ · Next.js 16 · SQLite

## 주요 기능

| 기능 | 요약 |
| --- | --- |
| **다중 서버 라우팅** | OpenAI API·LM Studio·Google Gemini·Anthropic Claude 드라이버, 연결 우선순위, 서버별 모델 설정 |
| **브랜치 대화** | 메시지 편집·재생성이 기존 경로를 보존한 새 브랜치를 만들고 `< m / n >`으로 전환 |
| **추론 제어** | 내장 effort와 커스텀 템플릿, 서버 능력 자동 감지, 추론 스트리밍 표시 |
| **도구** | 인터넷 검색, 페이지 방문, 브라우저 샌드박스 코드 실행(JavaScript·Python), 저장소 접근, 선택형 질문, 헤드리스 브라우저(Obscura), 유튜브, 사용자 등록 MCP |
| **컨텍스트 관리** | 롤링 또는 자동 압축과 재개, 실시간 사용량 도넛, 응답 길이 상한 |
| **개인 저장소** | 계정별 할당량, 아티팩트·생성 이미지 자동 저장, 청크 업로드, 휴지통과 보존 기간, 참조 보호 |
| **이미지 생성** | OpenAI Compatible Images API의 base64 응답 수신, GPT Image 2 자동 감지, 생성 결과의 채팅·개인 저장소 연동 |
| **첨부** | 이미지·PDF·일반 파일, 모델별 이미지 입력 허용 여부와 해상도 제어 |
| **다중 사용자** | 세 단계 역할, 데이터 격리, 감사 권한, 워크스페이스 기본값 |
| **백업·복원** | 사용자별 고압축 7z 이미지, 순차 버전 승계, 병합·대체 복원, 관리자 데이터 이미지 |
| **플랜·한도** | 모델 접근, MCP 사용·등록 수, HTML 아티팩트 실행 정책, 플랜 복제, 복수 시간 구간, 모델 가중치, 저장소, 리셋권 |
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

호스트의 `localhost`에만 바인딩된 릴레이 서버와 함께 Linux Docker Engine에서 실행하려면 [netsync Docker 배포](docs/deployment.md#linux-netsync-docker)를 사용합니다.

### Windows 설치 프로그램

MSI는 Node.js, Python, Windows 서비스, 트레이 앱을 함께 설치하고 부팅 시 자동으로 시작합니다. 자세한 내용은 [배포 문서](docs/deployment.md#windows-msi)를 참고하세요.

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
| [추론](docs/features/reasoning.md) | 프리셋, 능력 감지, 표시 |
| [도구](docs/features/tools.md) | 검색, 브라우저, 유튜브, 저장소 접근, MCP |
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

## 암호화 백업

백업은 고압축 7z 데이터를 담은, 인증 암호화(AES-256-GCM)된 `.nnbak` 이미지로 만들어집니다. 암호화 키는 무작위 솔트와 scrypt로 소유자의 사용자 이름과 비밀번호에서 만들어지므로, 복원할 때 서버 비밀 값이나 원본 인스턴스가 필요하지 않습니다. 개인·사용자별 백업은 데이터 소유자의 현재 로그인 정보가, 전체·계정 백업은 내보내는 관리자의 로그인 정보가 필요합니다. 복원할 때는 이후에 비밀번호를 바꿨더라도 **이미지를 만들 때** 쓴 로그인 정보를 입력해야 합니다.

복원할 서버에 로그인한 뒤 백업 범위와 병합·대체 방식을 고르고, 이미지를 만들 때의 로그인 정보를 입력합니다. 개인 이미지와 사용자별 이미지는 서로 바꿔 쓸 수 있으며, ID와 첨부 링크가 복원하는 쪽 소유자에 맞게 옮겨집니다. 계정 복원은 최고 관리자만 할 수 있고, 이미 있는 사용자 이름은 로컬 ID에 맞추며, 복원을 실행하는 최고 관리자 계정은 그대로 유지합니다. 복원도 대상 서버의 저장소 한도를 지킵니다. 이전 버전(Beta 15)에서 만든 암호화되지 않은 `.7z` 파일은 원래 설치본에서 암호화 이미지로 다시 만들어야 합니다.

검증: `npm test`, `npx tsc --noEmit`, `npm run build`, `node --experimental-strip-types scripts/test-beta16-backup-integration.mjs`. 통합 검증은 모든 범위·방식 조합, 암호문 변조, 잘못된 로그인 정보, 롤백, 별도의 새 복원 대상까지 확인합니다. 패키지된 standalone 런타임을 검증하려면 `BACKUP_QA_APP_DIR`와 `BACKUP_QA_NODE`를 지정합니다. 이 저장소에는 별도의 lint 명령이 없습니다.
