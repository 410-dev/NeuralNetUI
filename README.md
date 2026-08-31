# Neural Chat

`llm-chat-ui.html`의 디자인 언어를 이어 만든 OpenAI API 호환 채팅 UI입니다. Next.js 프론트엔드와 설정/모델 감지/스트리밍 프록시 백엔드를 한 프로세스에서 실행합니다.

## 로컬 실행

```bash
npm install
npm run dev
```

기본 설정에서는 브라우저에서 `http://localhost:3000`을 연 뒤 좌측 하단 프로필을 눌러 API 서버 URL과 API 키를 설정합니다. 기본 API 엔드포인트는 `http://localhost:8888/v1`입니다.

## 간편 호스팅

Node.js 22 이상과 Python 3가 설치되어 있으면 운영체제별 스크립트가 Node 의존성 및 DDGS용 격리 Python 환경 설치, 프로덕션 빌드, standalone 정적 파일 준비와 서버 시작을 처리합니다. 최초 실행 시 앱 기본값을 `data/neural-chat.sqlite3`에 저장하며 이후 사용자, 세션, API 연결, 모델, 화면 환경설정은 모두 SQLite에서만 읽고 씁니다.

Windows:

```bat
host-windows.bat
```

Linux 또는 LXC:

```bash
chmod +x host-linux.sh
./host-linux.sh
```

소스나 패키지를 업데이트한 뒤에는 `host-windows.bat --rebuild` 또는 `./host-linux.sh --rebuild`로 다시 빌드합니다. `app-config.json`은 애플리케이션 데이터가 아닌 서버 프로세스 자체의 설정만 담당합니다.

```json
{
  "server": {
    "host": "0.0.0.0",
    "port": 3000,
    "accessMode": "lan-and-tailscale"
  }
}
```

`PORT`와 `NEURAL_CHAT_HOST` 환경 변수는 파일 값보다 우선합니다. `NEURAL_CHAT_DATA_DIR` 또는 `NEURAL_CHAT_DB_PATH`로 저장 위치를, `NEURAL_CHAT_SERVER_CONFIG`로 서버 설정 파일 경로를 따로 지정할 수 있습니다.

`server.accessMode`는 Windows MSI 서비스의 원격 접속 범위를 정합니다. 허용값은 `lan`, `tailscale`, `lan-and-tailscale`입니다. 로컬 루프백 접속은 항상 허용되며, 그 외 인터넷 주소는 거부됩니다.

실제로 서버를 시작하지 않고 설치와 빌드 상태만 준비·확인하려면 `--check`를 사용합니다.

```bash
./host-linux.sh --check
```

## Windows MSI 설치

`installer/output/NeuralNetUI-1.6.0-x64.msi`는 Node.js, 앱 런타임, 헤드리스 Chromium, Windows 서비스와 트레이 앱을 함께 포함합니다. 설치 화면의 **Hosting access** 단계에서 LAN만, Tailscale만, 또는 둘 다를 선택하고 수신 포트를 지정할 수 있습니다. 설치가 끝나면 `NeuralNetUI Service` Windows 서비스가 자동 시작 유형으로 등록되고 현재 사용자에게 Web UI와 트레이 아이콘이 열립니다. 이후 Windows 부팅 때는 서비스가 먼저 시작되며, 사용자가 로그인하면 Web UI와 트레이 아이콘이 자동으로 열립니다.

트레이 아이콘을 두 번 누르면 Web UI를 다시 열 수 있습니다. 우클릭 메뉴에는 **설정 파일 수정**, **재시작**, **종료하기**가 있으며, 종료는 서비스와 트레이 앱을 함께 중지합니다. 시작 메뉴의 **NeuralNetUI**를 누르면 중지된 서비스를 다시 시작하고 Web UI를 호스팅하며 트레이 아이콘도 복원합니다. 서비스 제어와 보호된 설정 파일 편집에는 Windows 관리자 권한 확인이 표시될 수 있습니다.

