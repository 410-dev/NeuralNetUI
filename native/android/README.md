# Neural Chat for Android

현재 웹 UI를 Android 프레임워크만으로 다시 구현한 독립 네이티브 앱입니다. WebView, 웹 페이지 연결, React Native 또는 외부 UI 라이브러리를 사용하지 않습니다.

## 구현 범위

- 모바일 초기 화면, 배경 글로우, 인사말, 모델 선택기와 메시지 작성 카드
- 슬라이드 채팅 기록 메뉴와 프로필 진입
- 일반·연결·모델·Reasoning 설정 화면
- 이미지 선택, Reasoning 프리셋, 사용자/어시스턴트 채팅 표시
- OpenAI 호환 `GET /models`, `POST /chat/completions` 직접 연결
- 한국어/영어, On demand, 서버 주소, API 키, 표시 이름 로컬 저장

기본 서버 주소는 Android Emulator에서 호스트 PC를 가리키는 `http://10.0.2.2:8888/v1`입니다. 실기기에서는 설정 → 연결에서 접근 가능한 서버 주소로 변경하세요.

## 빌드

Android Studio에서 이 디렉터리를 프로젝트로 열어 빌드할 수 있습니다. Android SDK 36과 Build Tools 36.0.0이 이미 준비된 Windows 환경에서는 별도 다운로드 없이 다음 명령으로도 디버그 APK를 생성할 수 있습니다.

```powershell
.\build-offline.ps1
```

출력: `app/build/outputs/apk/debug/app-debug.apk`
