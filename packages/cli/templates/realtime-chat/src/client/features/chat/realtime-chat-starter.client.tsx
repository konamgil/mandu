"use client";

import { FormEvent, useState } from "react";
import { useRealtimeChat } from "./use-realtime-chat";

export function RealtimeChatStarter() {
  const { messages, send, canSend, sending } = useRealtimeChat();
  const [text, setText] = useState("");

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
          messages.map((message) => (
            <div
              key={message.id}
              className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                message.role === "user"
                  ? "ml-auto bg-primary text-primary-foreground"
                  : "bg-muted"
              }`}
            >
              <div>{message.text}</div>
              <div className="mt-1 text-[10px] opacity-70">{new Date(message.createdAt).toLocaleTimeString()}</div>
            </div>
          ))
        )}
      </div>

      <form onSubmit={onSubmit} className="flex gap-2 border-t p-3">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type your message..."
          className="flex-1 rounded-md border bg-background px-3 py-2 text-sm"
          maxLength={500}
        />
        <button
          type="submit"
          disabled={!canSend || text.trim().length === 0}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          {sending ? "Sending..." : "Send"}
        </button>
      </form>
    </section>
  );
}
