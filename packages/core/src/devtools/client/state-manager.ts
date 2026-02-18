/**
 * Mandu Kitchen DevTools - State Manager
 * @version 1.0.3
 *
 * DevTools의 중앙 상태 관리
 */

import type {
  KitchenEvent,
  NormalizedError,
  IslandSnapshot,
  NetworkRequest,
  DevToolsGuardViolation,
  DevToolsConfig,
  ManduState,
} from '../types';
import { DEFAULT_CONFIG } from '../protocol';

// ============================================================================
// State Types
// ============================================================================

export interface KitchenState {
  // UI State
  isOpen: boolean;
  activeTab: 'errors' | 'islands' | 'network' | 'guard';
  overlayError: NormalizedError | null;

  // Data State
  errors: NormalizedError[];
  islands: Map<string, IslandSnapshot>;
  networkRequests: Map<string, NetworkRequest>;
  guardViolations: DevToolsGuardViolation[];

  // Mandu Character State
  manduState: ManduState;

  // HMR State
  lastHmrUpdate: number | null;
  hmrConnected: boolean;

  // Config
  config: DevToolsConfig;
}

export type StateListener = (state: KitchenState, prevState: KitchenState) => void;

// ============================================================================
// Initial State
// ============================================================================

function createInitialState(config?: Partial<DevToolsConfig>): KitchenState {
  return {
    isOpen: config?.defaultOpen ?? false,
    activeTab: 'errors',
    overlayError: null,

    errors: [],
    islands: new Map(),
    networkRequests: new Map(),
    guardViolations: [],

    manduState: 'normal',

    lastHmrUpdate: null,
    hmrConnected: false,

    config: { ...DEFAULT_CONFIG, ...config },
  };
}

// ============================================================================
// State Manager Class
// ============================================================================

export class KitchenStateManager {
  private state: KitchenState;
  private listeners: Set<StateListener> = new Set();
  private maxErrors = 100;
  private maxNetworkRequests = 200;
  private maxDevToolsGuardViolations = 50;

  constructor(config?: Partial<DevToolsConfig>) {
    this.state = createInitialState(config);
  }

  // --------------------------------------------------------------------------
  // State Access
  // --------------------------------------------------------------------------

  getState(): Readonly<KitchenState> {
    return this.state;
  }

  getErrors(): NormalizedError[] {
    return [...this.state.errors];
  }

  getIslands(): IslandSnapshot[] {
    return Array.from(this.state.islands.values());
  }

  getNetworkRequests(): NetworkRequest[] {
    return Array.from(this.state.networkRequests.values());
  }

  getDevToolsGuardViolations(): DevToolsGuardViolation[] {
    return [...this.state.guardViolations];
  }

  getConfig(): DevToolsConfig {
    return { ...this.state.config };
  }

  // --------------------------------------------------------------------------
  // State Mutations
  // --------------------------------------------------------------------------

  private setState(partial: Partial<KitchenState>): void {
    const prevState = this.state;
    this.state = { ...this.state, ...partial };
    this.notifyListeners(prevState);
  }

  private notifyListeners(prevState: KitchenState): void {
    for (const listener of this.listeners) {
      try {
        listener(this.state, prevState);
      } catch (e) {
        console.warn('[Mandu Kitchen] State listener error:', e);
      }
    }
  }

  // --------------------------------------------------------------------------
  // Subscriptions
  // --------------------------------------------------------------------------

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  // --------------------------------------------------------------------------
  // UI Actions
  // --------------------------------------------------------------------------

  open(): void {
    this.setState({ isOpen: true });
  }

  close(): void {
    this.setState({ isOpen: false, overlayError: null });
  }

  toggle(): void {
    this.setState({ isOpen: !this.state.isOpen });
  }

  setActiveTab(tab: KitchenState['activeTab']): void {
    this.setState({ activeTab: tab });
  }

  showOverlay(error: NormalizedError): void {
    this.setState({ overlayError: error, isOpen: true });
  }