설치된 호스팅 설정은 `%ProgramData%\Neural Chat\app-config.json`에 있습니다. 파일에서 `server.port` 또는 `server.accessMode`를 바꾼 뒤 관리자 권한으로 `Restart-Service NeuralChat`을 실행하면 서비스와 Windows 방화벽 규칙이 새 설정으로 동기화됩니다. 앱 데이터와 로그는 `%ProgramData%\Neural Chat\data`에 보존됩니다.

무인 설치에서도 같은 공개 MSI 속성을 사용할 수 있습니다.

```powershell
msiexec /i NeuralNetUI-1.6.0-x64.msi /qn ACCESS_MODE=tailscale APP_PORT=65500
```

MSI를 다시 빌드하려면 Node.js, .NET 8 SDK가 있는 Windows x64 개발 환경에서 다음을 실행합니다. WiX 5 도구는 처음 빌드할 때 `installer/.tools`에 로컬 설치됩니다.

```powershell
.\installer\build-msi.ps1
```

## Docker 배포

Docker Desktop(Windows) 또는 Docker Engine과 Docker Compose v2(Linux)가 설치되어 있으면 운영체제별 스크립트 하나로 이미지를 빌드하고 컨테이너를 시작할 수 있습니다.

Windows:

```bat
deploy-docker-windows.bat
```

Linux:

```bash
chmod +x deploy-docker-linux.sh
./deploy-docker-linux.sh
```

기본 접속 주소는 `http://localhost:3000`이며 SQLite DB와 업로드 파일은 프로젝트의 `data` 디렉터리에 계속 보존됩니다. 외부 포트를 바꾸려면 실행 전에 `NEURAL_CHAT_PORT`를 지정합니다.

```bat
set NEURAL_CHAT_PORT=65500
deploy-docker-windows.bat
```

```bash
NEURAL_CHAT_PORT=65500 ./deploy-docker-linux.sh
```

호스트 PC에서 실행 중인 OpenAI 호환 API 서버에 연결할 때는 앱 설정의 Base URL에 `http://host.docker.internal:8888/v1`처럼 `host.docker.internal`을 사용합니다. Windows와 Linux 모두 Compose에서 이 호스트 이름을 사용할 수 있도록 설정되어 있습니다.

컨테이너 로그 확인과 종료는 다음 명령으로 할 수 있습니다.

```bash
docker compose logs -f neural-chat
docker compose down
```

## LXC 배포

Node.js 22 이상이 설치된 LXC에서 다음 순서로 수동 빌드할 수도 있습니다. Docker는 필요하지 않습니다.

```bash
npm ci
npm run build
mkdir -p /opt/neural-chat
cp -a .next/standalone/. /opt/neural-chat/
cp -a .next/static /opt/neural-chat/.next/static
mkdir -p /opt/neural-chat/scripts
cp scripts/start-server.mjs /opt/neural-chat/scripts/
cp scripts/ddgs-search.py /opt/neural-chat/scripts/
cp scripts/process-pdf.py /opt/neural-chat/scripts/
cp requirements.txt /opt/neural-chat/
cp app-config.json /opt/neural-chat/
```

정적 자산 폴더가 추가되면 `public`도 `/opt/neural-chat/public`으로 복사합니다. `deploy/neural-chat.service.example`을 `/etc/systemd/system/neural-chat.service`로 복사하고 사용자·경로를 환경에 맞게 조정한 뒤 실행합니다.

```bash
systemctl daemon-reload
systemctl enable --now neural-chat
```

앱 설정과 대화 데이터는 기본적으로 실행 디렉터리의 `data/neural-chat.sqlite3`에 저장됩니다. 운영 환경에서는 예시 서비스처럼 `NEURAL_CHAT_DATA_DIR=/var/lib/neural-chat`을 반드시 지정하고 해당 디렉터리를 서비스 사용자만 읽고 쓸 수 있게 두는 것을 권장합니다. DB 파일만 별도 위치에 둘 경우 `NEURAL_CHAT_DB_PATH`를 사용할 수 있습니다. 저장된 API 키는 브라우저 응답에 다시 포함되지 않습니다.

