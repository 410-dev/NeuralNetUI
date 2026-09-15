# 시작하기

NeuralNetUI는 Next.js 프론트엔드와 스트리밍 프록시 백엔드를 **한 프로세스**에서 실행합니다. 데이터는 전부 로컬 SQLite와 로컬 파일에 저장되며, 외부 서비스에 의존하지 않습니다.

## 요구 사항

| 항목 | 요구 사항 | 비고 |
| --- | --- | --- |
| Node.js | 22 이상 | `package.json`의 `engines`에 명시 |
| Python | 3.x | 인터넷 검색(`ddgs`)과 PDF 처리에 사용. 호스팅 스크립트가 격리 환경을 자동 구성 |
| 브라우저 엔진 | Chrome / Edge / Chromium | **브라우저 도구**를 쓸 때만 필요 |
| 추론 서버 | OpenAI 호환 API 또는 LM Studio | 별도 호스트에 있어도 됩니다 |

Docker 이미지와 Windows MSI에는 Node.js, Python 의존성, Chromium이 모두 포함되어 있어 위 준비가 필요 없습니다.

## 설치 방법 선택

| 방법 | 적합한 상황 | 문서 |
| --- | --- | --- |
| 소스 실행 (`npm run dev`) | 개발, 코드 수정 | 아래 |
| 간편 호스팅 스크립트 | 개인 PC·홈서버에서 상시 구동 | 아래 |
| Windows MSI | Windows 서비스로 상시 구동, 트레이 아이콘 | [배포](deployment.md#windows-msi) |
| Docker | 격리된 컨테이너 배포 | [배포](deployment.md#docker) |
| LXC / systemd | 리눅스 컨테이너·서버 | [배포](deployment.md#lxc--systemd) |

## 소스에서 실행

```bash
npm install
npm run dev
```

브라우저에서 `http://localhost:3000`을 엽니다. 브라우저 도구를 쓸 예정이고 Chrome이나 Edge가 없다면 한 번만 다음을 실행합니다.

```bash
npm run browser:install
```

인터넷 검색과 PDF 처리를 소스 실행 환경에서 쓰려면 Python 의존성도 설치합니다.

```bash
python -m pip install -r requirements.txt
```

## 간편 호스팅 스크립트

Node 의존성 설치, DDGS용 격리 Python 환경 구성, 프로덕션 빌드, standalone 정적 파일 준비, 서버 시작을 한 번에 처리합니다.

Windows:

```bat
host-windows.bat
```

Linux 또는 LXC:

```bash
chmod +x host-linux.sh
./host-linux.sh
```

| 옵션 | 동작 |
| --- | --- |
| (없음) | 필요한 경우에만 빌드하고 서버를 시작합니다 |
| `--rebuild` | 소스·패키지 업데이트 후 강제로 다시 빌드합니다 |
| `--check` | 서버를 시작하지 않고 설치·빌드 상태와 서버 설정 유효성만 확인합니다 |

수신 주소와 포트는 `app-config.json`에서 정합니다. 자세한 내용은 [설정 파일과 환경 변수](configuration.md)를 참고하세요.

## 최초 설정

1. **최고 관리자 계정 생성** — 사용자 테이블이 비어 있는 첫 접속에서 superadmin 계정을 만듭니다. 구버전에서 이관된 대화와 업로드는 이 계정에 귀속됩니다. 비밀번호는 8자 이상이어야 합니다.
2. **연결 추가** — 좌측 하단 프로필 → `설정 > 연결`에서 드라이버(OpenAI API 또는 LM Studio)와 Base URL, API 키를 입력합니다. 기본 연결은 `http://localhost:8888/v1`이고, LM Studio 기본값은 `http://localhost:1234`입니다.
3. **모델 감지** — 연결 카드의 감지 버튼을 누르면 서버가 제공하는 모델 목록과 컨텍스트 길이, Reasoning 지원 여부를 읽어옵니다.
4. **모델 정리** — `설정 > 모델`에서 표시 여부, 설명, 시스템 프롬프트, 컨텍스트 길이, 이미지 입력 방식을 조정합니다.
5. **대화 시작** — 입력창 위 모델 선택기에서 모델과 추론 강도를 고르고 메시지를 보냅니다. 선택기 하단의 **기본으로 사용**으로 다음 접속의 초기 선택을 계정별로 저장할 수 있습니다.

처음 실행할 때 앱 기본값이 `data/neural-chat.sqlite3`에 기록되며, 이후 사용자·세션·연결·모델·환경설정은 모두 SQLite에서만 읽고 씁니다.

## 구버전에서 올라오기

기존 `data/config.json`, `data/conversations/*.json`, `data/uploads/*.json`은 최초 실행 때 한 번 자동으로 SQLite에 이관됩니다. 이관된 원본 파일은 안전을 위해 삭제하지 않으며, 이후에는 SQLite 데이터가 기준입니다. 아주 오래된 버전처럼 `app-config.json`에 **앱 설정**을 보관했다면 업데이트 전에 그 파일을 `data/config.json`으로 복사해 같은 이관 경로를 태우세요. 현재 `app-config.json`은 서버 프로세스 설정만 담당합니다.

## 다음 단계

- 도구를 켜고 싶다면 → [도구](features/tools.md)
- 긴 대화에서 컨텍스트가 넘칠 때 → [하네스와 컨텍스트](features/harness.md)
- 사용자를 추가하고 권한을 나누려면 → [사용자와 권한](features/users.md)