  hideOverlay(): void {
    this.setState({ overlayError: null });
  }

  // --------------------------------------------------------------------------
  // Error Actions
  // --------------------------------------------------------------------------

  addError(error: NormalizedError): void {
    const errors = [error, ...this.state.errors];

    // 최대 개수 제한
    if (errors.length > this.maxErrors) {
      errors.pop();
    }

    // Mandu 상태 업데이트
    const manduState = this.calculateManduState(errors);

    // 심각한 에러면 오버레이 표시
    const shouldShowOverlay =
      error.severity === 'critical' || error.severity === 'error';

    this.setState({
      errors,
      manduState,
      overlayError: shouldShowOverlay ? error : this.state.overlayError,
    });
  }

  clearErrors(id?: string): void {
    if (id) {
      const errors = this.state.errors.filter((e) => e.id !== id);
      const manduState = this.calculateManduState(errors);
      this.setState({ errors, manduState });
    } else {
      this.setState({
        errors: [],
        manduState: 'normal',
        overlayError: null,
      });
    }
  }

  ignoreError(id: string): void {
    const errors = this.state.errors.filter((e) => e.id !== id);
    const overlayError =
      this.state.overlayError?.id === id ? null : this.state.overlayError;
    const manduState = this.calculateManduState(errors);

    this.setState({ errors, overlayError, manduState });
  }

  // --------------------------------------------------------------------------
  // Island Actions
  // --------------------------------------------------------------------------

  registerIsland(island: IslandSnapshot): void {
    const islands = new Map(this.state.islands);
    islands.set(island.id, island);
    this.setState({ islands });
  }

  updateIsland(id: string, updates: Partial<IslandSnapshot>): void {
    const island = this.state.islands.get(id);
    if (!island) return;

    const islands = new Map(this.state.islands);
    islands.set(id, { ...island, ...updates });
    this.setState({ islands });
  }

  setIslandHydrating(id: string): void {
    this.updateIsland(id, {
      status: 'hydrating',
      hydrateStartTime: Date.now(),
    });

    // 하이드레이션 중이면 로딩 상태
    if (this.state.manduState === 'normal') {
      this.setState({ manduState: 'loading' });
    }
  }

  setIslandHydrated(id: string, time: number): void {
    this.updateIsland(id, {
      status: 'hydrated',
      hydrateEndTime: Date.now(),
    });

    // 모든 Island가 하이드레이션 완료되었는지 확인
    const allHydrated = Array.from(this.state.islands.values()).every(
      (island) => island.status === 'hydrated' || island.status === 'ssr'
    );

    if (allHydrated && this.state.manduState === 'loading') {
      this.setState({ manduState: 'normal' });
    }
  }

  setIslandError(id: string, error: NormalizedError): void {
    this.updateIsland(id, { status: 'error' });
    this.addError({ ...error, islandId: id });
  }

  // --------------------------------------------------------------------------
  // Network Actions
  // --------------------------------------------------------------------------

  addNetworkRequest(request: NetworkRequest): void {
    const networkRequests = new Map(this.state.networkRequests);
    networkRequests.set(request.id, request);

    // 최대 개수 제한 (오래된 것 제거)
    if (networkRequests.size > this.maxNetworkRequests) {
      const firstKey = networkRequests.keys().next().value;
      if (firstKey) {
        networkRequests.delete(firstKey);
      }
    }

    this.setState({ networkRequests });
  }

  updateNetworkRequest(id: string, updates: Partial<NetworkRequest>): void {
    const request = this.state.networkRequests.get(id);
    if (!request) return;

    const networkRequests = new Map(this.state.networkRequests);
    networkRequests.set(id, { ...request, ...updates });
    this.setState({ networkRequests });
  }

  // --------------------------------------------------------------------------
  // Guard Actions
  // --------------------------------------------------------------------------

