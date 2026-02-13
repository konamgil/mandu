"use client";

import { useMemo, useState } from "react";
import { Button } from "@/client/shared/ui/button";
import { Input } from "@/client/shared/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/client/shared/ui/card";

type Role = "user" | "assistant";

interface ChatMessage {
  id: string;
  role: Role;
  text: string;
}

export function RealtimeChatStarter() {
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: "welcome", role: "assistant", text: "Welcome! Send a message to see streamed tokens." },
  ]);

  const canSend = useMemo(() => input.trim().length > 0 && !isTyping, [input, isTyping]);

  async function onSend() {
    const text = input.trim();
    if (!text || isTyping) return;

    setInput("");
    setIsTyping(true);

    const userId = crypto.randomUUID();
    const assistantId = crypto.randomUUID();

    setMessages((prev) => [
      ...prev,
      { id: userId, role: "user", text },
      { id: assistantId, role: "assistant", text: "" },
    ]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: text }),
      });

      if (!res.ok || !res.body) throw new Error(`Chat API failed: ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        for (const line of chunk.split("\n")) {
          if (!line.startsWith("data: ")) continue;

          const data = JSON.parse(line.slice(6)) as { token?: string; done?: boolean };
          if (!data.token) continue;

          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === assistantId ? { ...msg, text: msg.text + data.token } : msg
            )
          );
        }
      }
    } catch {
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantId
            ? { ...msg, text: "Something went wrong. Please try again." }
            : msg
        )
      );
    } finally {
      setIsTyping(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Realtime Chat Demo (SSE)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="h-80 space-y-2 overflow-y-auto rounded-md border p-3">
          {messages.map((msg) => (
            <div key={msg.id} className={msg.role === "user" ? "text-right" : "text-left"}>
              <span className="inline-block rounded-md bg-muted px-3 py-2 text-sm">{msg.text || "…"}</span>
            </div>
          ))}
          {isTyping && <p className="text-sm text-muted-foreground">assistant is typing…</p>}
        </div>

        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void onSend();
          }}
        >
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type a message"
          />
          <Button type="submit" disabled={!canSend}>
            보내기
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
