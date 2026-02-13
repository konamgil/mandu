"use client";

import { FormEvent, useMemo, useState } from "react";
import { Button, Input } from "@/client/shared/ui";
import { useRealtimeChat } from "./use-realtime-chat";

export function RealtimeChatStarter() {
  const { messages, send, canSend, sending } = useRealtimeChat();
  const [text, setText] = useState("");
  const messagesWithTime = useMemo(
    () =>
      messages.map((message) => ({
        ...message,
        displayTime: new Date(message.createdAt).toLocaleTimeString(),
      })),
    [messages],
  );

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const current = text;
    setText("");
    await send(current);
  };

  return (
    <section className="flex h-[70vh] flex-col rounded-xl border bg-card">
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <p className="text-sm text-muted-foreground">No messages yet. Start chatting.</p>
        ) : (
          messagesWithTime.map((message) => (
            <div
              key={message.id}
              className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                message.role === "user"
                  ? "ml-auto bg-primary text-primary-foreground"
                  : "bg-muted"
              }`}
            >
              <div>{message.text}</div>
              <div className="mt-1 text-[10px] opacity-70">{message.displayTime}</div>
            </div>
          ))
        )}
      </div>

      <form onSubmit={onSubmit} className="flex gap-2 border-t p-3">
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type your message..."
          className="flex-1"
          maxLength={500}
        />
        <Button type="submit" disabled={!canSend || text.trim().length === 0}>
          {sending ? "Sending..." : "Send"}
        </Button>
      </form>
    </section>
  );
}
