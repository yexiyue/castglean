import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { commands } from "../lib/bindings";

function HomePage() {
  const [greetMsg, setGreetMsg] = useState("");
  const [name, setName] = useState("");

  async function greet() {
    // commands 由 tauri-specta 生成（src/lib/bindings.ts），与 Rust 侧签名同步
    setGreetMsg(await commands.greet(name));
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-3xl font-bold">
        <Trans>欢迎来到 CastGlean（Tauri + React）</Trans>
      </h1>
      <p className="text-neutral-600">
        <Trans>输入名字调用 Rust 命令，体验类型安全 IPC 与文案管线。</Trans>
      </p>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          greet();
        }}
      >
        <input
          id="greet-input"
          className="rounded border px-3 py-2"
          onChange={(e) => setName(e.currentTarget.value)}
          placeholder={t`输入一个名字…`}
        />
        <button
          type="submit"
          className="rounded bg-neutral-900 px-4 py-2 text-white"
        >
          <Trans>打招呼</Trans>
        </button>
      </form>
      {greetMsg ? <p className="text-neutral-800">{greetMsg}</p> : null}
    </main>
  );
}

export const Route = createFileRoute("/")({
  component: HomePage,
});
