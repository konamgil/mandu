"use client";

import { useState } from "react";
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
    { id: "welcome", role: "assistant", text: "안녕하세요! 만두킹 채팅 스타터입니다." },
  ]);

  async function onSend() {
    const text = input.trim();
    if (!text || isTyping) return;

    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: "user", text };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsTyping(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: text }),
      });

      const data = (await res.json()) as { reply?: string };
      const reply = data.reply ?? "응답 생성에 실패했어요.";

      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: "assistant", text: reply },
      ]);
    } finally {
      setIsTyping(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Realtime Chat Demo</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="h-80 space-y-2 overflow-y-auto rounded-md border p-3">
          {messages.map((msg) => (
            <div key={msg.id} className={msg.role === "user" ? "text-right" : "text-left"}>
              <span className="inline-block rounded-md bg-muted px-3 py-2 text-sm">{msg.text}</span>
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
            placeholder="메시지를 입력하세요"
          />
          <Button type="submit" disabled={!input.trim() || isTyping}>
            보내기
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
