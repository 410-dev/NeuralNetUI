# Neural Chat

`llm-chat-ui.html`의 디자인 언어를 이어 만든 OpenAI API 호환 채팅 UI입니다. Next.js 프론트엔드와 설정/모델 감지/스트리밍 프록시 백엔드를 한 프로세스에서 실행합니다.

## 로컬 실행

```bash
npm install
npm run dev
```

기본 설정에서는 브라우저에서 `http://localhost:3000`을 연 뒤 좌측 하단 프로필을 눌러 API 서버 URL과 API 키를 설정합니다. 기본 API 엔드포인트는 `http://localhost:8888/v1`입니다.

## 간편 호스팅

Node.js 22 이상만 설치되어 있으면 운영체제별 스크립트가 의존성 설치, 프로덕션 빌드, standalone 정적 파일 준비와 서버 시작을 처리합니다. 최초 실행 시 앱 기본값을 `data/neural-chat.sqlite3`에 저장하며 이후 프로필, API 연결, 모델, 화면 환경설정은 모두 SQLite에서만 읽고 씁니다.

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
    "port": 3000
  }
}
```

`PORT`와 `NEURAL_CHAT_HOST` 환경 변수는 파일 값보다 우선합니다. `NEURAL_CHAT_DATA_DIR` 또는 `NEURAL_CHAT_DB_PATH`로 저장 위치를, `NEURAL_CHAT_SERVER_CONFIG`로 서버 설정 파일 경로를 따로 지정할 수 있습니다.

실제로 서버를 시작하지 않고 설치와 빌드 상태만 준비·확인하려면 `--check`를 사용합니다.

```bash
./host-linux.sh --check
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
cp app-config.json /opt/neural-chat/
```

정적 자산 폴더가 추가되면 `public`도 `/opt/neural-chat/public`으로 복사합니다. `deploy/neural-chat.service.example`을 `/etc/systemd/system/neural-chat.service`로 복사하고 사용자·경로를 환경에 맞게 조정한 뒤 실행합니다.

```bash
systemctl daemon-reload
systemctl enable --now neural-chat
```

앱 설정과 대화 데이터는 기본적으로 실행 디렉터리의 `data/neural-chat.sqlite3`에 저장됩니다. 운영 환경에서는 예시 서비스처럼 `NEURAL_CHAT_DATA_DIR=/var/lib/neural-chat`을 반드시 지정하고 해당 디렉터리를 서비스 사용자만 읽고 쓸 수 있게 두는 것을 권장합니다. DB 파일만 별도 위치에 둘 경우 `NEURAL_CHAT_DB_PATH`를 사용할 수 있습니다. 저장된 API 키는 브라우저 응답에 다시 포함되지 않습니다.

SQLite는 WAL 모드, 외래키 검사, 5초 busy timeout을 사용하며 대화의 모든 브랜치와 메시지는 한 트랜잭션으로 저장됩니다. 사용자 메시지 편집, 모델 응답 편집, 응답 재생성은 모두 기존 경로를 보존한 새 브랜치를 생성합니다. 수정본이 있는 각 메시지 아래의 `< m / n >` 탐색기로 해당 메시지의 이전·다음 수정본과 연결된 채팅 기록을 즉시 전환할 수 있으며, 상단 브랜치 선택기는 전체 경로를 고르는 보조 수단으로 유지됩니다. 내보내기는 선택 브랜치의 Markdown 또는 모든 브랜치가 포함된 JSON을 지원합니다.

이미지는 한 메시지에 최대 12장, 장당 20MB까지 첨부할 수 있습니다. 이미지 메타데이터와 메시지 연결은 SQLite에 저장하고, DB 비대화를 막기 위해 원본과 브라우저에서 생성한 경량 썸네일은 `data/uploads`에 분리 저장합니다. 모델 요청에는 원본이 data URL로 전달됩니다. 채팅 화면에서는 썸네일만 지연 로딩하고 클릭할 때 원본을 엽니다.

기존 `data/config.json`, `data/conversations/*.json`, `data/uploads/*.json`은 최초 실행 때 한 번 자동으로 SQLite에 이전됩니다. 이전이 끝난 원본 파일은 안전을 위해 삭제하지 않으며 이후에는 SQLite 데이터가 기준이 됩니다. 구버전 `app-config.json`에 앱 설정을 보관했다면 업데이트 전에 해당 파일을 `data/config.json`으로 복사하면 같은 이관 경로를 사용할 수 있습니다.

긴 대화는 최근 60개 메시지만 먼저 렌더링하고 이전 메시지를 60개 단위로 추가 표시합니다. 사이드바 기록은 전체 대화 대신 SQLite 요약 쿼리만 읽습니다.

## 운영 및 백업

SQLite와 로컬 업로드 파일을 사용하므로 한 데이터 디렉터리를 여러 앱 인스턴스가 동시에 공유하지 마세요. 다중 인스턴스가 필요하면 PostgreSQL과 객체 스토리지로 이전해야 합니다. 실행 중인 DB는 WAL 파일만 단순 복사하지 말고 SQLite의 online backup 기능으로 백업한 뒤 `uploads` 디렉터리도 함께 보관합니다.

```bash
sqlite3 /var/lib/neural-chat/neural-chat.sqlite3 ".backup '/backup/neural-chat.sqlite3'"
cp -a /var/lib/neural-chat/uploads /backup/uploads
```

모델 응답은 GitHub Flavored Markdown으로 렌더링되며 목록, 링크, 표, 인라인 코드와 코드 블록을 지원합니다. 사용자 메시지는 입력한 일반 텍스트 그대로 표시됩니다. 완료된 모델 응답은 응답 아래의 편집 버튼으로 현재 브랜치 안에서 수정할 수 있습니다.

## Reasoning 동작

- **Built-in** 프리셋은 선택한 값을 OpenAI 호환 요청의 `reasoning_effort`로 전달합니다.
- **Custom template**은 선택한 내장 effort를 전달한 뒤, 템플릿 내용을 모델/alias 시스템 프롬프트 뒤에 추가합니다.
- Qwen3.8의 화면상 **Extra High**는 실제 서버가 허용하는 API 값인 `xhigh`로 전송됩니다.
- 입력창의 Reasoning 메뉴에서 이전 assistant 응답의 `reasoning_content`를 다음 요청에 포함할지 선택할 수 있습니다.
- Reasoning 생성 중에는 최근 내용이 약 5줄 높이로 스트리밍되고, 완료 후에는 실제 측정한 소요 시간을 `Thought for …` 또는 `… 동안 생각함`으로 표시합니다.
- 모델 감지는 `/models`를 조회한 뒤 잘 알려진 reasoning 모델 이름을 기준으로 기능을 추정합니다. 호환 API에 표준 capability 필드가 없으므로 설정에서 언제든 수동으로 덮어쓸 수 있습니다.
- `/models`가 반환한 항목은 Models 관리 목록에 모두 보존됩니다. 모델별 **메인 인터페이스에 표시** 토글을 끄면 모델 선택기와 Reasoning 설정 목록에서만 숨겨집니다.
- 커스텀 Reasoning 템플릿의 시스템 프롬프트는 모델 프롬프트를 `Replace`, `Prepend`, `Append`하는 세 가지 방식으로 조합할 수 있습니다.
- 커스텀 모델은 별도 모델을 복제하지 않는 alias입니다. 표시 이름과 ID, 시스템 프롬프트만 독립적으로 가지며 요청은 기반 모델의 ID로 전송됩니다.

## 언어

좌측 하단 프로필을 눌러 `설정 > 일반`에서 전체 인터페이스 언어를 변경할 수 있습니다. 선택한 언어는 변경사항을 저장하면 다음 접속에도 유지됩니다.
