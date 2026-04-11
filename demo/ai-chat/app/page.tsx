export default function ChatPage() {
  return (
    <div
      data-island="chat-app"
      data-props="{}"
    >
      {/* SSR fallback */}
      <div className="noise" style={{ display: 'flex', height: '100vh', background: '#0c0c0e', color: '#e8e4df', fontFamily: "'Outfit', system-ui, sans-serif", overflow: 'hidden' }}>
        <div style={{ width: '260px', display: 'flex', flexDirection: 'column', background: '#141416', borderRight: '1px solid #1f1f25', flexShrink: 0 }}>
          <div style={{ padding: '16px 16px 12px', display: 'flex', alignItems: 'center', gap: '8px', borderBottom: '1px solid #1f1f25' }}>
            <span style={{ fontSize: '18px' }}>🥟</span>
            <span style={{ fontSize: '13px', fontWeight: 600 }}>Mandu Chat</span>
          </div>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ width: '20px', height: '20px', border: '2px solid #2a2a30', borderTopColor: '#e8a849', borderRadius: '50%', margin: '0 auto 8px', animation: 'spin 1s linear infinite' }} />
              <span style={{ fontSize: '11px', color: '#555049' }}>Loading...</span>
            </div>
          </div>
        </div>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ width: '24px', height: '24px', border: '2px solid #2a2a30', borderTopColor: '#e8a849', borderRadius: '50%', margin: '0 auto 8px', animation: 'spin 1s linear infinite' }} />
            <span style={{ fontSize: '12px', color: '#555049' }}>Loading chat...</span>
          </div>
        </div>
      </div>
    </div>
  );
}
