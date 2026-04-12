/**
 * Mandu Kitchen DevTools - Panel Container
 * @version 1.0.3
 */

import React, { useState, useCallback } from 'react';
import { colors, typography, spacing, borderRadius, shadows, zIndex, animation, testIds } from '../../../design-tokens';
import type { KitchenState } from '../../state-manager';

export type TabId = 'errors' | 'islands' | 'network' | 'guard' | 'preview';

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
  onRestart?: () => void;
  position: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
  children: React.ReactNode;
}

export const TABS: TabDefinition[] = [
  { id: 'errors', label: 'Issues', icon: 'ERR', testId: testIds.tabErrors },
  { id: 'islands', label: 'Islands', icon: 'ISL', testId: testIds.tabIslands },
  { id: 'network', label: 'Network', icon: 'NET', testId: testIds.tabNetwork },
  { id: 'guard', label: 'Guard', icon: 'GRD', testId: testIds.tabGuard },
  { id: 'preview', label: 'Changes', icon: 'CHG', testId: testIds.tabPreview },
];

const styles = {
  container: {
    position: 'fixed' as const,
    width: '468px',
    maxWidth: 'calc(100vw - 32px)',
    maxHeight: '76vh',
    background: `linear-gradient(180deg, ${colors.background.medium}, ${colors.background.dark})`,
    border: `1px solid ${colors.background.light}`,
    borderRadius: '20px',
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
    flexDirection: 'column' as const,
    gap: spacing.md,
    padding: `${spacing.md} ${spacing.md} ${spacing.sm}`,
    borderBottom: `1px solid ${colors.background.light}`,
    background: 'linear-gradient(180deg, rgba(255, 255, 255, 0.03), rgba(255, 255, 255, 0))',
  },
  headerTop: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  title: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing.md,
    minWidth: 0,
  },
  logo: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: '42px',
    height: '42px',
    padding: '0 10px',
    borderRadius: borderRadius.full,
    backgroundColor: `${colors.brand.accent}15`,
    border: `1px solid ${colors.brand.accent}40`,
    color: colors.brand.accent,
    fontFamily: typography.fontFamily.mono,
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.bold,
    letterSpacing: '0.14em',
  },
  titleGroup: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '4px',
    minWidth: 0,
  },
  titleText: {
    fontSize: typography.fontSize.md,
    fontWeight: typography.fontWeight.semibold,
    color: colors.text.primary,
    whiteSpace: 'nowrap' as const,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  subtitle: {
    fontSize: typography.fontSize.xs,
    color: colors.text.secondary,
  },
  headerActions: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing.sm,
    flexWrap: 'wrap' as const,
    justifyContent: 'flex-end',
  },
  statusBadge: {
    padding: `${spacing.xs} ${spacing.sm}`,
    borderRadius: borderRadius.full,
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.semibold,
    letterSpacing: '0.08em',
    textTransform: 'uppercase' as const,
    border: `1px solid ${colors.background.light}`,
  },
  headerButton: {
    padding: `${spacing.xs} ${spacing.sm}`,
    borderRadius: borderRadius.full,
    backgroundColor: colors.background.light,
    border: `1px solid transparent`,
    color: colors.text.secondary,
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.medium,
    cursor: 'pointer',
    transition: `all ${animation.duration.fast}`,
  },
  restartButton: {
    backgroundColor: colors.background.light,
    border: `1px solid transparent`,
    color: colors.text.secondary,
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.medium,
    cursor: 'pointer',
    padding: `${spacing.xs} ${spacing.sm}`,
    borderRadius: borderRadius.full,
    lineHeight: 1,
    transition: `all ${animation.duration.fast}`,
  },
  closeButton: {
    backgroundColor: 'transparent',
    border: `1px solid transparent`,
    color: colors.text.secondary,
    fontSize: typography.fontSize.md,
    cursor: 'pointer',
    padding: `${spacing.xs} ${spacing.sm}`,
    borderRadius: borderRadius.full,
    lineHeight: 1,
    transition: `all ${animation.duration.fast}`,
  },
  summaryRow: {
    display: 'flex',
    gap: spacing.xs,
    flexWrap: 'wrap' as const,
  },
  summaryChip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: spacing.xs,
    padding: `${spacing.xs} ${spacing.sm}`,
    borderRadius: borderRadius.full,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    border: `1px solid rgba(255, 255, 255, 0.06)`,
    fontSize: typography.fontSize.xs,
    color: colors.text.secondary,
  },
  summaryValue: {
    color: colors.text.primary,
    fontWeight: typography.fontWeight.semibold,
  },
  tabs: {
    display: 'flex',
    gap: spacing.xs,
    padding: `0 ${spacing.md} ${spacing.md}`,
    borderBottom: `1px solid ${colors.background.light}`,
    backgroundColor: 'transparent',
  },
  tab: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    padding: `${spacing.sm} ${spacing.sm}`,
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    border: `1px solid rgba(255, 255, 255, 0.04)`,
    borderRadius: borderRadius.md,
    color: colors.text.secondary,
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.medium,
    cursor: 'pointer',
    transition: `all ${animation.duration.fast}`,
  },
  tabActive: {
    color: colors.text.primary,
    borderColor: `${colors.brand.accent}55`,
    backgroundColor: 'rgba(232, 150, 122, 0.14)',
    boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.04)',
  },
  tabIcon: {
    padding: '2px 6px',
    borderRadius: borderRadius.full,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    fontSize: '10px',
    fontWeight: typography.fontWeight.bold,
    letterSpacing: '0.08em',
    fontFamily: typography.fontFamily.mono,
    color: colors.text.secondary,
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
    minHeight: '240px',
    maxHeight: '56vh',
  },
  resizeHandle: {
    position: 'absolute' as const,
    width: '100%',
    height: '4px',
    cursor: 'ns-resize',
    backgroundColor: 'transparent',
  },
} as const;

