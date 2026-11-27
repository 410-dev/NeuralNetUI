import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, BackHandler, Linking, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { KeyboardEvents, KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView as WebViewBase } from "react-native-webview";
import type { WebViewNavigation } from "react-native-webview/lib/WebViewTypes";
import type { WebViewProps } from "react-native-webview/lib/WebView";
import * as Notifications from "expo-notifications";
import { ensureChannels, handlePushRequest, notificationData } from "./push";

/** The commands the WebView's ref exposes at runtime (its typings declare a plain function component). */
type WebViewHandle = { goBack(): void; injectJavaScript(script: string): void };
const WebView = WebViewBase as unknown as React.ComponentType<WebViewProps & { ref?: React.Ref<WebViewHandle> }>;

const BACKGROUND = "#0a0a0c";
const SERVER_KEY = "nnui.server";
/** The page recognises the app by this token and lets it drive the keyboard layout. */
const USER_AGENT_TOKEN = "NeuralNetUIApp/0.2.2";

export default function App() {
  return <SafeAreaProvider>
    <KeyboardProvider preserveEdgeToEdge>
      <StatusBar style="light" />
      <Root />
    </KeyboardProvider>
  </SafeAreaProvider>;
}

function Root() {
  const [server, setServer] = useState<string | null | undefined>(undefined);
  useEffect(() => { AsyncStorage.getItem(SERVER_KEY).then(value => setServer(value || null), () => setServer(null)); }, []);
  const choose = useCallback(async (value: string | null) => {
    if (value) await AsyncStorage.setItem(SERVER_KEY, value); else await AsyncStorage.removeItem(SERVER_KEY);
    setServer(value);
  }, []);
  if (server === undefined) return <View style={styles.fill} />;
  if (!server) return <ServerSetup onDone={choose} />;
  return <Shell server={server} onChangeServer={() => void choose(null)} />;
}

/** Accepts `host`, `host:port` or a full URL and returns the origin-like base without a trailing slash. */
function normalizeServer(input: string) {
  const trimmed = input.trim().replace(/\/+$/, "");
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try { const url = new URL(withScheme); return url.protocol === "http:" || url.protocol === "https:" ? withScheme : null; } catch { return null; }
}

function ServerSetup({ onDone }: { onDone: (value: string) => void }) {
  const insets = useSafeAreaInsets();
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const submit = () => {
    const normalized = normalizeServer(value);
    if (!normalized) { setError("주소 형식이 올바르지 않습니다."); return; }
    onDone(normalized);
  };
  return <View style={[styles.fill, styles.setup, { paddingTop: insets.top + 48, paddingBottom: insets.bottom + 24 }]}>
    <Text style={styles.title}>NeuralNetUI 서버</Text>
    <Text style={styles.hint}>사용하는 NeuralNetUI 서버 주소를 입력하세요. 예: chat.example.com, http://192.168.0.10:3000</Text>
    <TextInput style={styles.input} value={value} onChangeText={text => { setValue(text); setError(""); }} placeholder="https://" placeholderTextColor="#6b6e76"
      autoCapitalize="none" autoCorrect={false} keyboardType="url" returnKeyType="go" onSubmitEditing={submit} autoFocus />
    {error ? <Text style={styles.error}>{error}</Text> : null}
    <Pressable style={({ pressed }) => [styles.button, pressed && styles.pressed]} onPress={submit}><Text style={styles.buttonText}>연결</Text></Pressable>
  </View>;
}

