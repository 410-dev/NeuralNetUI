# MCP 확장

NeuralNetUI와 함께 쓰도록 만든 MCP 서버 모음입니다. 각 확장은 독립된 Docker 컨테이너로 실행하고, NeuralNetUI의 `설정 > MCP 연결`에서 일반 MCP 연결로 추가합니다. 관리자가 사설망 주소로 직접 붙이거나, 공개 HTTPS 주소를 두고 모든 사용자가 각자 연결할 수 있습니다.

| 확장 | 하는 일 |
| --- | --- |
| [youtube-subtitle](youtube-subtitle/README.md) | 유튜브 링크의 자막을 가져와 모델이 영상을 요약하게 하고, 요청하면 영상 파일을 개인 저장소에 저장합니다 |

## 공통 규칙

- Streamable HTTP MCP를 `/mcp` 경로에서 제공합니다.
- `config/config.json`의 `api_key`로 접근을 막습니다. 처음 시작할 때 키가 없으면 자동으로 만듭니다. NeuralNetUI에서는 인증 방식 **API Key**로 이 키를 넣습니다.
- `config/` 폴더는 저장소에 올리지 않습니다.
- `/health`는 키 없이 열려 있어 컨테이너 상태 확인에 씁니다.
- 오래 걸리는 도구는 MCP 진행 알림을 보내 NeuralNetUI의 타임아웃이 끊지 않게 합니다.
- 파일을 사용자 저장소에 넣을 때는 `_meta["nnui/saveToStorage"]`가 붙은 `resource_link`를 돌려줍니다([도구 문서](../docs/features/tools.md#mcp-연결) 참고).
