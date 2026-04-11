export interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
}

export interface ChatSession {
  id: string;
  title: string;
  messages: Message[];
  systemPrompt: string;
  createdAt: number;
  updatedAt: number;
}

export type ChatFilter = "all" | "today" | "week";
