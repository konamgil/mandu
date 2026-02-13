import type { ChatMessage } from "@/shared/contracts/chat";

export interface AIChatAdapter {
  complete(input: {
    userText: string;
    history: ChatMessage[];
  }): Promise<string | null>;
}

class EchoAdapter implements AIChatAdapter {
  async complete(input: { userText: string }): Promise<string> {
    return `Echo: ${input.userText}`;
  }
}

let adapter: AIChatAdapter = new EchoAdapter();

export function getAIAdapter(): AIChatAdapter {
  return adapter;
}

export function setAIAdapter(next: AIChatAdapter): void {
  adapter = next;
}
