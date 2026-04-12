import { island, readStreamWithYield } from "@mandujs/core/client";
import { startTransition, useState, useCallback, useRef, useEffect } from "react";
import type { Message } from "../../shared/types";

const STREAM_RENDER_THROTTLE_MS = 48;

// ─── Icons ──────────────────────────────────────────────────

const IconChat = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" /></svg>;
const IconPlus = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>;
const IconSend = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4z" /></svg>;
const IconSettings = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" /></svg>;
const IconX = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>;
const IconMenu = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M4 7h16M4 12h16M4 17h16" /></svg>;
const IconTrash = () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14" /></svg>;
const IconCopy = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" /></svg>;
const IconCheck = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>;
const IconRefresh = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M1 4v6h6" /><path d="M23 20v-6h-6" /><path d="M20.49 9A9 9 0 005.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 013.51 15" /></svg>;
const IconStop = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>;
const IconSearch = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></svg>;

// ─── Markdown Renderer ──────────────────────────────────────

function Markdown({ content }: { content: string }) {
  const blocks = parseBlocks(content);
  return <div>{blocks.map((b, i) => renderBlock(b, i))}</div>;
}

type Block =
  | { type: "heading"; level: number; text: string }
  | { type: "code"; lang: string; code: string }
  | { type: "table"; headers: string[]; rows: string[][] }
  | { type: "blockquote"; text: string }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] }
  | { type: "paragraph"; text: string };

function parseBlocks(md: string): Block[] {
  const lines = md.split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("```")) {
      const lang = line.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) { codeLines.push(lines[i]); i++; }
      blocks.push({ type: "code", lang, code: codeLines.join("\n") });
      i++; continue;
    }
    const hm = line.match(/^(#{1,3})\s+(.+)/);
    if (hm) { blocks.push({ type: "heading", level: hm[1].length, text: hm[2] }); i++; continue; }
    if (line.includes("|") && i + 1 < lines.length && lines[i + 1].match(/^\|?[\s-:|]+\|/)) {
      const pr = (r: string) => r.split("|").map(c => c.trim()).filter(Boolean);
      const headers = pr(line); i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|")) { rows.push(pr(lines[i])); i++; }
      blocks.push({ type: "table", headers, rows }); continue;
    }
    if (line.startsWith(">")) {
      const ql: string[] = [];
      while (i < lines.length && lines[i].startsWith(">")) { ql.push(lines[i].replace(/^>\s?/, "")); i++; }
      blocks.push({ type: "blockquote", text: ql.join("\n") }); continue;
    }
    if (line.match(/^[-*]\s/)) {
      const items: string[] = [];
      while (i < lines.length && lines[i].match(/^[-*]\s/)) { items.push(lines[i].replace(/^[-*]\s/, "")); i++; }
      blocks.push({ type: "ul", items }); continue;
    }
    if (line.match(/^\d+\.\s/)) {
      const items: string[] = [];
      while (i < lines.length && lines[i].match(/^\d+\.\s/)) { items.push(lines[i].replace(/^\d+\.\s/, "")); i++; }
      blocks.push({ type: "ol", items }); continue;
    }
    if (!line.trim()) { i++; continue; }
    const pl: string[] = [];
    while (i < lines.length && lines[i].trim() && !lines[i].startsWith("#") && !lines[i].startsWith("```") && !lines[i].startsWith(">") && !lines[i].match(/^[-*]\s/) && !lines[i].match(/^\d+\.\s/)) { pl.push(lines[i]); i++; }
    if (pl.length) blocks.push({ type: "paragraph", text: pl.join(" ") });
  }
  return blocks;
}

// ─── Code block with copy button ────────────────────────────

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [code]);

  return (
    <div className="md-code-block" style={{ position: 'relative' }}>
      <div className="md-code-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>{lang || 'code'}</span>
        <button
          onClick={handleCopy}
          style={{
            display: 'flex', alignItems: 'center', gap: '4px',
            background: 'none', border: 'none', cursor: 'pointer',
            color: copied ? 'var(--color-amber)' : 'var(--color-ink-faint)',
            fontSize: '10px', fontFamily: 'var(--font-mono)',
            padding: '2px 6px', borderRadius: '4px',
            transition: 'all 0.15s',
          }}
          onMouseEnter={e => { if (!copied) e.currentTarget.style.color = 'var(--color-ink-muted)'; }}
          onMouseLeave={e => { if (!copied) e.currentTarget.style.color = 'var(--color-ink-faint)'; }}
        >
          {copied ? <><IconCheck /> copied</> : <><IconCopy /> copy</>}
        </button>
      </div>
      <pre className="md-code-body"><code>{code}</code></pre>
    </div>
  );
}

