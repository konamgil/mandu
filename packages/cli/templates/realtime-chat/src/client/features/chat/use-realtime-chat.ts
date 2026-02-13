"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ChatMessage } from "@/shared/contracts/chat";
import {
  mergeChatMessages,
  openChatStream,
  sendChatMessage,
  type ChatStreamConnectionState,
} from "./chat-api";

export function useRealtimeChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [connectionState, setConnectionState] = useState<ChatStreamConnectionState>("connecting");

  useEffect(() => {
    let mounted = true;

    const close = openChatStream((event) => {
      if (!mounted) return;

      if (event.type === "snapshot" && Array.isArray(event.data)) {
        setMessages(event.data);
      }

      if (event.type === "message" && !Array.isArray(event.data)) {
        setMessages((prev) => mergeChatMessages(prev, [event.data]));
      }
    }, {
      onConnectionStateChange: (state) => {
        if (mounted) {
          setConnectionState(state);
        }
      },
    });

    return () => {
      mounted = false;
      close();
    };
  }, []);

  const send = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    setSending(true);
    try {
      await sendChatMessage({ text: trimmed });
    } finally {
      setSending(false);
    }
  }, []);

  const canSend = useMemo(() => !sending, [sending]);

  return {
    messages,
    send,
    sending,
    canSend,
    connectionState,
  };
}