const positionStyles: Record<string, React.CSSProperties> = {
  'bottom-right': { bottom: '80px', right: '16px' },
  'bottom-left': { bottom: '80px', left: '16px' },
  'top-right': { top: '16px', right: '16px' },
  'top-left': { top: '16px', left: '16px' },
};

export function PanelContainer({
  state,
  activeTab,
  onTabChange,
  onClose,
  onRestart,
  position,
  children,
}: PanelContainerProps): React.ReactElement {
  const [, setIsResizing] = useState(false);
  const [height] = useState(420);
  const [hoveredTab, setHoveredTab] = useState<TabId | null>(null);
  const [isCloseHovered, setIsCloseHovered] = useState(false);
  const [isRestartHovered, setIsRestartHovered] = useState(false);
  const [isExpandHovered, setIsExpandHovered] = useState(false);

  const getTabBadgeCount = useCallback((tabId: TabId): number => {
    switch (tabId) {
      case 'errors':
        return state.errors.filter(e => e.severity === 'error' || e.severity === 'critical').length;
      case 'islands':
        return Array.from(state.islands.values()).filter(i => i.status === 'error').length;
      case 'guard':
        return state.guardViolations.length;
      case 'preview':
        return state.recentChanges?.length ?? 0;
      default:
        return 0;
    }
  }, [state]);

  const issueCount = getTabBadgeCount('errors');
  const islandsCount = state.islands.size;
  const networkCount = state.networkRequests.size;
  const guardCount = state.guardViolations.length;
  const changeCount = state.recentChanges?.length ?? 0;

  const statusToneMap: Record<KitchenState['manduState'], { label: string; color: string; background: string }> = {
    normal: {
      label: 'Healthy',
      color: colors.semantic.success,
      background: `${colors.semantic.success}14`,
    },
    warning: {
      label: 'Attention',
      color: colors.semantic.warning,
      background: `${colors.semantic.warning}14`,
    },
    error: {
      label: 'Action',
      color: colors.semantic.error,
      background: `${colors.semantic.error}14`,
    },
    loading: {
      label: 'Syncing',
      color: colors.semantic.info,
      background: `${colors.semantic.info}14`,
    },
    hmr: {
      label: 'Updated',
      color: colors.brand.accent,
      background: `${colors.brand.accent}14`,
    },
  };
  const statusTone = statusToneMap[state.manduState];

  const containerStyle: React.CSSProperties = {
    ...styles.container,
    ...positionStyles[position],
    height: `${height}px`,
  };

  return (
    <div data-testid={testIds.panel} style={containerStyle}>
      {position.startsWith('bottom') && (
        <div
          style={{ ...styles.resizeHandle, top: 0 }}
          onMouseDown={() => setIsResizing(true)}
        />
      )}

      <div style={styles.header}>
        <div style={styles.headerTop}>
          <div style={styles.title}>
            <span style={styles.logo}>MK</span>
            <div style={styles.titleGroup}>
              <span style={styles.titleText}>Mandu Dev Console</span>
              <span style={styles.subtitle}>
                {state.hmrConnected ? 'Live runtime diagnostics' : 'Runtime diagnostics'}
              </span>
            </div>
          </div>
          <div style={styles.headerActions}>
            <span
              style={{
                ...styles.statusBadge,
                color: statusTone.color,
                backgroundColor: statusTone.background,
                borderColor: `${statusTone.color}45`,
              }}
            >
              {statusTone.label}
            </span>
            {onRestart && (
              <button
                data-testid={testIds.restartButton}
                style={{
                  ...styles.restartButton,
                  ...(isRestartHovered ? {
                    color: colors.semantic.warning,
                    borderColor: `${colors.semantic.warning}40`,
                    backgroundColor: `${colors.semantic.warning}16`,
                  } : {}),
                }}
                onClick={onRestart}
                onMouseEnter={() => setIsRestartHovered(true)}
                onMouseLeave={() => setIsRestartHovered(false)}
                aria-label="캐시 지우고 완전 재시작"
                title="캐시 지우고 완전 재시작"
              >
                Reset
              </button>
            )}
            <button
              style={{
                ...styles.headerButton,
                ...(isExpandHovered ? {
                  color: colors.brand.accent,
                  borderColor: `${colors.brand.accent}35`,
                  backgroundColor: `${colors.brand.accent}12`,
                } : {}),
              }}
              onClick={() => window.open('/__kitchen', '_blank')}
              onMouseEnter={() => setIsExpandHovered(true)}
              onMouseLeave={() => setIsExpandHovered(false)}
              aria-label="풀 페이지로 열기"
              title="풀 페이지로 열기"
            >
              Open
            </button>
            <button
              style={{
                ...styles.closeButton,
                ...(isCloseHovered ? {
                  color: colors.text.primary,
                  borderColor: 'rgba(255, 255, 255, 0.12)',
                  backgroundColor: 'rgba(255, 255, 255, 0.06)',
                } : {}),
              }}
              onClick={onClose}
              onMouseEnter={() => setIsCloseHovered(true)}
              onMouseLeave={() => setIsCloseHovered(false)}
              aria-label="패널 닫기"
            >
              ×
            </button>
          </div>
        </div>
        <div style={styles.summaryRow}>
          <span style={styles.summaryChip}>
            Issues <span style={styles.summaryValue}>{issueCount}</span>
          </span>
          <span style={styles.summaryChip}>
            Islands <span style={styles.summaryValue}>{islandsCount}</span>
          </span>
          <span style={styles.summaryChip}>
            Requests <span style={styles.summaryValue}>{networkCount}</span>
          </span>
          <span style={styles.summaryChip}>
            Guard <span style={styles.summaryValue}>{guardCount}</span>
          </span>
          <span style={styles.summaryChip}>
            Changes <span style={styles.summaryValue}>{changeCount}</span>
          </span>
        </div>
      </div>

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
                  borderColor: 'rgba(255, 255, 255, 0.09)',
                  backgroundColor: 'rgba(255, 255, 255, 0.05)',
                } : {}),
              }}
              onClick={() => onTabChange(tab.id)}
              onMouseEnter={() => setHoveredTab(tab.id)}
              onMouseLeave={() => setHoveredTab(null)}
            >
              <span
                style={{
                  ...styles.tabIcon,
                  ...(isActive ? {
                    color: colors.text.primary,
                    backgroundColor: 'rgba(255, 255, 255, 0.14)',
                  } : {}),
                }}
              >
                {tab.icon}
              </span>
              <span>{tab.label}</span>
              {badgeCount > 0 && (
                <span style={styles.tabBadge}>{badgeCount > 99 ? '99+' : badgeCount}</span>
              )}
            </button>
          );
        })}
      </div>

      <div style={styles.content} role="tabpanel">
        {children}
      </div>

      {position.startsWith('top') && (
        <div
          style={{ ...styles.resizeHandle, bottom: 0 }}
          onMouseDown={() => setIsResizing(true)}
        />
      )}
    </div>
  );
}
