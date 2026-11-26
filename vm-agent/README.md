# NeuralNetUI 가상 컴퓨터

모델이 직접 쓰는 "내 컴퓨터"입니다. 리눅스(LXC·Docker·실제 컴퓨터)나 macOS에 설치하면 NeuralNetUI의
**설정 > MCP·가상 컴퓨터**에 등록해 다음을 쓸 수 있습니다.

| 기능 | 도구 |
| --- | --- |
| 컴퓨터 정보 (OS, 배포판, GUI 여부, 브라우저, 작업 공간) | `computer_info` |
| 셸 스크립트 실행 (끝날 때까지 대기, 진행 상황 전송) | `shell_run` |
| 백그라운드 작업 (시작·출력 읽기·목록·종료) | `shell_start`, `shell_output`, `shell_jobs`, `shell_kill` |
| 화면 캡처, 마우스, 키보드 (GUI가 있을 때만) | `screen_capture`, `mouse`, `keyboard` |
| 개인 저장소와 파일 주고받기 (NeuralNetUI가 제공) | `copy_to_storage`, `copy_from_storage` |
| 브라우저 | 등록하면 NeuralNetUI의 브라우저 도구가 이 컴퓨터의 Obscura(스텔스, 렌더링 포함)에서 실행됩니다 |

NeuralNetUI 계정마다 작업 공간이 따로 생깁니다. 리눅스에서 root로 실행하면 계정마다 별도 리눅스 사용자
(`nnui-…`)와 홈 폴더를, 그 밖에는 폴더를 씁니다. 같은 컴퓨터를 여러 사람이 등록해도 서로의 파일이 보이지 않습니다.

## 설치

### 한 줄 설치 (리눅스 systemd / macOS launchd)

NeuralNetUI의 MCP 설정에 있는 명령을 복사해 실행합니다.

```bash
curl -fsSL https://<NeuralNetUI 주소>/api/vm/install | sudo bash -s -- --tunnel-token '<토큰 또는 cloudflared 명령 전체>'
```

| 옵션 | 뜻 |
| --- | --- |
| `--tunnel-token` | Cloudflare Tunnel 토큰. 대시보드의 `cloudflared service install …` 명령을 통째로 넣어도 토큰만 골라 씁니다 |
| `--bind 0.0.0.0` | 터널 없이 같은 네트워크에서 직접 접속 (기본 127.0.0.1) |
| `--port` | 포트 (기본 8765) |
| `--gui` | 화면·입력 도구 설치 (리눅스: xdotool, ImageMagick / macOS: cliclick) |
| `--key` | 키를 직접 지정 (기본: 새로 만들어 출력) |
| `--no-browser` / `--no-service` | Obscura 설치 생략 / 서비스 등록 생략 |

끝나면 주소와 키가 출력됩니다. Cloudflare 대시보드에서 터널의 공개 호스트명을 `http://localhost:8765`로 연결하고,
NeuralNetUI에는 `https://<호스트명>/mcp`와 키를 넣습니다.

### Docker (Ubuntu 26.04)

```bash
cd vm-agent
NNUI_VM_KEY=... CLOUDFLARE_TUNNEL_TOKEN='...' docker compose up -d --build        # 화면 없음
GUI=1 NNUI_VM_KEY=... CLOUDFLARE_TUNNEL_TOKEN='...' docker compose up -d --build  # XFCE 데스크톱 포함
```

`NNUI_VM_KEY`를 비우면 키를 만들어 로그(`docker compose logs vm`)와 `/var/lib/neuralnetui-vm/key`에 남깁니다.

## 보안

- 모든 요청에 `Authorization: Bearer <키>`가 필요합니다. 키는 설정 파일(권한 600)에만 저장됩니다.
- 셸·마우스·키보드 도구는 NeuralNetUI에서 기본으로 "항상 묻기"입니다. 도구 권한에서 바꿀 수 있습니다.
- 파일 전송은 작업 공간(홈 폴더) 밖으로 나갈 수 없습니다.
