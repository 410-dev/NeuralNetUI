"use client";

import { useEffect } from "react";

// The app is installable only when it is opened over HTTPS. On HTTP (including
// localhost) no manifest is linked and no service worker is registered, so the
// browser never offers to install it.
export function PwaSetup() {
  useEffect(() => {
    if (window.location.protocol !== "https:") return;
    const added: HTMLElement[] = [];
    const addToHead = (tag: string, attributes: Record<string, string>) => {
      const [key, value] = Object.entries(attributes)[0];
      if (document.head.querySelector(`${tag}[${key}="${value}"]`)) return;
      const element = document.createElement(tag);
      for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
      document.head.appendChild(element);
      added.push(element);
    };
    addToHead("link", { rel: "manifest", href: "/manifest.webmanifest" });
    addToHead("link", { rel: "apple-touch-icon", href: "/pwa/apple-touch-icon.png" });
    addToHead("meta", { name: "theme-color", content: "#0a0a0c" });
    addToHead("meta", { name: "mobile-web-app-capable", content: "yes" });
    addToHead("meta", { name: "apple-mobile-web-app-capable", content: "yes" });
    addToHead("meta", { name: "apple-mobile-web-app-status-bar-style", content: "black" });
    addToHead("meta", { name: "apple-mobile-web-app-title", content: "Neural Chat" });
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(error => console.warn("Service worker registration failed", error));
    }
    return () => { for (const element of added) element.remove(); };
  }, []);
  return null;
}
