# NeuralNetUI mobile app

A thin Expo app that opens the NeuralNetUI web UI in a WebView and adds what a browser tab cannot:

- **Keyboard in step with the layout.** The window does not resize for the keyboard
  (`react-native-keyboard-controller`). When the keyboard starts to move, the app sends the page
  its final height and duration (`nnui-native-keyboard` event), and the page shrinks its shell on the
  same curve (`app/page.tsx`, active only when the user agent carries `NeuralNetUIApp/`).
- Android back walks the page's history, then offers to change the server or quit.
- Links to other sites open in the system browser.
- Agent notifications over FCM: urgent ones ring and pop up (channel `agent-urgent`), the rest arrive silently
  (channel `agent`). The page asks the app for permission and the token and registers it with the server
  (`lib/native-bridge.ts`, `/api/agent/push`). The server needs `secrets/firebase-admin.json`.

The server address is asked on first launch and kept on the device.

## Build an APK (Android)

```bash
npm ci
GOOGLE_SERVICES_JSON=/path/to/google-services.json npx expo prebuild -p android --clean
cd android && ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a
# android/app/build/outputs/apk/release/app-release.apk
```

Needs JDK 17–21 and the Android SDK (`ANDROID_HOME`). `google-services.json` (Firebase, package
`dev.hysong.neuralnetui`) is never committed; without it the app builds but cannot receive notifications. Release builds are signed with the template's
debug key for now; a real release key comes before any store distribution.

`android/` and `ios/` are generated; configure native behaviour in `app.json` instead.
