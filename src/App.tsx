import { useState } from "react";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import reactLogo from "./assets/react.svg";
import { commands } from "./lib/bindings";
import "./App.css";

function App() {
  const [greetMsg, setGreetMsg] = useState("");
  const [name, setName] = useState("");

  async function greet() {
    // commands 由 tauri-specta 生成（src/lib/bindings.ts），与 Rust 侧签名同步
    setGreetMsg(await commands.greet(name));
  }

  return (
    <main className="container">
      <h1>
        <Trans>欢迎来到 CastGlean（Tauri + React）</Trans>
      </h1>

      <div className="row">
        <a href="https://vite.dev" target="_blank" rel="noreferrer">
          <img src="/vite.svg" className="logo vite" alt="Vite logo" />
        </a>
        <a href="https://tauri.app" target="_blank" rel="noreferrer">
          <img src="/tauri.svg" className="logo tauri" alt="Tauri logo" />
        </a>
        <a href="https://react.dev" target="_blank" rel="noreferrer">
          <img src={reactLogo} className="logo react" alt="React logo" />
        </a>
      </div>
      <p>
        <Trans>点击 Tauri、Vite 与 React 图标可了解更多。</Trans>
      </p>

      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          greet();
        }}
      >
        <input
          id="greet-input"
          onChange={(e) => setName(e.currentTarget.value)}
          placeholder={t`输入一个名字…`}
        />
        <button type="submit">
          <Trans>打招呼</Trans>
        </button>
      </form>
      <p>{greetMsg}</p>
    </main>
  );
}

export default App;