function renderBlock(block: Block, key: number) {
  switch (block.type) {
    case "heading": {
      const sizes: Record<number, React.CSSProperties> = {
        1: { fontSize: '15px', fontWeight: 600, marginTop: '16px', marginBottom: '8px', letterSpacing: '-0.01em' },
        2: { fontSize: '14px', fontWeight: 500, marginTop: '12px', marginBottom: '6px', letterSpacing: '-0.01em' },
        3: { fontSize: '13px', fontWeight: 500, marginTop: '8px', marginBottom: '4px', opacity: 0.8 },
      };
      return <div key={key} style={sizes[block.level] || sizes[3]}>{renderInline(block.text)}</div>;
    }
    case "code":
      return <CodeBlock key={key} lang={block.lang} code={block.code} />;
    case "table":
      return (
        <div key={key} style={{ margin: '12px 0', overflowX: 'auto', borderRadius: '8px', border: '1px solid var(--color-border)' }}>
          <table style={{ width: '100%', fontSize: '12px', borderCollapse: 'collapse' }}>
            <thead><tr>{block.headers.map((h, j) => (
              <th key={j} style={{ textAlign: 'left', fontWeight: 500, padding: '8px 12px', borderBottom: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-ink-muted)', fontFamily: 'var(--font-mono)', fontSize: '11px' }}>{renderInline(h)}</th>
            ))}</tr></thead>
            <tbody>{block.rows.map((row, j) => (
              <tr key={j}>{row.map((cell, k) => (
                <td key={k} style={{ padding: '6px 12px', borderBottom: '1px solid var(--color-border-subtle)' }}>{renderInline(cell)}</td>
              ))}</tr>
            ))}</tbody>
          </table>
        </div>
      );
    case "blockquote":
      return <div key={key} style={{ margin: '12px 0', paddingLeft: '16px', paddingBlock: '4px', borderLeft: '2px solid var(--color-amber-dim)', color: 'var(--color-ink-muted)' }}><span style={{ fontSize: '13px', fontStyle: 'italic', lineHeight: 1.6 }}>{renderInline(block.text)}</span></div>;
    case "ul":
      return <ul key={key} style={{ margin: '8px 0', marginLeft: '16px', listStyle: 'disc', fontSize: '13px', lineHeight: 1.6 }}>{block.items.map((item, j) => <li key={j} style={{ marginBottom: '4px' }}>{renderInline(item)}</li>)}</ul>;
    case "ol":
      return <ol key={key} style={{ margin: '8px 0', marginLeft: '16px', listStyle: 'decimal', fontSize: '13px', lineHeight: 1.6 }}>{block.items.map((item, j) => <li key={j} style={{ marginBottom: '4px' }}>{renderInline(item)}</li>)}</ol>;
    case "paragraph":
      return <p key={key} style={{ margin: '6px 0', fontSize: '13px', lineHeight: 1.7 }}>{renderInline(block.text)}</p>;
  }
}

function renderInline(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  const regex = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(\[([^\]]+)\]\(([^)]+)\))|([\u{1F300}-\u{1FAD6}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}\u{E0020}-\u{E007F}]+)/gu;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
    if (match[1]) parts.push(<code key={match.index} style={{ background: 'var(--color-surface)', color: 'var(--color-amber)', padding: '1px 6px', borderRadius: '4px', fontFamily: 'var(--font-mono)', fontSize: '12px' }}>{match[1].slice(1, -1)}</code>);
    else if (match[2]) parts.push(<strong key={match.index} style={{ fontWeight: 600 }}>{match[2].slice(2, -2)}</strong>);
    else if (match[3]) parts.push(<em key={match.index} style={{ color: 'var(--color-ink-muted)' }}>{match[3].slice(1, -1)}</em>);
    else if (match[4]) parts.push(<a key={match.index} href={match[6]} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-amber)', textDecoration: 'underline', textUnderlineOffset: '2px' }}>{match[5]}</a>);
    else if (match[7]) parts.push(match[7]);
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts.length === 1 ? parts[0] : <>{parts}</>;
}

// ─── Types ──────────────────────────────────────────────────

interface SessionSummary { id: string; title: string; messageCount: number; systemPrompt: string; updatedAt: number; }
interface ChatData { sessions: SessionSummary[]; messages: Message[]; currentSessionId: string | null; }
interface SSEFrame { event: string; data: string; }
interface SearchResult { messageId: string; sessionId: string; sessionTitle: string; role: string; content: string; timestamp: number; }

function parseSSEFrame(frameText: string): SSEFrame | null {
  let event = "";
  const dataLines: string[] = [];
  for (const line of frameText.split("\n")) {
    if (!line || line.startsWith(":")) continue;
    const separator = line.indexOf(":");
    const field = separator === -1 ? line : line.slice(0, separator);
    let value = separator === -1 ? "" : line.slice(separator + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") event = value;
    if (field === "data") dataLines.push(value);
  }
  if (!event && dataLines.length === 0) return null;
  return { event, data: dataLines.join("\n") };
}

function splitSSEFrames(buffer: string, flush: boolean = false): { frames: SSEFrame[]; rest: string } {
  const normalized = buffer.replace(/\r\n/g, "\n");
  const frames: SSEFrame[] = [];
  let cursor = 0;
  while (true) {
    const boundary = normalized.indexOf("\n\n", cursor);
    if (boundary === -1) break;
    const frame = parseSSEFrame(normalized.slice(cursor, boundary));
    if (frame) frames.push(frame);
    cursor = boundary + 2;
  }
  let rest = normalized.slice(cursor);
  if (flush && rest.trim()) {
    const frame = parseSSEFrame(rest);
    if (frame) frames.push(frame);
    rest = "";
  }
  return { frames, rest };
}

function extractErrorMessage(payload: unknown): string {
  if (typeof payload === "string" && payload.trim()) return payload.trim();
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    if (typeof record.error === "string" && record.error.trim()) return record.error;
    if (typeof record.message === "string" && record.message.trim()) return record.message;
  }
  return "응답 처리 중 오류가 발생했습니다.";
}