function Shell({ server, onChangeServer }: { server: string; onChangeServer: () => void }) {
  const insets = useSafeAreaInsets();
  const web = useRef<WebViewHandle>(null);
  const canGoBack = useRef(false);
  const [failed, setFailed] = useState<string>();
  const origin = new URL(server).origin;
  // A notification tapped while the app was closed opens straight at the place it points to.
  const [startUrl] = useState(() => {
    const response = Notifications.getLastNotificationResponse();
    const target = response ? notificationData(response.notification).url : undefined;
    if (response) Notifications.clearLastNotificationResponse();
    return target?.startsWith("/") ? `${origin}${target}` : server;
  });
  const loaded = useRef(false);

  useEffect(() => { void ensureChannels().catch(() => undefined); }, []);

  // A notification tapped while the app is running hands its target to the page, which opens it in place.
  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener(response => {
      const target = notificationData(response.notification).url;
      if (!target?.startsWith("/")) return;
      if (loaded.current) web.current?.injectJavaScript(`window.dispatchEvent(new CustomEvent("nnui-native-open",{detail:{url:${JSON.stringify(target)}}}));true;`);
      else web.current?.injectJavaScript(`window.location.assign(${JSON.stringify(`${origin}${target}`)});true;`);
    });
    return () => subscription.remove();
  }, [origin]);

  // Requests from the page (lib/native-bridge.ts) are answered with a `nnui-native-reply` event carrying their id.
  const onMessage = async (event: { nativeEvent: { data: string; url: string } }) => {
    try { if (new URL(event.nativeEvent.url).origin !== origin) return; } catch { return; }
    let request: { type?: string; action?: string; id?: string };
    try { request = JSON.parse(event.nativeEvent.data); } catch { return; }
    if (request.type !== "push" || !request.id || !["status", "enable", "disable"].includes(String(request.action))) return;
    const reply = await handlePushRequest(request.action as "status" | "enable" | "disable");
    web.current?.injectJavaScript(`window.dispatchEvent(new CustomEvent("nnui-native-reply",{detail:${JSON.stringify({ ...reply, id: request.id })}}));true;`);
  };

  // The keyboard overlaps the WebView (the provider keeps the window from resizing). As soon as it
  // starts to move, the page is told where it will end and how long it takes, so the layout follows
  // it instead of catching up after a resize. The bottom safe-area padding already sits under it.
  // Once the keyboard is fully up, the WebView itself shrinks by its height too: screens the page does not animate
  // (sign-in, dialogs sized to the viewport) then fit above it and the focused field is scrolled into view. The
  // page keeps its animated shell at the same height, so the chat screen does not move again. Going down, the
  // WebView grows back at once and the page's shell follows the keyboard.
  const [keyboardPad, setKeyboardPad] = useState(0);
  const bottomInset = insets.bottom;
  useEffect(() => {
    const inset = (height: number) => Math.max(0, Math.round(height - bottomInset));
    const send = (height: number, duration: number) => {
      web.current?.injectJavaScript(`window.dispatchEvent(new CustomEvent("nnui-native-keyboard",{detail:{height:${inset(height)},duration:${Math.round(duration) || 0}}}));true;`);
    };
    const subscriptions = [
      KeyboardEvents.addListener("keyboardWillShow", event => send(event.height, event.duration)),
      KeyboardEvents.addListener("keyboardDidShow", event => setKeyboardPad(inset(event.height))),
      KeyboardEvents.addListener("keyboardWillHide", event => { setKeyboardPad(0); send(0, event.duration); }),
    ];
    return () => subscriptions.forEach(subscription => subscription.remove());
  }, [bottomInset]);

  // Back walks the page's own history (dialogs and panels push entries) before leaving the app.
  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (canGoBack.current) { web.current?.goBack(); return true; }
      Alert.alert("NeuralNetUI", undefined, [
        { text: "서버 주소 변경", onPress: onChangeServer },
        { text: "취소", style: "cancel" },
        { text: "앱 종료", onPress: () => BackHandler.exitApp() },
      ]);
      return true;
    });
    return () => subscription.remove();
  }, [onChangeServer]);

  const onNavigation = (state: WebViewNavigation) => { canGoBack.current = state.canGoBack; };
  // Links leaving the server open in the system browser; the server's own pages and any
  // embedded frames stay in the app.
  const onRequest = (request: { url: string; isTopFrame?: boolean }) => {
    if (request.isTopFrame === false) return true;
    if (!/^https?:/i.test(request.url)) { void Linking.openURL(request.url).catch(() => undefined); return false; }
    try { if (new URL(request.url).origin === origin) return true; } catch { return true; }
    void Linking.openURL(request.url);
    return false;
  };

  if (failed) return <View style={[styles.fill, styles.setup, { paddingTop: insets.top + 48 }]}>
    <Text style={styles.title}>서버에 연결할 수 없습니다</Text>
    <Text style={styles.hint}>{server}{"\n"}{failed}</Text>
    <Pressable style={({ pressed }) => [styles.button, pressed && styles.pressed]} onPress={() => setFailed(undefined)}><Text style={styles.buttonText}>다시 시도</Text></Pressable>
    <Pressable style={({ pressed }) => [styles.secondary, pressed && styles.pressed]} onPress={onChangeServer}><Text style={styles.secondaryText}>서버 주소 변경</Text></Pressable>
  </View>;

  return <View style={[styles.fill, { paddingTop: insets.top, paddingBottom: insets.bottom + keyboardPad, paddingLeft: insets.left, paddingRight: insets.right }]}>
    <WebView
      ref={web}
      source={{ uri: startUrl }}
      onMessage={event => void onMessage(event as { nativeEvent: { data: string; url: string } })}
      onLoadEnd={() => { loaded.current = true; }}
      style={styles.web}
      containerStyle={styles.web}
      applicationNameForUserAgent={USER_AGENT_TOKEN}
      originWhitelist={["*"]}
      javaScriptEnabled
      domStorageEnabled
      sharedCookiesEnabled
      thirdPartyCookiesEnabled
      allowsInlineMediaPlayback
      mediaPlaybackRequiresUserAction={false}
      allowFileAccess={false}
      setSupportMultipleWindows
      onOpenWindow={(event: { nativeEvent: { targetUrl: string } }) => void Linking.openURL(event.nativeEvent.targetUrl)}
      onShouldStartLoadWithRequest={onRequest}
      onNavigationStateChange={onNavigation}
      onError={(event: { nativeEvent: { description: string } }) => setFailed(event.nativeEvent.description)}
      startInLoadingState
      renderLoading={() => <View style={[StyleSheet.absoluteFill, styles.loading]}><ActivityIndicator color="#9aa0aa" /></View>}
      // Android: fixed text size (the layout is designed in CSS px), no overscroll glow, no zoom buttons.
      textZoom={100}
      overScrollMode="never"
      setBuiltInZoomControls={false}
      // iOS: the page scrolls inside its own containers; the WebView itself must not pan or inset.
      scrollEnabled={Platform.OS !== "ios"}
      bounces={false}
      automaticallyAdjustContentInsets={false}
      contentInsetAdjustmentBehavior="never"
      keyboardDisplayRequiresUserAction={false}
      hideKeyboardAccessoryView
      allowsBackForwardNavigationGestures
    />
  </View>;
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: BACKGROUND },
  web: { flex: 1, backgroundColor: BACKGROUND },
  loading: { alignItems: "center", justifyContent: "center", backgroundColor: BACKGROUND },
  setup: { paddingHorizontal: 24, gap: 14 },
  title: { color: "#f2f3f5", fontSize: 22, fontWeight: "600" },
  hint: { color: "#9aa0aa", fontSize: 14, lineHeight: 20 },
  input: { height: 48, borderRadius: 24, borderWidth: 1, borderColor: "#2c2d33", backgroundColor: "#16161a", color: "#f2f3f5", paddingHorizontal: 18, fontSize: 15 },
  error: { color: "#f6a6a6", fontSize: 13 },
  button: { height: 48, borderRadius: 24, backgroundColor: "#f2f3f5", alignItems: "center", justifyContent: "center", marginTop: 6 },
  buttonText: { color: "#0a0a0c", fontSize: 15, fontWeight: "600" },
  secondary: { height: 44, alignItems: "center", justifyContent: "center" },
  secondaryText: { color: "#9aa0aa", fontSize: 14 },
  pressed: { opacity: 0.7 },
});