SQLite는 WAL 모드, 외래키 검사, 5초 busy timeout을 사용하며 대화의 모든 브랜치와 메시지는 한 트랜잭션으로 저장됩니다. 사용자 메시지 편집, 모델 응답 편집, 응답 재생성은 모두 기존 경로를 보존한 새 브랜치를 생성합니다. 수정본이 있는 각 메시지 아래의 `< m / n >` 탐색기로 해당 메시지의 이전·다음 수정본과 연결된 채팅 기록을 즉시 전환할 수 있습니다. 내보내기는 선택 브랜치의 Markdown 또는 모든 브랜치가 포함된 JSON을 지원합니다.

이미지와 PDF를 메시지에 함께 첨부할 수 있습니다. 이미지 메타데이터와 메시지 연결은 SQLite에 저장하고, DB 비대화를 막기 위해 원본과 브라우저에서 생성한 경량 썸네일은 `data/uploads`에 분리 저장합니다. PDF는 원본과 제한된 텍스트 추출 캐시만 보관하며, 텍스트가 없는 스캔 PDF는 모델 요청 시 제한된 페이지를 임시 이미지로 렌더링한 뒤 즉시 삭제합니다. 대화에서 참조되지 않은 업로드는 설정된 보관 시간이 지난 뒤 다음 업로드 요청에서 정리됩니다.

페이지 방문 도구는 HTML뿐 아니라 JSON, XML, CSV 등 텍스트 응답을 읽습니다. PDF URL은 임시 파일로 처리하고 즉시 삭제하며, 안전한 래스터 이미지는 비전 입력으로 전달합니다. 압축 파일과 실행 파일을 포함한 기타 바이너리는 열지 않습니다. 설정의 **Tools** 탭에서 최대 도구 호출 라운드, 메시지당 첨부 수, 텍스트·이미지·PDF 용량, PDF 페이지·추출 글자·비전 페이지 수, 처리 제한 시간과 미첨부 업로드 보관 시간을 변경할 수 있습니다. 관리자가 입력한 값은 서버 안전 범위 안에서 검증됩니다.

기존 `data/config.json`, `data/conversations/*.json`, `data/uploads/*.json`은 최초 실행 때 한 번 자동으로 SQLite에 이전됩니다. 이전이 끝난 원본 파일은 안전을 위해 삭제하지 않으며 이후에는 SQLite 데이터가 기준이 됩니다. 구버전 `app-config.json`에 앱 설정을 보관했다면 업데이트 전에 해당 파일을 `data/config.json`으로 복사하면 같은 이관 경로를 사용할 수 있습니다.

긴 대화는 최근 60개 메시지만 먼저 렌더링하고 이전 메시지를 60개 단위로 추가 표시합니다. 사이드바 기록은 전체 대화 대신 SQLite 요약 쿼리만 읽습니다.

## 운영 및 백업

SQLite와 로컬 업로드 파일을 사용하므로 한 데이터 디렉터리를 여러 앱 인스턴스가 동시에 공유하지 마세요. 다중 인스턴스가 필요하면 PostgreSQL과 객체 스토리지로 이전해야 합니다. 실행 중인 DB는 WAL 파일만 단순 복사하지 말고 SQLite의 online backup 기능으로 백업한 뒤 `uploads` 디렉터리도 함께 보관합니다.

```bash
sqlite3 /var/lib/neural-chat/neural-chat.sqlite3 ".backup '/backup/neural-chat.sqlite3'"
cp -a /var/lib/neural-chat/uploads /backup/uploads
```

