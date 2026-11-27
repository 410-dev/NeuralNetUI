import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";

/**
 * Agent notifications. The server sends FCM messages on two Android channels: urgent ones ring and pop up, the rest
 * arrive silently in the notification shade. The page asks for permission and the token through the WebView bridge
 * (see lib/native-bridge.ts in the web app) and registers the token with the server itself, using its own sign-in.
 */
const ENABLED_KEY = "nnui.push.enabled";

export const CHANNEL = { urgent: "agent-urgent", normal: "agent" } as const;

type Data = Record<string, unknown> | undefined;
/** FCM's data fields, wherever this platform puts them on a notification. */
export function notificationData(notification: Notifications.Notification): Record<string, string> {
  const content = notification.request.content.data as Data;
  const remote = (notification.request.trigger as { remoteMessage?: { data?: Data } } | null)?.remoteMessage?.data;
  return Object.fromEntries(Object.entries({ ...(remote || {}), ...(content || {}) }).map(([key, value]) => [key, String(value)]));
}

// While the app is open, an urgent notification still pops up; the others only go to the shade.
Notifications.setNotificationHandler({
  handleNotification: async notification => {
    const urgent = notificationData(notification).urgent === "1";
    return { shouldShowBanner: urgent, shouldShowList: true, shouldPlaySound: urgent, shouldSetBadge: false };
  },
});

export async function ensureChannels() {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync(CHANNEL.urgent, {
    name: "긴급 에이전트 알림", description: "바로 확인해야 하는 에이전트 알림입니다. 소리와 함께 화면 위에 표시됩니다.",
    importance: Notifications.AndroidImportance.MAX, sound: "default", enableVibrate: true, vibrationPattern: [0, 220, 120, 220], showBadge: true,
  });
  await Notifications.setNotificationChannelAsync(CHANNEL.normal, {
    name: "에이전트 알림", description: "급하지 않은 에이전트 알림입니다. 소리 없이 알림창에 쌓입니다.",
    importance: Notifications.AndroidImportance.LOW, showBadge: true,
  });
}

export type PushReply = { permission: "granted" | "denied" | "undetermined"; enabled: boolean; token?: string; platform: "android" | "ios"; projectId?: string; error?: string };

/** The Firebase project this build's google-services.json belongs to (app.config.js). */
const projectId = (Constants.expoConfig?.extra as { firebaseProjectId?: string } | undefined)?.firebaseProjectId;

async function deviceToken() {
  const token = await Notifications.getDevicePushTokenAsync();
  return typeof token.data === "string" ? token.data : undefined;
}

export async function handlePushRequest(action: "status" | "enable" | "disable"): Promise<PushReply> {
  const reply = await answer(action);
  return { ...reply, projectId };
}

async function answer(action: "status" | "enable" | "disable"): Promise<PushReply> {
  const platform = Platform.OS === "ios" ? "ios" : "android";
  try {
    let { status } = await Notifications.getPermissionsAsync();
    if (action === "enable" && status !== "granted") status = (await Notifications.requestPermissionsAsync()).status;
    const permission = status === "granted" ? "granted" : status === "denied" ? "denied" : "undetermined";
    if (action === "disable") {
      await AsyncStorage.removeItem(ENABLED_KEY);
      return { permission, enabled: false, platform, token: permission === "granted" ? await deviceToken().catch(() => undefined) : undefined };
    }
    if (action === "enable") {
      if (permission !== "granted") return { permission, enabled: false, platform };
      await ensureChannels();
      const token = await deviceToken();
      await AsyncStorage.setItem(ENABLED_KEY, "1");
      return { permission, enabled: true, platform, token };
    }
    const enabled = (await AsyncStorage.getItem(ENABLED_KEY)) === "1";
    return { permission, enabled, platform, token: enabled && permission === "granted" ? await deviceToken().catch(() => undefined) : undefined };
  } catch (error) {
    return { permission: "undetermined", enabled: false, platform, error: error instanceof Error ? error.message : String(error) };
  }
}
