# YouTube 자막 MCP (youtube-subtitle)

모델에게 유튜브 링크를 주면 [yt-dlp](https://github.com/yt-dlp/yt-dlp)로 영상의 자막을 가져와 텍스트로 돌려주는 MCP 서버입니다. 모델은 이 텍스트로 영상을 요약하거나 내용을 인용합니다. Docker 컨테이너로 실행하고, NeuralNetUI에는 일반 MCP 연결로 추가합니다.

## 도구

| 도구 | 하는 일 |
| --- | --- |
| `get_youtube_subtitles` | 제목·채널·길이·업로드 날짜와 함께 자막 전문을 텍스트로 돌려줍니다 |
| `list_youtube_subtitles` | 영상이 제공하는 자막 언어(업로드 자막, 자동 자막)를 보여 줍니다 |

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

## 설치

Docker와 Docker Compose v2가 필요합니다.

```bash
cd mcp-extensions/youtube-subtitle
mkdir -p config
docker compose up -d --build
```

처음 시작할 때 `config/config.json`이 없거나 `api_key`가 비어 있으면 서버가 64자리 비밀키를 만들어 저장합니다. 키는 로그에 출력하지 않으니 파일에서 확인합니다.

```bash
cat config/config.json
```

`config` 폴더는 반드시 먼저 만들어야 합니다. Docker가 대신 만들면 root 소유가 되어 컨테이너가 키를 저장하지 못합니다. 컨테이너는 호스트의 현재 사용자(`UID`/`GID`, 기본 1000)로 실행됩니다.

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
python -m venv .venv && .venv/bin/pip install -r requirements.txt yt-dlp==2026.10.26
.venv/bin/python -m unittest -v test_subtitles
YOUTUBE_SUBTITLE_CONFIG=./config/config.json .venv/bin/python server.py
```