모델 응답은 GitHub Flavored Markdown으로 렌더링되며 목록, 링크, 표, 인라인 코드와 코드 블록을 지원합니다. 사용자 메시지는 입력한 일반 텍스트 그대로 표시됩니다. 완료된 모델 응답은 응답 아래의 편집 버튼으로 현재 브랜치 안에서 수정할 수 있습니다.

## 사용자와 권한

- 사용자 테이블이 비어 있는 최초 접속에서는 최고 관리자 계정을 생성합니다. 기존 버전에서 이전된 대화와 업로드는 이 계정에 귀속됩니다.
- 최고 관리자와 관리자는 설정에서 일반 사용자 또는 관리자 계정을 추가하고, 다른 사용자의 표시 이름을 변경하거나 계정을 삭제할 수 있습니다. 최고 관리자 계정과 현재 로그인한 본인 계정은 삭제할 수 없습니다.
- 대화와 이미지 업로드는 사용자별로 분리되며 다른 사용자의 API 접근도 거부됩니다.
- 커스텀 모델은 만든 사용자에게만 보입니다. 제작자가 **커스텀 모델 공개**를 켜면 다른 사용자도 채팅에서 사용할 수 있지만 수정할 수는 없습니다.
- 일반 사용자의 설정 화면은 자신이 만든 커스텀 모델, 자신이 만든 커스텀 Reasoning 프리셋, 계정 비밀번호 변경만 제공합니다.

## 인터넷 도구

입력창의 `+` 메뉴에서 **인터넷 검색**, **페이지 방문**, **브라우저**를 각각 켤 수 있습니다. 활성화된 도구만 OpenAI 호환 `tools` 정의로 모델에 전달되고, 모델이 호출하면 서버가 결과를 실행해 같은 요청 흐름 안에서 모델에 돌려줍니다. 검색은 Python `ddgs` 패키지를 사용합니다. 페이지 방문과 브라우저는 공개 HTTP(S) 주소만 허용하며 localhost와 사설 IP 대역을 차단합니다.

**브라우저** 도구는 실제 Chromium에서 JavaScript를 실행합니다. 모델은 `open`, `inspect`, `click`, `type`, `select`, `press`, `scroll`, `wait`, `screenshot`, `close` 작업을 연속 호출할 수 있고, DOM 스냅샷에 포함된 `e1`, `e2` 같은 요소 참조로 페이지를 조작합니다. `open` 또는 `screenshot`에 `wait_seconds`를 지정하면 최대 30초를 기다린 뒤 화면을 캡처하며, 캡처 이미지는 모델의 비전 입력으로도 전달됩니다. 전체 페이지 캡처는 메모리 남용을 막기 위해 높이 8,000px까지로 제한됩니다. 세션은 사용자와 응답별로 격리되고 응답 종료 시 자동으로 닫히며, 서브리소스 요청에도 공개 주소 검사를 적용합니다.

Docker 이미지와 Windows MSI는 Chromium을 포함합니다. 소스에서 직접 실행할 때 Chrome 또는 Edge가 설치되어 있지 않다면 `npm run browser:install`을 한 번 실행하세요. 별도 Chromium 실행 파일은 `NEURAL_CHAT_BROWSER_EXECUTABLE` 환경 변수로 지정할 수 있습니다.

한 응답에서 발생한 도구 호출은 렌치 아이콘이 있는 하나의 **도구 사용 중/도구 사용함** 폴딩에 모입니다. 각 호출은 **인터넷 검색 도구 사용 중**, **페이지 방문 도구 사용함**처럼 이름과 상태를 표시하는 하위 폴딩이며, 펼치면 도구 호출 인자와 결과를 확인할 수 있습니다. 진행 중인 호출은 자동으로 펼쳐지고 완료된 호출은 접힌 상태로 정리됩니다.

