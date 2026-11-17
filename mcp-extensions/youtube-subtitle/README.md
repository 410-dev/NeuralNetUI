# YouTube 자막·영상 MCP (youtube-subtitle)

모델에게 유튜브 링크를 주면 [yt-dlp](https://github.com/yt-dlp/yt-dlp)로 영상의 자막을 가져와 텍스트로 돌려주는 MCP 서버입니다. 모델은 이 텍스트로 영상을 요약하거나 내용을 인용합니다. 요청하면 영상 파일 자체를 내려받아 사용자의 NeuralNetUI 개인 저장소에 저장할 수도 있습니다. Docker 컨테이너로 실행하고, NeuralNetUI에는 일반 MCP 연결로 추가합니다.

## 도구

| 도구 | 하는 일 |
| --- | --- |
| `get_youtube_subtitles` | 제목·채널·길이·업로드 날짜와 함께 자막 전문을 텍스트로 돌려줍니다 |
| `list_youtube_subtitles` | 영상이 제공하는 자막 언어(업로드 자막, 자동 자막)를 보여 줍니다 |
| `download_youtube_video` | 영상을 내려받아 사용자의 개인 저장소에 저장합니다 |

`get_youtube_subtitles`의 인자:

| 인자 | 기본값 | 설명 |
| --- | --- | --- |
| `url` | (필수) | `youtube.com/watch`, `youtu.be`, `shorts`, `live` 링크 또는 11자리 영상 ID |
| `language` | 자동 | `ko`, `en` 같은 언어 코드. 비우면 아래 순서로 고릅니다 |
| `include_timestamps` | `false` | 문단마다 `[3:05]` 같은 시각을 붙입니다 |
| `offset` | `0` | 긴 자막의 다음 페이지. 이전 응답이 알려 준 값을 그대로 씁니다 |

자막 선택 순서는 다음과 같습니다.

1. 영상 원어로 올라온 자막
2. `config.json`의 `preferred_languages` 순서로 올라온 자막
3. 그 밖에 올라온 자막
4. 원어 자동 자막
5. `preferred_languages`의 자동 자막(기계 번역이면 응답에 표시)

한 번에 돌려주는 글자 수는 `max_chars`(기본 60,000자, 한국어 기준 약 1시간 분량)입니다. 이보다 긴 자막은 응답에 `offset=…`로 다시 호출하라는 안내가 붙고, 모델이 이어서 가져옵니다.

### 영상 다운로드 (`download_youtube_video`)

| 인자 | 기본값 | 설명 |
| --- | --- | --- |
| `url` | (필수) | 유튜브 영상 링크 또는 11자리 영상 ID |
| `max_height` | 없음(최고 화질) | 해상도 상한(예: `1080`). 비우면 가장 좋은 화질 |

- 기본값은 **가장 좋은 영상 + 가장 좋은 오디오**를 합친 파일이고 자막은 넣지 않습니다. 4K는 보통 AV1·VP9 영상과 Opus 오디오라 `.webm`이나 `.mkv`로 저장됩니다.
- 진행 순서: 영상 정보 확인 → 영상·오디오 다운로드 → ffmpeg로 합치기 → SHA-256 계산 → NeuralNetUI가 파일을 받아 개인 저장소에 저장 → 서버의 사본 삭제.
- 다운로드하는 동안 서버가 MCP 진행 알림을 계속 보냅니다(조용한 단계에서도 2초마다). NeuralNetUI는 진행 알림을 받을 때마다 도구 타임아웃을 다시 시작하므로, 진행이 이어지는 한 연결의 타임아웃(예: 20초)보다 오래 걸려도 끊기지 않습니다. 진행 상황은 채팅의 도구 활동에 표시됩니다.
- 저장소로 옮기는 단계도 전체 시간 제한이 없고, 데이터가 1분(또는 연결 타임아웃 중 긴 쪽) 동안 오지 않을 때만 실패로 봅니다.
- 저장소로 옮기다 실패하면(연결 끊김, 크기나 체크섬 불일치, 할당량 초과) 그 파일은 저장소에 남지 않습니다. NeuralNetUI는 할당량을 먼저 예약하고 별도 영역에 받은 뒤 크기와 SHA-256이 맞을 때만 저장소에 등록하며, 실패하면 예약과 받던 데이터를 지웁니다.
- 호출한 쪽이 기다림을 멈추면(생성 중단, 연결 끊김) 서버도 다운로드를 멈추고 받던 파일을 지웁니다.
- 한 번에 최대 2개를 동시에 내려받습니다. `max_download_bytes`(기본 8GB)를 넘거나 서버 디스크 여유가 부족하면 시작하지 않습니다. 저장소 할당량은 NeuralNetUI 플랜을 따릅니다.

파일은 MCP 표준 `resource_link`로 돌려주며, `_meta`에 `nnui/saveToStorage: true`와 서버 기준 상대 경로 `nnui/path`, `sha256`을 담습니다. NeuralNetUI는 이 표시가 있는 링크만, 그리고 MCP 연결과 **같은 호스트**의 경로일 때만 같은 API 키로 받아 갑니다. 받은 뒤에는 같은 경로로 `DELETE`를 보내 서버의 사본을 지웁니다.

## 설치

Docker와 Docker Compose v2가 필요합니다.

```bash
cd mcp-extensions/youtube-subtitle
mkdir -p config downloads
docker compose up -d --build
```

처음 시작할 때 `config/config.json`이 없거나 `api_key`가 비어 있으면 서버가 64자리 비밀키를 만들어 저장합니다. 키는 로그에 출력하지 않으니 파일에서 확인합니다.

```bash
cat config/config.json
```

`config`와 `downloads` 폴더는 반드시 먼저 만들어야 합니다. Docker가 대신 만들면 root 소유가 되어 컨테이너가 키와 영상을 저장하지 못합니다. 컨테이너는 UID/GID 1000으로 실행되므로 폴더 소유자가 1000이어야 합니다. root로 설치한다면 다음처럼 맞춥니다.

```bash
mkdir -p config downloads && chown 1000:1000 config downloads && chmod 700 config downloads
```

이미지에는 영상과 오디오를 합치는 ffmpeg와, 유튜브의 전체 화질 목록을 받는 데 필요한 JavaScript 런타임(deno)이 들어 있습니다.

다른 사용자로 실행하려면 `YOUTUBE_SUBTITLE_UID`, `YOUTUBE_SUBTITLE_GID` 환경 변수로 지정합니다(셸의 `UID`는 읽기 전용이라 쓰지 않습니다).

동작 확인:

```bash
curl http://localhost:8080/health
```

## NeuralNetUI에 연결

`설정 > MCP 연결`에서 새 연결을 만듭니다.

| 항목 | 값 |
| --- | --- |
| 연결 URL | `http://<서버 주소>:8080/mcp` (경로 `/mcp`까지 입력) |
| 인증 방식 | API Key |
| 토큰 또는 API 키 | `config/config.json`의 `api_key` |

**연결 테스트**에서 도구 2개가 보이면 끝입니다. 이후 채팅의 `+` 메뉴 MCP 섹션에서 연결을 켜고 유튜브 링크와 함께 요약을 요청하면 됩니다.

- NeuralNetUI는 일반 계정에게 공개 주소만 허용합니다. 사설망·Tailscale 주소(`http://100.x.x.x:8080/mcp` 등)는 관리자 계정에서만 연결할 수 있습니다.
- 모든 사용자에게 열려면 HTTPS 공개 주소를 둡니다. Cloudflare Tunnel이라면 공개 호스트 이름의 서비스를 **`HTTP`** `localhost:8080`으로 지정합니다. 이 서버는 TLS를 직접 다루지 않으므로 `HTTPS`로 지정하면 502가 납니다.
- 키는 `Authorization: Bearer <키>` 또는 `X-API-Key: <키>` 헤더로 받습니다. 키가 없거나 틀리면 401입니다. `/health`만 키 없이 열려 있습니다.

## 설정 (`config/config.json`)

| 키 | 기본값 | 설명 |
| --- | --- | --- |
| `api_key` | 자동 생성 | 접근 키. 바꾸면 컨테이너를 재시작하고 NeuralNetUI 연결의 키도 바꿉니다 |
| `host`, `port` | `0.0.0.0`, `8080` | 컨테이너 안에서 듣는 주소. 바깥 포트는 `YOUTUBE_SUBTITLE_PORT`(compose)로 바꿉니다 |
| `max_chars` | `60000` | 한 번에 돌려줄 자막 글자 수 |
| `preferred_languages` | `["ko", "en"]` | 원어 자막이 없을 때 고를 언어 순서 |
| `cookies_file` | 빈 값 | 로그인해야 보이는 영상용 Netscape 형식 쿠키 파일 경로(컨테이너 안, 예: `/config/cookies.txt`) |
| `proxy` | 빈 값 | yt-dlp가 쓸 프록시. 서버 IP가 유튜브에 막혔을 때 사용 |
| `download_dir` | `/downloads` | 내려받은 영상이 NeuralNetUI로 옮겨질 때까지 머무는 곳(컨테이너 안) |
| `download_ttl_minutes` | `120` | 옮겨 가지 않은 영상과 중단된 다운로드를 지우기까지의 시간 |
| `max_download_bytes` | `8589934592` (8GB) | 한 영상의 최대 크기. 넘으면 다운로드를 시작하지 않습니다 |
| `public_base_url` | 빈 값 | 결과 링크에 쓸 이 서버의 공개 주소(선택). NeuralNetUI는 이 값과 상관없이 연결 URL 기준으로 받아 갑니다 |

설정을 바꾼 뒤에는 `docker compose restart`로 반영합니다.

## 유지 보수

- **자막을 못 가져올 때**: 유튜브는 자주 바뀌어 yt-dlp를 최신으로 올려야 할 때가 많습니다.

  ```bash
  docker compose build --build-arg YT_DLP_VERSION=<새 버전> && docker compose up -d
  ```

  새 버전으로 동작을 확인했다면 `Dockerfile`의 기본값도 같이 올립니다.
- **"Sign in to confirm you're not a bot"**: 데이터센터 IP에서 자주 납니다. `cookies_file`이나 `proxy`를 설정합니다.
- **보안**: `url`은 유튜브 주소만 받습니다. yt-dlp가 다른 사이트로 요청을 보내는 데 쓰일 수 없습니다. 재생목록과 채널은 지원하지 않습니다.
- yt-dlp는 JavaScript 런타임 없이도 자막을 가져옵니다. 영상 다운로드에 필요한 런타임(deno)은 이미지에 넣지 않았습니다.

## 개발

```bash
python -m venv .venv && .venv/bin/pip install -r requirements.txt "yt-dlp[default]==2026.10.26"
.venv/bin/python -m unittest -v test_subtitles test_downloads
YOUTUBE_SUBTITLE_CONFIG=./config/config.json .venv/bin/python server.py
```
