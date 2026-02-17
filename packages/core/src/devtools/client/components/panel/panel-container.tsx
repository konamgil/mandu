/**
 * Mandu Kitchen DevTools - Panel Container
 * @version 1.0.3
 */

import React, { useState, useCallback } from 'react';
import { colors, typography, spacing, borderRadius, shadows, zIndex, animation, testIds } from '../../../design-tokens';
import type { KitchenState } from '../../state-manager';

// ============================================================================
// Types
// ============================================================================

export type TabId = 'errors' | 'islands' | 'network' | 'guard';

export interface TabDefinition {
  id: TabId;
  label: string;
  icon: string;
  testId: string;
}

export interface PanelContainerProps {
  state: KitchenState;
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  onClose: () => void;
  position: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
  children: React.ReactNode;
}

// ============================================================================
// Constants
// ============================================================================

export const TABS: TabDefinition[] = [
  { id: 'errors', label: '에러', icon: '🔥', testId: testIds.tabErrors },
  { id: 'islands', label: 'Islands', icon: '🏝️', testId: testIds.tabIslands },
  { id: 'network', label: 'Network', icon: '📡', testId: testIds.tabNetwork },
  { id: 'guard', label: 'Guard', icon: '🛡️', testId: testIds.tabGuard },
];

// ============================================================================
// Styles
// ============================================================================

const styles = {
  container: {
    position: 'fixed' as const,
    width: '420px',
    maxHeight: '70vh',
    backgroundColor: colors.background.dark,
    borderRadius: borderRadius.lg,
    boxShadow: shadows.xl,
    display: 'flex',
    flexDirection: 'column' as const,
    overflow: 'hidden',
    zIndex: zIndex.devtools,
    fontFamily: typography.fontFamily.sans,
    transition: `all ${animation.duration.normal} ${animation.easing.easeOut}`,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: `${spacing.sm} ${spacing.md}`,
    borderBottom: `1px solid ${colors.background.light}`,
    backgroundColor: colors.background.medium,
  },
  title: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing.sm,
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    color: colors.text.primary,
  },
  logo: {
    fontSize: typography.fontSize.lg,
  },
  closeButton: {
    background: 'transparent',
    border: 'none',
    color: colors.text.secondary,
    fontSize: typography.fontSize.lg,
    cursor: 'pointer',
    padding: spacing.xs,
    borderRadius: borderRadius.sm,
    lineHeight: 1,
    transition: `color ${animation.duration.fast}`,
  },
  tabs: {
    display: 'flex',
    borderBottom: `1px solid ${colors.background.light}`,
    backgroundColor: colors.background.dark,
  },
  tab: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    padding: `${spacing.sm} ${spacing.md}`,
    background: 'transparent',
    border: 'none',
    borderBottom: '2px solid transparent',
    color: colors.text.secondary,
    fontSize: typography.fontSize.sm,
    cursor: 'pointer',
    transition: `all ${animation.duration.fast}`,
  },
  tabActive: {
    color: colors.brand.accent,
    borderBottomColor: colors.brand.accent,
    backgroundColor: 'rgba(232, 150, 122, 0.12)',
  },
  tabIcon: {
    fontSize: typography.fontSize.md,
  },
  tabBadge: {
    minWidth: '18px',
    height: '18px',
    padding: '0 4px',
    borderRadius: borderRadius.full,
    backgroundColor: colors.semantic.error,
    color: colors.text.primary,
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.semibold,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flex: 1,
    overflow: 'auto',
    minHeight: '200px',
    maxHeight: '50vh',
  },
  resizeHandle: {
    position: 'absolute' as const,
    width: '100%',
    height: '4px',
    cursor: 'ns-resize',
    backgroundColor: 'transparent',
  },
};

const positionStyles: Record<string, React.CSSProperties> = {
  'bottom-right': { bottom: '80px', right: '16px' },
  'bottom-left': { bottom: '80px', left: '16px' },
  'top-right': { top: '16px', right: '16px' },
  'top-left': { top: '16px', left: '16px' },
};

// ============================================================================
// Component
// ============================================================================

export function PanelContainer({
  state,
  activeTab,
  onTabChange,
  onClose,
  position,
  children,
}: PanelContainerProps): React.ReactElement {
  const [isResizing, setIsResizing] = useState(false);
  const [height, setHeight] = useState(400);
  const [hoveredTab, setHoveredTab] = useState<TabId | null>(null);
  const [isCloseHovered, setIsCloseHovered] = useState(false);

  const getTabBadgeCount = useCallback((tabId: TabId): number => {
    switch (tabId) {
      case 'errors':
        return state.errors.filter(e => e.severity === 'error' || e.severity === 'critical').length;
      case 'islands':
        return Array.from(state.islands.values()).filter(i => i.status === 'error').length;
      case 'guard':
        return state.guardViolations.length;
      default:
        return 0;
    }
  }, [state]);

  const containerStyle: React.CSSProperties = {
    ...styles.container,
    ...positionStyles[position],
    height: `${height}px`,
  };

  return (
    <div
      data-testid={testIds.panel}
      style={containerStyle}
    >
      {/* Resize Handle (top) */}
      {position.startsWith('bottom') && (
        <div
          style={{ ...styles.resizeHandle, top: 0 }}
          onMouseDown={() => setIsResizing(true)}
        />
      )}

      {/* Header */}
      <div style={styles.header}>
        <div style={styles.title}>
          <span style={styles.logo}>🥟</span>
          <span>Mandu Kitchen</span>
        </div>
        <button
          style={{
            ...styles.closeButton,
            ...(isCloseHovered ? { color: colors.text.primary, backgroundColor: 'rgba(255, 255, 255, 0.08)' } : {}),
          }}
          onClick={onClose}
          onMouseEnter={() => setIsCloseHovered(true)}
          onMouseLeave={() => setIsCloseHovered(false)}
          aria-label="패널 닫기"
        >
          ×
        </button>
      </div>

      {/* Tabs */}
      <div style={styles.tabs} role="tablist">
        {TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          const badgeCount = getTabBadgeCount(tab.id);

          return (
            <button
              key={tab.id}
              data-testid={tab.testId}
              role="tab"
              aria-selected={isActive}
              style={{
                ...styles.tab,
                ...(isActive ? styles.tabActive : {}),
                ...(!isActive && hoveredTab === tab.id ? {
                  color: colors.text.primary,
                  backgroundColor: 'rgba(255, 255, 255, 0.05)',
                } : {}),
              }}
              onClick={() => onTabChange(tab.id)}
              onMouseEnter={() => setHoveredTab(tab.id)}
              onMouseLeave={() => setHoveredTab(null)}
            >
              <span style={styles.tabIcon}>{tab.icon}</span>
              <span>{tab.label}</span>
              {badgeCount > 0 && (
                <span style={styles.tabBadge}>{badgeCount > 99 ? '99+' : badgeCount}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Content */}
      <div style={styles.content} role="tabpanel">
        {children}
      </div>

      {/* Resize Handle (bottom) */}
      {position.startsWith('top') && (
        <div
          style={{ ...styles.resizeHandle, bottom: 0 }}
          onMouseDown={() => setIsResizing(true)}
        />
      )}
    </div>
  );
}
