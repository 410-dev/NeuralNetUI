# NeuralNetUI mobile app

A thin Expo app that opens the NeuralNetUI web UI in a WebView and adds what a browser tab cannot:

- **Keyboard in step with the layout.** The window does not resize for the keyboard
  (`react-native-keyboard-controller`). When the keyboard starts to move, the app sends the page
  its final height and duration (`nnui-native-keyboard` event), and the page shrinks its shell on the
  same curve (`app/page.tsx`, active only when the user agent carries `NeuralNetUIApp/`).
- Android back walks the page's history, then offers to change the server or quit.
- Links to other sites open in the system browser.

The server address is asked on first launch and kept on the device.

## Build an APK (Android)

```bash
npm ci
npx expo prebuild -p android --clean
cd android && ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a
# android/app/build/outputs/apk/release/app-release.apk
```

Needs JDK 17–21 and the Android SDK (`ANDROID_HOME`). Release builds are signed with the template's
debug key for now; a real release key comes before any store distribution.

`android/` and `ios/` are generated; configure native behaviour in `app.json` instead.