  addDevToolsGuardViolation(violation: DevToolsGuardViolation): void {
    const guardViolations = [violation, ...this.state.guardViolations];

    // 최대 개수 제한
    if (guardViolations.length > this.maxDevToolsGuardViolations) {
      guardViolations.pop();
    }

    // 심각도에 따라 Mandu 상태 업데이트
    const manduState =
      violation.severity === 'error'
        ? 'warning'
        : this.state.manduState;

    this.setState({ guardViolations, manduState });
  }

  clearDevToolsGuardViolations(ruleId?: string): void {
    if (ruleId) {
      const guardViolations = this.state.guardViolations.filter(
        (v) => v.ruleId !== ruleId
      );
      this.setState({ guardViolations });
    } else {
      this.setState({ guardViolations: [] });
    }
  }

  // --------------------------------------------------------------------------
  // HMR Actions
  // --------------------------------------------------------------------------

  setHmrConnected(connected: boolean): void {
    this.setState({ hmrConnected: connected });
  }

  notifyHmrUpdate(): void {
    this.setState({
      lastHmrUpdate: Date.now(),
      manduState: 'hmr',
    });

    // 2초 후 원래 상태로 복귀
    setTimeout(() => {
      if (this.state.manduState === 'hmr') {
        const manduState = this.calculateManduState(this.state.errors);
        this.setState({ manduState });
      }
    }, 2000);
  }

  // --------------------------------------------------------------------------
  // Event Handler
  // --------------------------------------------------------------------------

  handleEvent(event: KitchenEvent): void {
    switch (event.type) {
      case 'error':
        this.addError(event.data as NormalizedError);
        break;

      case 'error:clear':
        this.clearErrors((event.data as { id?: string }).id);
        break;

      case 'island:register':
        this.registerIsland(event.data as IslandSnapshot);
        break;

      case 'island:hydrate:start':
        this.setIslandHydrating((event.data as { id: string }).id);
        break;

      case 'island:hydrate:end':
        const { id, time } = event.data as { id: string; time: number };
        this.setIslandHydrated(id, time);
        break;

      case 'network:request':
        this.addNetworkRequest(event.data as NetworkRequest);
        break;

      case 'network:response':
        const response = event.data as { id: string; status: number; endTime: number };
        this.updateNetworkRequest(response.id, {
          status: response.status,
          endTime: response.endTime,
        });
        break;

      case 'guard:violation':
        this.addDevToolsGuardViolation(event.data as DevToolsGuardViolation);
        break;

      case 'guard:clear':
        this.clearDevToolsGuardViolations((event.data as { ruleId?: string }).ruleId);
        break;

      case 'hmr:update':
        this.notifyHmrUpdate();
        break;

      case 'hmr:connected':
        this.setHmrConnected(true);
        break;

      case 'hmr:disconnected':
        this.setHmrConnected(false);
        break;

      case 'devtools:toggle':
        this.toggle();
        break;

      case 'devtools:open':
        this.open();
        break;

      case 'devtools:close':
        this.close();
        break;

      default:
        // 알 수 없는 이벤트는 무시
        break;
    }
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  private calculateManduState(errors: NormalizedError[]): ManduState {
    if (errors.length === 0) return 'normal';

    const hasCritical = errors.some((e) => e.severity === 'critical');
    const hasError = errors.some((e) => e.severity === 'error');
    const hasWarning = errors.some((e) => e.severity === 'warning');

    if (hasCritical || hasError) return 'error';
    if (hasWarning) return 'warning';
    return 'normal';
  }

  // --------------------------------------------------------------------------
  // Cleanup
  // --------------------------------------------------------------------------

  destroy(): void {
    this.listeners.clear();
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let globalStateManager: KitchenStateManager | null = null;

export function getStateManager(config?: Partial<DevToolsConfig>): KitchenStateManager {
  if (!globalStateManager) {
    globalStateManager = new KitchenStateManager(config);
  }
  return globalStateManager;
}

export function resetStateManager(): void {
  if (globalStateManager) {
    globalStateManager.destroy();
    globalStateManager = null;
  }
}
