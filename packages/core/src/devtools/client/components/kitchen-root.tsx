/**
 * Mandu Kitchen DevTools - Root Component
 * @version 1.0.3
 *
 * Shadow DOM을 사용하여 앱의 CSS와 격리된 DevTools 루트
 */

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { NormalizedError, DevToolsConfig, IslandSnapshot, NetworkRequest, GuardViolation } from '../../types';
import { generateCSSVariables, testIds, zIndex } from '../../design-tokens';
import { getStateManager, type KitchenState } from '../state-manager';
import { getOrCreateHook } from '../../hook';
import { ErrorOverlay } from './overlay';
import { ManduBadge } from './mandu-character';
import {
  PanelContainer,
  ErrorsPanel,
  IslandsPanel,
  NetworkPanel,
  GuardPanel,
  type TabId,
} from './panel';

// ============================================================================
// Base Styles
// ============================================================================

const baseStyles = `
  ${generateCSSVariables()}

  * {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  :host {
    all: initial;
    font-family: var(--mk-font-sans);
    color: var(--mk-color-text-primary);
    font-size: var(--mk-font-size-md);
    line-height: 1.5;
  }

  button {
    background: none;
    border: none;
    cursor: pointer;
    font-family: inherit;
    color: inherit;
    font-size: inherit;
    -webkit-appearance: none;
    appearance: none;
    padding: 0;
    margin: 0;
  }

  * {
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.12) transparent;
  }

  *:hover {
    scrollbar-color: rgba(255, 255, 255, 0.2) transparent;
  }

  *::-webkit-scrollbar {
    width: 6px;
    height: 6px;
  }

  *::-webkit-scrollbar-track {
    background: transparent;
  }

  *::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.12);
    border-radius: 3px;
  }

  *::-webkit-scrollbar-thumb:hover {
    background: rgba(255, 255, 255, 0.25);
  }

  *::-webkit-scrollbar-corner {
    background: transparent;
  }

  .mk-badge-container {
    position: fixed;
    z-index: ${zIndex.devtools};
    transition: all 0.3s ease;
  }

  .mk-badge-container.bottom-right {
    bottom: 16px;
    right: 16px;
  }

  .mk-badge-container.bottom-left {
    bottom: 16px;
    left: 16px;
  }

  .mk-badge-container.top-right {
    top: 16px;
    right: 16px;
  }

  .mk-badge-container.top-left {
    top: 16px;
    left: 16px;
  }

  .mk-badge-container.panel-open {
    opacity: 0;
    pointer-events: none;
    transform: scale(0.8);
  }

  @keyframes mk-badge-breathe {
    0%, 100% { transform: scale(1) translateY(0px); }
    50% { transform: scale(1.04) translateY(0px); }
  }

  @keyframes mk-badge-attention {
    0%, 100% { transform: scale(1) translateY(0px); }
    15% { transform: scale(1.08) translateY(0px); }
    30% { transform: scale(0.98) translateY(0px); }
    45% { transform: scale(1.04) translateY(0px); }
    60% { transform: scale(1) translateY(0px); }
  }

  @keyframes mk-badge-float {
    0%, 100% { transform: scale(1) translateY(0px); }
    50% { transform: scale(1) translateY(-3px); }
  }
`;

// ============================================================================
// Kitchen App Component
// ============================================================================

interface KitchenAppProps {
  config: DevToolsConfig;
}