// ─── Island ─────────────────────────────────────────────────

export default island<ChatData>({
  setup: (serverData) => {
    const [sessions, setSessions] = useState<SessionSummary[]>(serverData?.sessions ?? []);
    const [currentSessionId, setCurrentSessionId] = useState<string | null>(serverData?.currentSessionId ?? null);
    const [messages, setMessages] = useState<Message[]>(serverData?.messages ?? []);
    const [input, setInput] = useState("");
    const [isStreaming, setIsStreaming] = useState(false);
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [systemPromptOpen, setSystemPromptOpen] = useState(false);
    const [systemPrompt, setSystemPrompt] = useState("");
    const [hoveredSessionId, setHoveredSessionId] = useState<string | null>(null);
    const [streamingPreview, setStreamingPreview] = useState("");
    const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
    const [hoveredMessageId, setHoveredMessageId] = useState<string | null>(null);

    // Search state
    const [searchOpen, setSearchOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const messagesEndRef = useRef<HTMLDivElement | null>(null);
    const streamAbortRef = useRef<AbortController | null>(null);
    const streamPreviewRef = useRef("");
    const streamFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, streamingPreview]);

    const clearStreamingFlush = useCallback(() => {
      if (streamFlushTimerRef.current !== null) {
        clearTimeout(streamFlushTimerRef.current);
        streamFlushTimerRef.current = null;
      }
    }, []);

    const flushStreamingPreview = useCallback(() => {
      clearStreamingFlush();
      const nextPreview = streamPreviewRef.current;
      startTransition(() => { setStreamingPreview(nextPreview); });
    }, [clearStreamingFlush]);

    const scheduleStreamingPreviewFlush = useCallback(() => {
      if (streamFlushTimerRef.current !== null) return;
      streamFlushTimerRef.current = setTimeout(() => {
        streamFlushTimerRef.current = null;
        const nextPreview = streamPreviewRef.current;
        startTransition(() => { setStreamingPreview(nextPreview); });
      }, STREAM_RENDER_THROTTLE_MS);
    }, []);

    const commitAssistantMessage = useCallback((assistantId: string, content: string) => {
      streamPreviewRef.current = content;
      clearStreamingFlush();
      startTransition(() => {
        setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content } : m));
        setStreamingPreview("");
        setStreamingMessageId(null);
      });
    }, [clearStreamingFlush]);

    useEffect(() => () => {
      streamAbortRef.current?.abort();
      clearStreamingFlush();
    }, [clearStreamingFlush]);

    // Load sessions on mount
    useEffect(() => {
      if (serverData?.sessions?.length) return;
      fetch("/api/sessions").then(r => r.json()).then(data => {
        setSessions(data.sessions);
        if (data.sessions.length > 0 && !currentSessionId) {
          const first = data.sessions[0];
          setCurrentSessionId(first.id);
          setSystemPrompt(first.systemPrompt);
          loadMessages(first.id);
        }
      });
    }, []);

    const loadMessages = useCallback((sessionId: string) => {
      fetch(`/api/sessions/${sessionId}`).then(r => r.json()).then(data => {
        setMessages(data.messages || []);
        setSystemPrompt(data.systemPrompt || "");
      });
    }, []);

    const refreshSessions = useCallback(() => {
      fetch("/api/sessions").then(r => r.json()).then(data => setSessions(data.sessions));
    }, []);

    const createSession = useCallback(() => {
      fetch("/api/sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "새 채팅" }) })
        .then(r => r.json()).then(data => {
          setCurrentSessionId(data.id);
          setMessages(data.messages || []);
          setSystemPrompt(data.systemPrompt || "");
          refreshSessions();
          setSidebarOpen(false);
        });
    }, [refreshSessions]);

    const switchSession = useCallback((id: string) => {
      if (id === currentSessionId || isStreaming) return;
      setCurrentSessionId(id);
      loadMessages(id);
      setSidebarOpen(false);
    }, [currentSessionId, isStreaming, loadMessages]);

    const deleteSession = useCallback((id: string) => {
      fetch("/api/sessions", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: id }) })
        .then(() => {
          if (id === currentSessionId) { setCurrentSessionId(null); setMessages([]); }
          refreshSessions();
        });
    }, [currentSessionId, refreshSessions]);

    // ─── SSE streaming core ─────────────────────────────────

    const streamResponse = useCallback((url: string, body: object, assistantId: string) => {
      const controller = new AbortController();
      streamAbortRef.current?.abort();
      streamAbortRef.current = controller;
      clearStreamingFlush();
      streamPreviewRef.current = "";
      setStreamingPreview("");
      setStreamingMessageId(assistantId);
      setIsStreaming(true);

      void (async () => {
        let finalContent = "";
        try {
          const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal: controller.signal,
          });

          if (!response.ok) {
            const contentType = response.headers.get("content-type") ?? "";
            if (contentType.includes("application/json")) {
              const payload = await response.json().catch(() => null);
              throw new Error(extractErrorMessage(payload));
            }
            const text = await response.text().catch(() => "");
            throw new Error(text.trim() || `요청이 실패했습니다 (${response.status})`);
          }

          const contentType = response.headers.get("content-type") ?? "";
          if (contentType.includes("text/event-stream")) {
            if (!response.body) throw new Error("스트림 응답 본문이 없습니다.");

            let buffer = "";
            let serverError: string | null = null;
            let hasToken = false;

            const applyFrames = (flush: boolean = false) => {
              const { frames, rest } = splitSSEFrames(buffer, flush);
              buffer = rest;
              for (const frame of frames) {
                if (frame.event === "error") { serverError = extractErrorMessage(frame.data); continue; }
                if (frame.event === "done") { hasToken = hasToken || !!finalContent; continue; }
                if (frame.event === "token" || !frame.event) {
                  finalContent += frame.data;
                  streamPreviewRef.current = finalContent;
                  hasToken = hasToken || !!frame.data;
                }
              }
              if (!serverError && hasToken) scheduleStreamingPreviewFlush();
            };

            await readStreamWithYield(response.body, {
              signal: controller.signal,
              onChunk: (chunk) => { buffer += chunk; applyFrames(); },
            });

            if (controller.signal.aborted && !serverError) return;
            if (buffer.trim()) applyFrames(true);
            if (serverError) throw new Error(serverError);
            if (!finalContent.trim()) throw new Error("응답이 비어 있습니다.");
            flushStreamingPreview();
          } else {
            const ct = contentType;
            const payload = ct.includes("application/json") ? await response.json().catch(() => null) : await response.text();
            if (typeof payload === "string") finalContent = payload;
            else if (payload && typeof payload === "object" && typeof (payload as { reply?: unknown }).reply === "string") finalContent = (payload as { reply: string }).reply;
            else throw new Error(extractErrorMessage(payload));
          }

          commitAssistantMessage(assistantId, finalContent);
        } catch (error: unknown) {
          if (controller.signal.aborted && error instanceof DOMException && error.name === "AbortError") return;
          const message = error instanceof Error ? error.message : "연결 오류";
          commitAssistantMessage(assistantId, `⚠️ ${message}`);
        } finally {
          if (streamAbortRef.current === controller) streamAbortRef.current = null;
          clearStreamingFlush();
          setIsStreaming(false);
          refreshSessions();
        }
      })();
    }, [refreshSessions, clearStreamingFlush, commitAssistantMessage, flushStreamingPreview, scheduleStreamingPreviewFlush]);

    const sendMessage = useCallback(() => {
      if (!input.trim() || isStreaming || !currentSessionId) return;
      const message = input.trim();
      const userMsg: Message = { id: `user-${Date.now()}`, role: "user", content: message, timestamp: Date.now() };
      const assistantId = `assistant-${Date.now()}`;

      setMessages(prev => [...prev, userMsg, { id: assistantId, role: "assistant", content: "", timestamp: Date.now() }]);
      setInput("");

      streamResponse("/api/chat", { message, sessionId: currentSessionId }, assistantId);
    }, [input, isStreaming, currentSessionId, streamResponse]);

    // ─── Stop streaming ─────────────────────────────────────

    const stopStreaming = useCallback(() => {
      if (streamAbortRef.current) {
        streamAbortRef.current.abort();
        streamAbortRef.current = null;
      }
      // Commit whatever we have so far
      if (streamingMessageId && streamPreviewRef.current) {
        commitAssistantMessage(streamingMessageId, streamPreviewRef.current);
      }
      clearStreamingFlush();
      setIsStreaming(false);
    }, [streamingMessageId, commitAssistantMessage, clearStreamingFlush]);

    // ─── Regenerate ─────────────────────────────────────────

    const regenerate = useCallback(() => {
      if (isStreaming || !currentSessionId) return;
      // Find last assistant message
      const lastAssistantIdx = [...messages].reverse().findIndex(m => m.role === "assistant");
      if (lastAssistantIdx === -1) return;
      const idx = messages.length - 1 - lastAssistantIdx;
      const assistantId = `assistant-${Date.now()}`;

      // Replace last assistant message with empty placeholder
      setMessages(prev => [...prev.slice(0, idx), { id: assistantId, role: "assistant", content: "", timestamp: Date.now() }]);

      streamResponse("/api/chat/regenerate", { sessionId: currentSessionId }, assistantId);
    }, [isStreaming, currentSessionId, messages, streamResponse]);

    // ─── Search ─────────────────────────────────────────────

    const doSearch = useCallback((q: string) => {
      if (q.trim().length < 2) { setSearchResults([]); return; }
      setIsSearching(true);
      fetch(`/api/search?q=${encodeURIComponent(q.trim())}`)
        .then(r => r.json())
        .then(data => { setSearchResults(data.results || []); setIsSearching(false); })
        .catch(() => setIsSearching(false));
    }, []);

    const onSearchInput = useCallback((q: string) => {
      setSearchQuery(q);
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
      searchTimerRef.current = setTimeout(() => doSearch(q), 300);
    }, [doSearch]);

    const jumpToSearchResult = useCallback((result: SearchResult) => {
      if (result.sessionId !== currentSessionId) {
        setCurrentSessionId(result.sessionId);
        loadMessages(result.sessionId);
      }
      setSearchOpen(false);
      setSearchQuery("");
      setSearchResults([]);
    }, [currentSessionId, loadMessages]);

    const saveSystemPrompt = useCallback(() => {
      if (!currentSessionId) return;
      fetch("/api/sessions", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: currentSessionId, systemPrompt }) })
        .then(() => setSystemPromptOpen(false));
    }, [currentSessionId, systemPrompt]);

    // Check if last message is from assistant (for regenerate button)
    const canRegenerate = messages.length > 0 && messages[messages.length - 1]?.role === "assistant" && !isStreaming;

    return {
      sessions, currentSessionId, messages, input, isStreaming, sidebarOpen, systemPromptOpen, systemPrompt,
      hoveredSessionId, streamingPreview, streamingMessageId, hoveredMessageId,
      searchOpen, searchQuery, searchResults, isSearching, canRegenerate,
      setInput, setSidebarOpen, setSystemPromptOpen, setSystemPrompt, setHoveredSessionId, setHoveredMessageId,
      sendMessage, createSession, switchSession, deleteSession, saveSystemPrompt,
      stopStreaming, regenerate, setSearchOpen, onSearchInput, jumpToSearchResult,
      messagesEndRef,
    };
  },

  render: (ctx) => {
    const c = ctx as any;
    const currentSession = c.sessions.find((s: SessionSummary) => s.id === c.currentSessionId);
    const streamingMessageId = c.isStreaming ? c.streamingMessageId : null;

    return (
      <div className="noise" style={{ height: '100vh', display: 'flex', overflow: 'hidden', background: 'var(--color-canvas)', color: 'var(--color-ink)', fontFamily: 'var(--font-display)' }}>

        {/* Mobile overlay */}
        {c.sidebarOpen && <div onClick={() => c.setSidebarOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 40, backdropFilter: 'blur(4px)' }} />}

        {/* ─── Sidebar ─── */}
        <div style={{
          width: '260px', height: '100%', display: 'flex', flexDirection: 'column',
          background: 'var(--color-panel)', borderRight: '1px solid var(--color-border-subtle)', flexShrink: 0,
          ...(c.sidebarOpen ? { position: 'fixed' as const, zIndex: 50 } : {}),
        }}>
          <div style={{ padding: '16px 16px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--color-border-subtle)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '18px' }}>🥟</span>
              <span style={{ fontSize: '13px', fontWeight: 600, letterSpacing: '-0.01em' }}>Mandu Chat</span>
            </div>
            <div style={{ display: 'flex', gap: '4px' }}>
              <button onClick={() => c.setSearchOpen(true)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '28px', height: '28px', borderRadius: '8px', border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-ink-muted)', cursor: 'pointer' }}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-surface)'; e.currentTarget.style.color = 'var(--color-amber)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--color-ink-muted)'; }}>
                <IconSearch />
              </button>
              <button onClick={c.createSession} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '28px', height: '28px', borderRadius: '8px', border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-ink-muted)', cursor: 'pointer' }}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-surface)'; e.currentTarget.style.color = 'var(--color-amber)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--color-ink-muted)'; }}>
                <IconPlus />
              </button>
            </div>
          </div>
          <nav style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
            {c.sessions.map((s: SessionSummary) => {
              const isActive = s.id === c.currentSessionId;
              const isHovered = s.id === c.hoveredSessionId;
              return (
                <div key={s.id} onClick={() => c.switchSession(s.id)}
                  onMouseEnter={() => c.setHoveredSessionId(s.id)} onMouseLeave={() => c.setHoveredSessionId(null)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', borderRadius: '10px', cursor: 'pointer', marginBottom: '2px', transition: 'all 0.15s',
                    background: isActive ? 'var(--color-amber-glow)' : isHovered ? 'var(--color-surface)' : 'transparent',
                    borderLeft: isActive ? '2px solid var(--color-amber)' : '2px solid transparent',
                  }}>
                  <span style={{ color: isActive ? 'var(--color-amber)' : 'var(--color-ink-faint)', flexShrink: 0 }}><IconChat /></span>
                  <span style={{ flex: 1, fontSize: '13px', fontWeight: isActive ? 500 : 400, color: isActive ? 'var(--color-ink)' : 'var(--color-ink-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title}</span>
                  <span style={{ fontSize: '10px', fontFamily: 'var(--font-mono)', color: 'var(--color-ink-faint)' }}>{s.messageCount}</span>
                  {c.sessions.length > 1 && isHovered && (
                    <button onClick={(e: React.MouseEvent) => { e.stopPropagation(); c.deleteSession(s.id); }}
                      style={{ background: 'none', border: 'none', color: 'var(--color-ink-faint)', cursor: 'pointer', padding: '2px', display: 'flex' }}
                      onMouseEnter={e => { e.currentTarget.style.color = '#e85050'; }} onMouseLeave={e => { e.currentTarget.style.color = 'var(--color-ink-faint)'; }}>
                      <IconTrash />
                    </button>
                  )}
                </div>
              );
            })}
          </nav>
          <div style={{ padding: '12px 16px', borderTop: '1px solid var(--color-border-subtle)' }}>
            <span style={{ fontSize: '10px', fontFamily: 'var(--font-mono)', color: 'var(--color-ink-faint)', letterSpacing: '0.04em' }}>MANDU v0.19 · SSE + ISLAND + SQLITE</span>
          </div>
        </div>

        {/* ─── Main Chat ─── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          {/* Header */}
          <header style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 20px', borderBottom: '1px solid var(--color-border-subtle)', flexShrink: 0 }}>
            <button onClick={() => c.setSidebarOpen(!c.sidebarOpen)} style={{ background: 'none', border: 'none', color: 'var(--color-ink-muted)', cursor: 'pointer', padding: '4px' }} className="md:hidden"><IconMenu /></button>
            <div style={{ flex: 1, fontSize: '14px', fontWeight: 600, letterSpacing: '-0.01em' }}>{currentSession?.title || 'Mandu AI Chat'}</div>
            <button onClick={() => c.setSystemPromptOpen(true)} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px', borderRadius: '8px', border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-ink-muted)', cursor: 'pointer', fontSize: '12px', fontFamily: 'var(--font-mono)', transition: 'all 0.15s' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--color-amber-dim)'; e.currentTarget.style.color = 'var(--color-amber)'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--color-border)'; e.currentTarget.style.color = 'var(--color-ink-muted)'; }}>
              <IconSettings /> system
            </button>
          </header>

          {/* Messages */}
          <main style={{ flex: 1, overflowY: 'auto', padding: '24px 0' }}>
            <div style={{ maxWidth: '740px', margin: '0 auto', padding: '0 24px' }}>
              {c.messages.length === 0 && !c.isStreaming && (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '80px 0', color: 'var(--color-ink-faint)' }}>
                  <span style={{ fontSize: '40px', marginBottom: '16px' }}>🥟</span>
                  <span style={{ fontSize: '14px', fontWeight: 500 }}>대화를 시작하세요</span>
                  <span style={{ fontSize: '12px', fontFamily: 'var(--font-mono)', marginTop: '4px' }}>메시지를 입력하면 AI가 응답합니다</span>
                </div>
              )}
              {c.messages.map((msg: Message, idx: number) => {
                const isStreamingAssistant = msg.role === "assistant" && msg.id === streamingMessageId;
                const assistantContent = isStreamingAssistant ? (c.streamingPreview || msg.content) : msg.content;
                const isLastAssistant = msg.role === "assistant" && idx === c.messages.length - 1;
                const isHovered = msg.id === c.hoveredMessageId;

                return (
                <div key={msg.id} style={{ marginBottom: '20px', display: 'flex', flexDirection: 'column', alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start' }}
                  onMouseEnter={() => c.setHoveredMessageId(msg.id)} onMouseLeave={() => c.setHoveredMessageId(null)}>
                  <div style={{ fontSize: '10px', fontFamily: 'var(--font-mono)', color: 'var(--color-ink-faint)', marginBottom: '6px', letterSpacing: '0.05em', textTransform: 'uppercase' as const }}>{msg.role === 'user' ? 'you' : 'mandu'}</div>
                  <div style={{ maxWidth: '88%', padding: msg.role === 'user' ? '10px 16px' : '14px 18px', borderRadius: msg.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px', background: msg.role === 'user' ? 'var(--color-user-bubble)' : 'var(--color-panel)', border: `1px solid ${msg.role === 'user' ? 'var(--color-user-border)' : 'var(--color-border-subtle)'}` }}>
                    {msg.role === 'assistant' ? (
                      assistantContent ? (
                        <>
                          {isStreamingAssistant ? (
                            <span style={{ display: 'block', fontSize: '13.5px', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{assistantContent}</span>
                          ) : (
                            <Markdown content={assistantContent} />
                          )}
                          {isStreamingAssistant && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '10px', paddingTop: '10px', borderTop: '1px solid var(--color-border-subtle)', color: 'var(--color-amber)', fontSize: '10px', fontFamily: 'var(--font-mono)', letterSpacing: '0.08em', textTransform: 'uppercase' as const }}>
                              <span className="dot-pulse" style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--color-amber)' }} />
                              <span>live stream</span>
                              <span className="stream-caret">▍</span>
                            </div>
                          )}
                        </>
                      ) : (
                        <div style={{ display: 'flex', gap: '5px', padding: '4px 0' }}>
                          <span className="dot-pulse dot-pulse-d1" style={{ width: '5px', height: '5px', borderRadius: '50%', background: 'var(--color-amber)' }} />
                          <span className="dot-pulse dot-pulse-d2" style={{ width: '5px', height: '5px', borderRadius: '50%', background: 'var(--color-amber)' }} />
                          <span className="dot-pulse dot-pulse-d3" style={{ width: '5px', height: '5px', borderRadius: '50%', background: 'var(--color-amber)' }} />
                        </div>
                      )
                    ) : <span style={{ fontSize: '13.5px', lineHeight: 1.6 }}>{msg.content}</span>}
                  </div>
                  {/* Message action buttons */}
                  {msg.role === 'assistant' && !isStreamingAssistant && assistantContent && isHovered && (
                    <div style={{ display: 'flex', gap: '4px', marginTop: '4px', opacity: 0.8 }}>
                      <MessageActionButton
                        icon={<IconCopy />}
                        label="복사"
                        onClick={() => navigator.clipboard.writeText(assistantContent)}
                      />
                      {isLastAssistant && c.canRegenerate && (
                        <MessageActionButton
                          icon={<IconRefresh />}
                          label="재생성"
                          onClick={c.regenerate}
                        />
                      )}
                    </div>
                  )}
                </div>
              );
              })}
              <div ref={c.messagesEndRef} />
            </div>
          </main>

          {/* Input */}
          <div style={{ flexShrink: 0, borderTop: '1px solid var(--color-border-subtle)', padding: '16px 24px', background: 'var(--color-panel)' }}>
            <div style={{ maxWidth: '740px', margin: '0 auto' }}>
              {/* Regenerate bar */}
              {c.canRegenerate && !c.isStreaming && (
                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '10px' }}>
                  <button onClick={c.regenerate}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '6px',
                      padding: '6px 14px', borderRadius: '20px',
                      border: '1px solid var(--color-border)', background: 'transparent',
                      color: 'var(--color-ink-muted)', cursor: 'pointer',
                      fontSize: '12px', fontFamily: 'var(--font-mono)', transition: 'all 0.15s',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--color-amber-dim)'; e.currentTarget.style.color = 'var(--color-amber)'; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--color-border)'; e.currentTarget.style.color = 'var(--color-ink-muted)'; }}>
                    <IconRefresh /> 응답 재생성
                  </button>
                </div>
              )}
              <form onSubmit={(e: React.FormEvent) => { e.preventDefault(); e.stopPropagation(); c.sendMessage(); }} style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <input type="text" value={c.input} onChange={(e: React.ChangeEvent<HTMLInputElement>) => c.setInput(e.target.value)} placeholder="메시지를 입력하세요..." disabled={c.isStreaming || !c.currentSessionId}
                  style={{ flex: 1, padding: '12px 18px', borderRadius: '14px', border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-ink)', fontSize: '13.5px', fontFamily: 'var(--font-display)', outline: 'none', transition: 'border-color 0.2s', opacity: (c.isStreaming || !c.currentSessionId) ? 0.4 : 1 }}
                  onFocus={e => { e.currentTarget.style.borderColor = 'var(--color-amber-dim)'; }} onBlur={e => { e.currentTarget.style.borderColor = 'var(--color-border)'; }} />
                {c.isStreaming ? (
                  <button type="button" onClick={c.stopStreaming}
                    style={{ width: '44px', height: '44px', borderRadius: '14px', border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: '#e85050', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all 0.2s' }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'rgba(232, 80, 80, 0.1)'; e.currentTarget.style.borderColor = '#e85050'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'var(--color-surface)'; e.currentTarget.style.borderColor = 'var(--color-border)'; }}>
                    <IconStop />
                  </button>
                ) : (
                  <button type="submit" disabled={!c.input.trim() || !c.currentSessionId}
                    style={{ width: '44px', height: '44px', borderRadius: '14px', border: 'none', background: (!c.input.trim() || !c.currentSessionId) ? 'var(--color-surface)' : 'var(--color-amber)', color: (!c.input.trim() || !c.currentSessionId) ? 'var(--color-ink-faint)' : 'var(--color-canvas)', cursor: (!c.input.trim() || !c.currentSessionId) ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all 0.2s' }}>
                    <IconSend />
                  </button>
                )}
              </form>
            </div>
          </div>
        </div>

        {/* System Prompt Modal */}
        {c.systemPromptOpen && (
          <div style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)' }}>
            <div style={{ width: '100%', maxWidth: '520px', background: 'var(--color-panel)', border: '1px solid var(--color-border)', borderRadius: '16px', overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--color-border-subtle)' }}>
                <div><div style={{ fontSize: '14px', fontWeight: 600 }}>시스템 프롬프트</div><div style={{ fontSize: '11px', color: 'var(--color-ink-faint)', marginTop: '2px', fontFamily: 'var(--font-mono)' }}>AI의 역할과 성격을 정의합니다</div></div>
                <button onClick={() => c.setSystemPromptOpen(false)} style={{ background: 'none', border: 'none', color: 'var(--color-ink-faint)', cursor: 'pointer', padding: '4px' }}><IconX /></button>
              </div>
              <div style={{ padding: '20px' }}>
                <textarea value={c.systemPrompt} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => c.setSystemPrompt(e.target.value)} rows={7}
                  style={{ width: '100%', padding: '14px 16px', borderRadius: '12px', border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-ink)', fontSize: '13px', lineHeight: 1.7, fontFamily: 'var(--font-display)', outline: 'none', resize: 'none' }}
                  onFocus={e => { e.currentTarget.style.borderColor = 'var(--color-amber-dim)'; }} onBlur={e => { e.currentTarget.style.borderColor = 'var(--color-border)'; }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', padding: '12px 20px', borderTop: '1px solid var(--color-border-subtle)' }}>
                <button onClick={() => c.setSystemPromptOpen(false)} style={{ padding: '8px 16px', borderRadius: '10px', border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-ink-muted)', cursor: 'pointer', fontSize: '13px' }}>취소</button>
                <button onClick={c.saveSystemPrompt} style={{ padding: '8px 20px', borderRadius: '10px', border: 'none', background: 'var(--color-amber)', color: 'var(--color-canvas)', cursor: 'pointer', fontSize: '13px', fontWeight: 600 }}>저장</button>
              </div>
            </div>
          </div>
        )}

        {/* Search Modal */}
        {c.searchOpen && (
          <div style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '120px', padding: '120px 24px 24px', background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)' }} onClick={() => { c.setSearchOpen(false); c.onSearchInput(""); }}>
            <div style={{ width: '100%', maxWidth: '560px', background: 'var(--color-panel)', border: '1px solid var(--color-border)', borderRadius: '16px', overflow: 'hidden', maxHeight: '70vh', display: 'flex', flexDirection: 'column' }} onClick={(e: React.MouseEvent) => e.stopPropagation()}>
              {/* Search input */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '14px 18px', borderBottom: '1px solid var(--color-border-subtle)' }}>
                <span style={{ color: 'var(--color-ink-faint)', flexShrink: 0 }}><IconSearch /></span>
                <input
                  type="text"
                  autoFocus
                  value={c.searchQuery}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => c.onSearchInput(e.target.value)}
                  placeholder="대화 내용 검색..."
                  style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: 'var(--color-ink)', fontSize: '14px', fontFamily: 'var(--font-display)' }}
                />
                <button onClick={() => { c.setSearchOpen(false); c.onSearchInput(""); }} style={{ background: 'none', border: 'none', color: 'var(--color-ink-faint)', cursor: 'pointer', padding: '4px', fontSize: '11px', fontFamily: 'var(--font-mono)' }}>ESC</button>
              </div>
              {/* Results */}
              <div style={{ overflowY: 'auto', flex: 1 }}>
                {c.isSearching && (
                  <div style={{ padding: '20px', textAlign: 'center', color: 'var(--color-ink-faint)', fontSize: '12px', fontFamily: 'var(--font-mono)' }}>검색 중...</div>
                )}
                {!c.isSearching && c.searchQuery.trim().length >= 2 && c.searchResults.length === 0 && (
                  <div style={{ padding: '20px', textAlign: 'center', color: 'var(--color-ink-faint)', fontSize: '12px', fontFamily: 'var(--font-mono)' }}>결과 없음</div>
                )}
                {c.searchResults.map((r: SearchResult, i: number) => (
                  <div key={`${r.messageId}-${i}`}
                    onClick={() => c.jumpToSearchResult(r)}
                    style={{ padding: '12px 18px', borderBottom: '1px solid var(--color-border-subtle)', cursor: 'pointer', transition: 'background 0.15s' }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-surface)'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                      <span style={{ fontSize: '10px', fontFamily: 'var(--font-mono)', color: 'var(--color-amber)', textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>{r.role}</span>
                      <span style={{ fontSize: '11px', color: 'var(--color-ink-faint)', fontFamily: 'var(--font-mono)' }}>{r.sessionTitle}</span>
                    </div>
                    <div style={{ fontSize: '13px', color: 'var(--color-ink-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.content.slice(0, 120)}{r.content.length > 120 ? '...' : ''}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  },
});

// ─── Shared Components ──────────────────────────────────────

function MessageActionButton({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  const [clicked, setClicked] = useState(false);

  const handleClick = useCallback(() => {
    onClick();
    setClicked(true);
    setTimeout(() => setClicked(false), 1500);
  }, [onClick]);

  return (
    <button onClick={handleClick}
      style={{
        display: 'flex', alignItems: 'center', gap: '4px',
        padding: '3px 8px', borderRadius: '6px',
        border: '1px solid var(--color-border-subtle)', background: 'transparent',
        color: clicked ? 'var(--color-amber)' : 'var(--color-ink-faint)',
        cursor: 'pointer', fontSize: '10px', fontFamily: 'var(--font-mono)',
        transition: 'all 0.15s',
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--color-border)'; e.currentTarget.style.color = 'var(--color-ink-muted)'; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--color-border-subtle)'; e.currentTarget.style.color = clicked ? 'var(--color-amber)' : 'var(--color-ink-faint)'; }}>
      {clicked ? <IconCheck /> : icon} {clicked ? '완료' : label}
    </button>
  );
}
