# 배포

같은 애플리케이션을 네 가지 방식으로 구동할 수 있습니다. 어느 방식이든 데이터는 SQLite 한 파일과 `uploads` 디렉터리에 모입니다.

| 방식 | 런타임 포함 | 자동 시작 | 데이터 위치(기본) |
| --- | --- | --- | --- |
| 호스팅 스크립트 | 아니요 | 아니요 | `./data` |
| Windows MSI | 예(Node·Python·Chromium) | Windows 서비스 | `%ProgramData%\Neural Chat\data` |
| Docker | 예 | `restart: unless-stopped` | 프로젝트의 `./data` 볼륨 |
| LXC / systemd | 아니요 | systemd 유닛 | `NEURAL_CHAT_DATA_DIR` |

## 호스팅 스크립트

가장 단순한 상시 구동 방법입니다. 사용법은 [시작하기](getting-started.md#간편-호스팅-스크립트)에 있습니다. 수신 주소·포트·접근 범위는 `app-config.json`에서 정하며, `PORT`와 `NEURAL_CHAT_HOST` 환경 변수가 파일 값보다 우선합니다.

## Windows MSI

`installer/build-msi.ps1`이 만드는 `installer/output/NeuralNetUI-<버전>-x64.msi`에는 Node.js, 앱 런타임, 헤드리스/헤디드 Chromium, 임베디드 Python, Windows 서비스, 트레이 앱이 모두 포함됩니다. (빌드 산출물 디렉터리는 저장소에 커밋되지 않습니다.)

### 설치

설치 화면의 **Hosting access** 단계에서 원격 접속 범위(LAN만, Tailscale만, 둘 다)와 수신 포트를 고릅니다. 설치가 끝나면

- `NeuralNetUI Service` Windows 서비스가 자동 시작 유형으로 등록되고,
- 현재 로그인 사용자에게 Web UI와 트레이 아이콘이 열립니다.

이후 부팅에서는 서비스가 먼저 시작되고, 사용자가 로그인하면 Web UI와 트레이 아이콘이 열립니다. 트레이 앱은 `--startup` 인자로 실행될 때 브라우저를 열지 않으므로, 로그인할 때마다 창이 뜨지는 않습니다.

### 트레이와 시작 메뉴

| 조작 | 동작 |
| --- | --- |
| 트레이 아이콘 더블 클릭 | Web UI 다시 열기 |
| 트레이 우클릭 → 설정 파일 수정 | `%ProgramData%\Neural Chat\app-config.json` 편집 |
| 트레이 우클릭 → 재시작 | 서비스 재시작 |
| 트레이 우클릭 → 종료하기 | 서비스와 트레이 앱을 함께 중지 |
| 시작 메뉴 → NeuralNetUI | 중지된 서비스를 다시 시작하고 Web UI와 트레이 아이콘 복원 |

서비스 제어와 보호된 설정 파일 편집에는 Windows 관리자 권한 확인이 표시될 수 있습니다.

### 설치 후 설정 변경

호스팅 설정은 `%ProgramData%\Neural Chat\app-config.json`에 있습니다. `server.port` 또는 `server.accessMode`를 바꾼 뒤 관리자 권한으로 다음을 실행하면 서비스와 Windows 방화벽 규칙이 새 설정으로 동기화됩니다.

```powershell
Restart-Service NeuralChat
```

앱 데이터와 로그는 `%ProgramData%\Neural Chat\data`에 보존되며, 업그레이드해도 유지됩니다.

### 무인 설치

```powershell
msiexec /i NeuralNetUI-<버전>-x64.msi /qn ACCESS_MODE=tailscale APP_PORT=65500
```

`ACCESS_MODE`는 `lan`, `tailscale`, `lan-and-tailscale` 중 하나입니다.

### MSI 다시 빌드

Node.js와 .NET 8 SDK가 있는 Windows x64 환경에서 실행합니다. WiX 5 도구는 첫 빌드 때 `installer/.tools`에 로컬 설치됩니다.

```powershell
.\installer\build-msi.ps1
```

> Windows Installer는 버전의 앞 세 자리만 비교합니다. 네 번째 자리만 바뀌는 릴리스를 배포하려면 `MajorUpgrade AllowSameVersionUpgrades="yes"`가 필요합니다.

## Docker

Docker Desktop(Windows) 또는 Docker Engine + Docker Compose v2(Linux)가 있으면 스크립트 하나로 이미지 빌드와 컨테이너 시작을 합니다.

Windows:

```bat
deploy-docker-windows.bat
```

Linux:

```bash
chmod +x deploy-docker-linux.sh
./deploy-docker-linux.sh
```

기본 접속 주소는 `http://localhost:3000`이고, SQLite DB와 업로드 파일은 프로젝트의 `data` 디렉터리에 계속 보존됩니다.

외부 포트 변경:

```bat
set NEURAL_CHAT_PORT=65500
deploy-docker-windows.bat
```

```bash
NEURAL_CHAT_PORT=65500 ./deploy-docker-linux.sh
```

| Compose 변수 | 기본값 | 용도 |
| --- | --- | --- |
| `NEURAL_CHAT_PORT` | `3000` | 호스트에 노출할 포트 |
| `NEURAL_CHAT_DATA_PATH` | `./data` | 마운트할 데이터 디렉터리 |
| `NEURAL_CHAT_UID` / `NEURAL_CHAT_GID` | `1000` | 컨테이너 실행 사용자 |

호스트 PC에서 실행 중인 OpenAI 호환 서버에 연결할 때는 Base URL에 `http://host.docker.internal:8888/v1`처럼 `host.docker.internal`을 사용합니다. Windows와 Linux 모두 Compose에서 이 호스트 이름이 동작하도록 `extra_hosts`가 설정되어 있습니다.

로그 확인과 종료:

```bash
docker compose logs -f neural-chat
docker compose down
```

## LXC / systemd

Node.js 22 이상만 있으면 Docker 없이 수동 빌드·배포할 수 있습니다.

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

정적 자산 폴더가 추가되면 `public`도 `/opt/neural-chat/public`으로 복사합니다. 이어서 `deploy/neural-chat.service.example`을 `/etc/systemd/system/neural-chat.service`로 복사하고 사용자·경로를 환경에 맞게 고친 뒤 실행합니다.

```bash
systemctl daemon-reload
systemctl enable --now neural-chat
```

예시 유닛은 `NEURAL_CHAT_DATA_DIR=/var/lib/neural-chat`을 지정하고 `ProtectSystem=strict`와 `ReadWritePaths`로 쓰기 범위를 제한합니다. 운영 환경에서는 데이터 디렉터리를 서비스 사용자만 읽고 쓸 수 있게 두는 것을 권장합니다.

## 리버스 프록시와 터널

- 개인 저장소 업로드는 8 MiB 청크로 나뉘어 전송되므로, Cloudflare Tunnel의 100 MB 요청 제한 같은 상한에 걸리지 않습니다.
- 비보안 HTTP 출처(LAN·Tailscale 직접 접속)에서는 브라우저가 Web Crypto와 클립보드 API를 숨깁니다. 앱은 충돌 방지 ID 생성과 선택 기반 복사로 자동 대체하므로 동작에는 문제가 없습니다.
- 스트리밍은 SSE를 사용합니다. 프록시를 둔다면 응답 버퍼링을 꺼야 토큰이 실시간으로 도착합니다.

## 업데이트

| 방식 | 절차 |
| --- | --- |
| 소스 / 호스팅 스크립트 | `git pull` 후 `host-windows.bat --rebuild` 또는 `./host-linux.sh --rebuild` |
| Docker | `git pull` 후 배포 스크립트를 다시 실행(이미지 재빌드) |
| Windows MSI | 새 MSI를 그대로 설치(상위 업그레이드). `%ProgramData%`의 데이터와 설정은 유지 |
| LXC / systemd | 빌드 후 파일을 다시 복사하고 `systemctl restart neural-chat` |

데이터베이스 마이그레이션은 서버 기동 시 자동으로 적용됩니다. 업데이트 전에 [백업](operations.md#백업과-복원)을 먼저 하세요.
