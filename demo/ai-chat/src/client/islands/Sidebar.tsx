import { island } from "@mandujs/core/client";
import { useState, useCallback, useEffect } from "react";

// ─── Types ──────────────────────────────────────────────────

interface SessionSummary {
  id: string;
  title: string;
  messageCount: number;
  systemPrompt: string;
  updatedAt: number;
}

interface SidebarData {
  sessions: SessionSummary[];
  currentSessionId: string | null;
}

// ─── Icons ──────────────────────────────────────────────────

const IconChat = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
  </svg>
);

const IconPlus = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M12 5v14M5 12h14" />
  </svg>
);

const IconTrash = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14" />
  </svg>
);

const ManduLogo = () => (
  <span style={{ fontSize: '18px', lineHeight: 1 }} role="img" aria-label="Mandu logo">🥟</span>
);

// ─── Island ─────────────────────────────────────────────────

export default island<SidebarData>({
  setup: (serverData) => {
    const [sessions, setSessions] = useState<SessionSummary[]>(serverData?.sessions ?? []);
    const [currentSessionId, setCurrentSessionId] = useState<string | null>(serverData?.currentSessionId ?? null);
    const [hoveredId, setHoveredId] = useState<string | null>(null);

    // Fetch sessions on mount if no server data was provided
    useEffect(() => {
      if (serverData?.sessions && serverData.sessions.length > 0) return;
      fetch("/api/sessions").then(r => r.json()).then(data => {
        setSessions(data.sessions);
        if (data.sessions.length > 0 && !currentSessionId) {
          const first = data.sessions[0];
          setCurrentSessionId(first.id);
          window.dispatchEvent(new CustomEvent("mandu:session-switch", { detail: { sessionId: first.id, systemPrompt: first.systemPrompt } }));
        }
      });
    }, []);

    // Listen for external session updates (e.g. after streaming completes, title changes)
    useEffect(() => {
      const handler = () => {
        fetch("/api/sessions").then(r => r.json()).then(data => setSessions(data.sessions));
      };
      window.addEventListener("mandu:sessions-refresh", handler);
      return () => window.removeEventListener("mandu:sessions-refresh", handler);
    }, []);

    const createSession = useCallback(() => {
      fetch("/api/sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "New Chat" }) })
        .then(r => r.json()).then(data => {
          setCurrentSessionId(data.id);
          fetch("/api/sessions").then(r => r.json()).then(d => setSessions(d.sessions));
          window.dispatchEvent(new CustomEvent("mandu:session-create", { detail: { sessionId: data.id, systemPrompt: data.systemPrompt || "" } }));
        });
    }, []);

    const switchSession = useCallback((id: string) => {
      if (id === currentSessionId) return;
      setCurrentSessionId(id);
      const session = sessions.find(s => s.id === id);
      window.dispatchEvent(new CustomEvent("mandu:session-switch", { detail: { sessionId: id, systemPrompt: session?.systemPrompt || "" } }));
    }, [currentSessionId, sessions]);

    const deleteSession = useCallback((id: string) => {
      fetch("/api/sessions", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: id }) })
        .then(() => {
          fetch("/api/sessions").then(r => r.json()).then(data => {
            setSessions(data.sessions);
            if (id === currentSessionId) {
              const next = data.sessions[0] || null;
              setCurrentSessionId(next?.id ?? null);
              window.dispatchEvent(new CustomEvent("mandu:session-delete", { detail: { deletedSessionId: id, nextSessionId: next?.id ?? null } }));
            }
          });
        });
    }, [currentSessionId]);

    return { sessions, currentSessionId, hoveredId, setHoveredId, createSession, switchSession, deleteSession };
  },

  render: (ctx) => {
    const { sessions, currentSessionId, hoveredId, setHoveredId, createSession, switchSession, deleteSession } = ctx;

    return (
      <div style={{
        width: '260px',
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--color-panel)',
        borderRight: '1px solid var(--color-border-subtle)',
        flexShrink: 0,
      }}>

        {/* Header */}
        <div style={{ padding: '16px 16px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--color-border-subtle)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <ManduLogo />
            <span style={{ fontSize: '13px', fontWeight: 600, letterSpacing: '-0.01em', color: 'var(--color-ink)' }}>Mandu Chat</span>
          </div>
          <button
            onClick={createSession}
            aria-label="New chat"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: '28px', height: '28px', borderRadius: '8px',
              border: '1px solid var(--color-border)',
              background: 'transparent',
              color: 'var(--color-ink-muted)',
              cursor: 'pointer', transition: 'all 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-surface)'; e.currentTarget.style.color = 'var(--color-amber)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--color-ink-muted)'; }}
          >
            <IconPlus />
          </button>
        </div>

        {/* Session list */}
        <nav style={{ flex: 1, overflowY: 'auto', padding: '8px' }} aria-label="Chat sessions">
          {sessions.length === 0 && (
            <div style={{ padding: '24px 12px', textAlign: 'center', color: 'var(--color-ink-faint)', fontSize: '12px', fontFamily: 'var(--font-mono)' }}>
              No sessions yet
            </div>
          )}
          {sessions.map(s => {
            const isActive = s.id === currentSessionId;
            const isHovered = s.id === hoveredId;
            return (
              <div
                key={s.id}
                role="button"
                tabIndex={0}
                aria-current={isActive ? 'true' : undefined}
                onClick={() => switchSession(s.id)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); switchSession(s.id); } }}
                onMouseEnter={() => setHoveredId(s.id)}
                onMouseLeave={() => setHoveredId(null)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '10px',
                  padding: '10px 12px', borderRadius: '10px',
                  cursor: 'pointer', marginBottom: '2px',
                  transition: 'all 0.15s',
                  background: isActive ? 'var(--color-amber-glow)' : (isHovered ? 'var(--color-surface)' : 'transparent'),
                  borderLeft: isActive ? '2px solid var(--color-amber)' : '2px solid transparent',
                }}
              >
                <span style={{ color: isActive ? 'var(--color-amber)' : 'var(--color-ink-faint)', flexShrink: 0 }}>
                  <IconChat />
                </span>
                <span style={{
                  flex: 1, fontSize: '13px',
                  fontWeight: isActive ? 500 : 400,
                  color: isActive ? 'var(--color-ink)' : 'var(--color-ink-muted)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {s.title}
                </span>
                <span style={{ fontSize: '10px', fontFamily: 'var(--font-mono)', color: 'var(--color-ink-faint)', flexShrink: 0 }}>
                  {s.messageCount}
                </span>
                {sessions.length > 1 && isHovered && (
                  <button
                    onClick={e => { e.stopPropagation(); deleteSession(s.id); }}
                    aria-label={`Delete session: ${s.title}`}
                    style={{
                      background: 'none', border: 'none',
                      color: 'var(--color-ink-faint)',
                      cursor: 'pointer', padding: '2px',
                      display: 'flex', alignItems: 'center',
                      transition: 'color 0.15s',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.color = '#e85050'; }}
                    onMouseLeave={e => { e.currentTarget.style.color = 'var(--color-ink-faint)'; }}
                  >
                    <IconTrash />
                  </button>
                )}
              </div>
            );
          })}
        </nav>

        {/* Footer */}
        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--color-border-subtle)', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '10px', fontFamily: 'var(--font-mono)', color: 'var(--color-ink-faint)', letterSpacing: '0.04em' }}>
            MANDU v0.19 · MULTI-ISLAND
          </span>
        </div>
      </div>
    );
  },
});
