import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { defaultLocale, dynamicActivate } from "./lib/i18n";
import "./index.css";

function Root() {
  const [localeReady, setLocaleReady] = useState(false);

  useEffect(() => {
    // 语言偏好持久化随偏好存储一起落地；当前先激活默认语言。
    void dynamicActivate(defaultLocale).finally(() => setLocaleReady(true));
  }, []);

  if (!localeReady) return null;

  return (
    <I18nProvider i18n={i18n}>
      <App />
    </I18nProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
