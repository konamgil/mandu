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
