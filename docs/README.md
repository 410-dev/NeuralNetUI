# NeuralNetUI 문서

NeuralNetUI의 설치, 설정, 기능, 운영 문서를 모아둔 곳입니다. 처음이라면 [시작하기](getting-started.md)부터 읽으세요.

## 설치와 운영

| 문서 | 내용 |
| --- | --- |
| [시작하기](getting-started.md) | 요구 사항, 소스 실행, 간편 호스팅, 최초 설정 절차 |
| [배포](deployment.md) | Windows MSI, Docker, LXC/systemd 배포와 업데이트 |
| [설정 파일과 환경 변수](configuration.md) | `app-config.json`, 환경 변수, 데이터 저장 위치, 설정의 적용 범위 |
| [운영과 백업](operations.md) | 회귀 검증, 백업/복원, 업그레이드, 문제 해결 |
| [아키텍처](architecture.md) | 기술 스택, 디렉터리 구조, 데이터베이스 스키마, API 라우트 |

## 기능

| 문서 | 내용 |
| --- | --- |
| [대화](features/chat.md) | 브랜치, 편집·재생성, 첨부, 렌더링, 검색, 내보내기 |
| [모델과 연결](features/models.md) | 드라이버, 모델 감지, 커스텀 모델, 온디맨드 로드, 상주 관리 |
| [Reasoning](features/reasoning.md) | 내장/커스텀 프리셋, 능력 감지, 추론 표시 |
| [도구](features/tools.md) | 인터넷 검색, 페이지 방문, 브라우저, 저장소 접근, 선택형 질문, 호스트 컴퓨터 |
| [개인 저장소](features/storage.md) | 업로드, 할당량, 휴지통, 참조 보호 |
| [하네스와 컨텍스트](features/harness.md) | 롤링/압축, 재개, 제목 생성, 도구·파일 한도 |
| [사용자와 권한](features/users.md) | 역할, 감사, 데이터 격리, 워크스페이스 기본값 |
| [모양과 언어](features/appearance.md) | 액센트, 스트리밍 표현, 인사말, 언어 |

## 레퍼런스

| 문서 | 내용 |
| --- | --- |
| [설정 레퍼런스](settings-reference.md) | 설정 화면의 모든 항목, 허용 범위, 기본값, 필요한 권한 |
| [변경 이력](../Changelogs.md) | 릴리스별 변경 요약 |
| [릴리스 감사 기록](audits/) | 릴리스별 검증 기록과 MSI 해시 |
| [디자인 가이드](../design/MASTER.md) | 프론트엔드 디자인 언어 규칙 |