다중 선택 도구의 질문은 기술적인 도구 폴딩 대신 입력창 위의 전용 카드에 한 번에 하나씩 표시됩니다. 모델은 질문별로 단일 선택, 복수 선택, 우선순위 정렬 방식을 지정할 수 있으며, 답변 후에는 다음 질문으로 슬라이드 전환됩니다. 제출한 질문·답변 쌍은 사용자 메시지 형태로 대화에 표시되고 모델 응답이 이어집니다.

사용자 메시지를 삭제하면 같은 브랜치에서 바로 연결된 모델 응답도 함께 삭제됩니다.

직접 실행하는 경우 아래 의존성도 설치할 수 있습니다. `host-windows.bat`와 `host-linux.sh`, Docker 이미지는 이를 자동 처리합니다.

```bash
python -m pip install -r requirements.txt
```

## Reasoning 동작

- **Built-in** 프리셋은 선택한 값을 OpenAI 호환 요청의 `reasoning_effort`로 전달합니다.
- **Custom template**은 선택한 내장 effort를 전달한 뒤, 템플릿 내용을 모델/alias 시스템 프롬프트 뒤에 추가합니다.
- Qwen3.8의 화면상 **Extra High**는 실제 서버가 허용하는 API 값인 `xhigh`로 전송됩니다.
- 입력창의 Reasoning 메뉴에서 이전 assistant 응답의 `reasoning_content`를 다음 요청에 포함할지 선택할 수 있습니다.
- Reasoning 생성 중에는 최근 내용이 약 5줄 높이로 스트리밍되고, 완료 후에는 실제 측정한 소요 시간을 `Thought for …` 또는 `… 동안 생각함`으로 표시합니다.
- 모델 감지는 `/models`를 조회한 뒤 잘 알려진 reasoning 모델 이름을 기준으로 기능을 추정합니다. 호환 API에 표준 capability 필드가 없으므로 설정에서 언제든 수동으로 덮어쓸 수 있습니다.
- `/models`가 반환한 항목은 Models 관리 목록에 모두 보존됩니다. 모델별 **메인 인터페이스에 표시** 토글을 끄면 모델 선택기와 Reasoning 설정 목록에서만 숨겨집니다.
- 숨긴 서빙 모델은 커스텀 alias의 기반 모델 선택 목록에서도 제외됩니다.
- 커스텀 Reasoning 템플릿의 시스템 프롬프트는 모델 프롬프트를 `Replace`, `Prepend`, `Append`하는 세 가지 방식으로 조합할 수 있습니다.
- 커스텀 모델은 별도 모델을 복제하지 않는 alias입니다. 표시 이름과 ID, 시스템 프롬프트만 독립적으로 가지며 요청은 기반 모델의 ID로 전송됩니다.
- 일반 설정의 **On demand**를 켜면 각 추론 요청 전에 서버의 `/api/inference/load`를 호출해 선택한 모델을 먼저 로드합니다. `repo:variant` 형식의 모델 ID는 `model_path`와 `gguf_variant`로 나누어 전송합니다.
- 모델 및 Reasoning 선택기 하단의 **기본으로 사용**으로 다음 로그인/접속의 초기 모델과 추론 강도를 계정별로 저장할 수 있습니다. 기존 대화에서 **새 채팅**을 누르면 현재 선택은 유지됩니다.
- 일반 설정에서 모델, alias, 가시성, Reasoning 프리셋과 기본 선택을 2-space JSON으로 내보내거나 다시 가져올 수 있습니다. 가져온 설정은 검증 후 즉시 저장됩니다.

응답 스트리밍 중에는 사용자가 대화 하단을 보고 있는 동안만 새 내용을 자동으로 따라갑니다. 사용자가 위로 스크롤하면 자동 스크롤이 멈추고, 다시 하단으로 이동하면 자동 추적이 재개됩니다.

## 언어

좌측 하단 프로필을 눌러 `설정 > 일반`에서 전체 인터페이스 언어를 변경할 수 있습니다. 선택한 언어는 변경사항을 저장하면 다음 접속에도 유지됩니다.
