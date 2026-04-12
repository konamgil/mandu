/**
 * Mandu Kitchen DevTools - Preview Panel
 * @version 2.0.0
 *
 * Shows recent file changes with inline diff viewer.
 */

import React, { useState, useCallback } from 'react';
import type { RecentChange } from '../../../types';
import { DiffViewer, type FileDiff } from './diff-viewer';
import { colors, typography, spacing, borderRadius, animation } from '../../../design-tokens';

// ============================================================================
// Styles
// ============================================================================

const styles = {
  container: {
    padding: spacing.md,
    height: '100%',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: spacing.md,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  clearButton: {
    padding: `${spacing.xs} ${spacing.sm}`,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.background.light,
    border: 'none',
    color: colors.text.secondary,
    fontSize: typography.fontSize.xs,
    cursor: 'pointer',
    transition: `all ${animation.duration.fast}`,
  },
  list: {
    flex: 1,
    overflow: 'auto',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: spacing.xs,
  },
  emptyState: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.xl,
    color: colors.text.muted,
    fontSize: typography.fontSize.sm,
    textAlign: 'center' as const,
  },
  changeItem: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing.sm,
    padding: `${spacing.sm} ${spacing.md}`,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.background.medium,
    cursor: 'pointer',
    transition: `all ${animation.duration.fast}`,
    fontSize: typography.fontSize.sm,
  },
  changeIcon: {
    flexShrink: 0,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: '42px',
    height: '24px',
    padding: '0 8px',
    borderRadius: borderRadius.full,
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.semibold,
    fontFamily: typography.fontFamily.mono,
    letterSpacing: '0.08em',
  },
  changePath: {
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
    fontFamily: typography.fontFamily.mono,
    fontSize: typography.fontSize.xs,
    color: colors.text.primary,
  },
  changeTime: {
    flexShrink: 0,
    fontSize: typography.fontSize.xs,
    color: colors.text.muted,
  },
};

const typeIcons: Record<string, string> = {
  add: 'ADD',
  change: 'EDIT',
  delete: 'DEL',
};

const typeStyles: Record<string, { bg: string; color: string }> = {
  add: { bg: `${colors.semantic.success}20`, color: colors.semantic.success },
  change: { bg: `${colors.semantic.info}20`, color: colors.semantic.info },
  delete: { bg: `${colors.semantic.error}20`, color: colors.semantic.error },
};

// ============================================================================
// Props
// ============================================================================

export interface PreviewPanelProps {
  recentChanges: RecentChange[];
  onClearChanges?: () => void;
}

// ============================================================================
// Component
// ============================================================================

export function PreviewPanel({ recentChanges, onClearChanges }: PreviewPanelProps): React.ReactElement {
  const [selectedDiff, setSelectedDiff] = useState<FileDiff | null>(null);
  const [loadingDiff, setLoadingDiff] = useState<string | null>(null);

  const handleFileClick = useCallback(async (filePath: string) => {
    setLoadingDiff(filePath);
    try {
      const res = await fetch(`/__kitchen/api/file/diff?path=${encodeURIComponent(filePath)}`);
      if (res.ok) {
        const diff = await res.json();
        setSelectedDiff(diff);
      }
    } catch {
      // API not available
    } finally {
      setLoadingDiff(null);
    }
  }, []);

  const handleCloseDiff = useCallback(() => {
    setSelectedDiff(null);
  }, []);

  if (selectedDiff) {
    return <DiffViewer diff={selectedDiff} onClose={handleCloseDiff} />;
  }

  if (recentChanges.length === 0) {
    return (
      <div style={styles.container}>
        <div style={styles.emptyState}>
          <p>파일을 수정하면 여기에 최근 변경사항이 표시됩니다.</p>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <span style={{ fontSize: typography.fontSize.sm, color: colors.text.secondary }}>
          {recentChanges.length}개의 변경사항
        </span>
        {onClearChanges && (
          <button style={styles.clearButton} onClick={onClearChanges}>
            모두 지우기
          </button>
        )}
      </div>

      <div style={styles.list}>
        {recentChanges.map((change, i) => {
          const isLoading = loadingDiff === change.filePath;
          const changeStyle = typeStyles[change.type] ?? typeStyles.change;
          return (
            <div
              key={`${change.filePath}-${change.timestamp}-${i}`}
              style={{
                ...styles.changeItem,
                opacity: isLoading ? 0.5 : 1,
              }}
              onClick={() => !isLoading && handleFileClick(change.filePath)}
            >
              <span
                style={{
                  ...styles.changeIcon,
                  backgroundColor: changeStyle.bg,
                  color: changeStyle.color,
                }}
              >
                {typeIcons[change.type] ?? 'EDIT'}
              </span>
              <span style={styles.changePath}>{change.filePath}</span>
              <span style={styles.changeTime}>
                {formatTime(change.timestamp)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