function KitchenApp({ config }: KitchenAppProps): React.ReactElement | null {
  const [state, setState] = useState<KitchenState>(() => getStateManager().getState());

  // Subscribe to state changes
  useEffect(() => {
    const stateManager = getStateManager();
    const unsubscribe = stateManager.subscribe((newState) => {
      setState(newState);
    });

    // Connect to hook
    const hook = getOrCreateHook();
    hook.connect((event) => {
      stateManager.handleEvent(event);
    });

    return () => {
      unsubscribe();
      hook.disconnect();
    };
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+Shift+M: Toggle panel
      if (e.ctrlKey && e.shiftKey && e.key === 'M') {
        e.preventDefault();
        getStateManager().toggle();
      }
      // Ctrl+Shift+E: Open errors tab
      if (e.ctrlKey && e.shiftKey && e.key === 'E') {
        e.preventDefault();
        getStateManager().setActiveTab('errors');
        getStateManager().open();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Handlers
  const handleOverlayClose = useCallback(() => {
    getStateManager().hideOverlay();
  }, []);

  const handleOverlayIgnore = useCallback(() => {
    if (state.overlayError) {
      getStateManager().ignoreError(state.overlayError.id);
    }
  }, [state.overlayError]);

  const handleOverlayCopy = useCallback(async () => {
    if (!state.overlayError) return;

    const errorInfo = formatErrorForCopy(state.overlayError);
    try {
      await navigator.clipboard.writeText(errorInfo);
    } catch {
      // Fallback for older browsers
      const textarea = document.createElement('textarea');
      textarea.value = errorInfo;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
  }, [state.overlayError]);

  const handleBadgeClick = useCallback(() => {
    getStateManager().toggle();
  }, []);

  const handlePanelClose = useCallback(() => {
    getStateManager().close();
  }, []);

  const handleTabChange = useCallback((tab: TabId) => {
    getStateManager().setActiveTab(tab);
  }, []);

  const handleErrorClick = useCallback((error: NormalizedError) => {
    getStateManager().showOverlay(error);
  }, []);

  const handleErrorIgnore = useCallback((id: string) => {
    getStateManager().ignoreError(id);
  }, []);

  const handleClearErrors = useCallback(() => {
    getStateManager().clearErrors();
  }, []);

  const handleClearGuard = useCallback(() => {
    getStateManager().clearGuardViolations();
  }, []);

  const handleRestart = useCallback(async () => {
    try {
      // 1. Service Worker 해제
      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        for (const reg of registrations) {
          await reg.unregister();
        }
      }

      // 2. Cache API 클리어
      if ('caches' in window) {
        const cacheNames = await caches.keys();
        for (const name of cacheNames) {
          await caches.delete(name);
        }
      }

      // 3. window.__MANDU_* globals 삭제
      for (const key of Object.keys(window)) {
        if (key.startsWith('__MANDU_')) {
          delete (window as any)[key];
        }
      }

      // 4. HMR 서버에 POST /restart
      const hmrPort = (window as any).__MANDU_HMR_PORT__;
      if (hmrPort) {
        await fetch(`http://localhost:${hmrPort}/restart`, { method: 'POST' });
      }

      // 5. 3초 fallback reload (서버가 reload 브로드캐스트를 못 보낸 경우)
      setTimeout(() => {
        location.reload();
      }, 3000);
    } catch (err) {
      console.error('[Mandu Kitchen] Restart failed:', err);
      location.reload();
    }
  }, []);

  // Calculate error count
  const errorCount = useMemo(() => {
    return state.errors.filter(
      (e) => e.severity === 'error' || e.severity === 'critical'
    ).length;
  }, [state.errors]);

  // Convert Maps to Arrays for panels
  const islandsArray = useMemo(
    () => Array.from(state.islands.values()),
    [state.islands]
  );

  const networkArray = useMemo(
    () => Array.from(state.networkRequests.values()),
    [state.networkRequests]
  );

  const position = config.position ?? 'bottom-right';

  // Don't render if disabled
  if (config.enabled === false) {
    return null;
  }

  // Render active panel content
  const renderPanelContent = () => {
    switch (state.activeTab) {
      case 'errors':
        return (
          <ErrorsPanel
            errors={state.errors}
            onErrorClick={handleErrorClick}
            onErrorIgnore={handleErrorIgnore}
            onClearAll={handleClearErrors}
          />
        );
      case 'islands':
        return <IslandsPanel islands={islandsArray} />;
      case 'network':
        return <NetworkPanel requests={networkArray} />;
      case 'guard':
        return (
          <GuardPanel
            violations={state.guardViolations}
            onClear={handleClearGuard}
          />
        );
      default:
        return null;
    }
  };

  return (
    <>
      {/* Badge (hidden when panel is open) */}
      <div className={`mk-badge-container ${position}${state.isOpen ? ' panel-open' : ''}`}>
        <ManduBadge
          state={state.manduState}
          count={errorCount}
          onClick={handleBadgeClick}
        />
      </div>

      {/* Panel */}
      {state.isOpen && (
        <PanelContainer
          state={state}
          activeTab={state.activeTab}
          onTabChange={handleTabChange}
          onClose={handlePanelClose}
          onRestart={handleRestart}
          position={position}
        >
          {renderPanelContent()}
        </PanelContainer>
      )}

      {/* Overlay */}
      {state.overlayError && config.features?.errorOverlay !== false && (
        <ErrorOverlay
          error={state.overlayError}
          onClose={handleOverlayClose}
          onIgnore={handleOverlayIgnore}
          onCopy={handleOverlayCopy}
        />
      )}
    </>
  );
}

// ============================================================================
// Helper Functions
// ============================================================================

function formatErrorForCopy(error: NormalizedError): string {
  const lines = [
    `[${error.severity.toUpperCase()}] ${error.type}`,
    `Message: ${error.message}`,
    `Time: ${new Date(error.timestamp).toISOString()}`,
    `URL: ${error.url}`,
  ];

  if (error.source) {
    lines.push(`Source: ${error.source}:${error.line ?? '?'}:${error.column ?? '?'}`);
  }

  if (error.stack) {
    lines.push('', 'Stack Trace:', error.stack);
  }

  if (error.componentStack) {
    lines.push('', 'Component Stack:', error.componentStack);
  }

  return lines.join('\n');
}

// ============================================================================
// Mount Function
// ============================================================================

let kitchenRoot: Root | null = null;
let hostElement: HTMLElement | null = null;

/**
 * Mandu Kitchen DevTools 마운트
 */
export function mountKitchen(config: DevToolsConfig = {}): void {
  if (typeof window === 'undefined') return;
  if (hostElement) return; // Already mounted

  // Create host element
  hostElement = document.createElement('div');
  hostElement.setAttribute('data-testid', testIds.host);
  hostElement.setAttribute('id', 'mandu-kitchen-host');
  document.body.appendChild(hostElement);

  // Create shadow root
  const shadowRoot = hostElement.attachShadow({ mode: 'open' });

  // Inject base styles
  const styleElement = document.createElement('style');
  styleElement.textContent = baseStyles;
  shadowRoot.appendChild(styleElement);

  // Create render container
  const container = document.createElement('div');
  container.setAttribute('data-testid', testIds.root);
  shadowRoot.appendChild(container);

  // Mount React
  kitchenRoot = createRoot(container);
  kitchenRoot.render(<KitchenApp config={config} />);

  // Initialize state manager with config
  getStateManager(config);
}

/**
 * Mandu Kitchen DevTools 언마운트
 */
export function unmountKitchen(): void {
  if (kitchenRoot) {
    kitchenRoot.unmount();
    kitchenRoot = null;
  }

  if (hostElement) {
    hostElement.remove();
    hostElement = null;
  }
}

/**
 * DevTools 상태 확인
 */
export function isKitchenMounted(): boolean {
  return hostElement !== null;
}
