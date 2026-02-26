/**
 * Mandu Kitchen DevTools - Diff Viewer
 * @version 2.0.0
 */

import React from 'react';
import { colors, typography, spacing, borderRadius, animation } from '../../../design-tokens';

// ============================================================================
// Types
// ============================================================================

export interface DiffLine {
  type: 'add' | 'remove' | 'context';
  content: string;
  oldLine?: number;
  newLine?: number;
}

export interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

export interface FileDiff {
  filePath: string;
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
  isNew: boolean;
}

export interface DiffViewerProps {
  diff: FileDiff;
  onClose: () => void;
}

// ============================================================================
// Styles
// ============================================================================

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column' as const,
    height: '100%',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: `${spacing.sm} ${spacing.md}`,
    borderBottom: `1px solid ${colors.background.light}`,
    backgroundColor: colors.background.medium,
    flexShrink: 0,
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing.sm,
    overflow: 'hidden',
  },
  fileName: {
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily.mono,
    color: colors.text.primary,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  stats: {
    display: 'flex',
    gap: spacing.sm,
    fontSize: typography.fontSize.xs,
    flexShrink: 0,
  },
  addStat: {
    color: colors.semantic.success,
    fontWeight: typography.fontWeight.medium,
  },
  removeStat: {
    color: colors.semantic.error,
    fontWeight: typography.fontWeight.medium,
  },
  closeBtn: {
    background: 'transparent',
    border: 'none',
    color: colors.text.secondary,
    fontSize: typography.fontSize.md,
    cursor: 'pointer',
    padding: spacing.xs,
    borderRadius: borderRadius.sm,
    transition: `color ${animation.duration.fast}`,
    flexShrink: 0,
  },
  body: {
    flex: 1,
    overflow: 'auto',
    fontFamily: typography.fontFamily.mono,
    fontSize: typography.fontSize.xs,
    lineHeight: typography.lineHeight.normal,
  },
  hunkHeader: {
    padding: `${spacing.xs} ${spacing.md}`,
    backgroundColor: `${colors.semantic.info}10`,
    color: colors.semantic.info,
    fontSize: typography.fontSize.xs,
    borderBottom: `1px solid ${colors.background.light}`,
  },
  line: {
    display: 'flex',
    minHeight: '20px',
    borderBottom: `1px solid ${colors.background.dark}`,
  },
  lineNumber: {
    width: '40px',
    padding: `0 ${spacing.xs}`,
    textAlign: 'right' as const,
    color: colors.text.muted,
    userSelect: 'none' as const,
    flexShrink: 0,
    fontSize: typography.fontSize.xs,
    lineHeight: '20px',
  },
  lineContent: {
    flex: 1,
    padding: `0 ${spacing.sm}`,
    whiteSpace: 'pre' as const,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    lineHeight: '20px',
  },
  emptyState: {
    padding: spacing.xl,
    textAlign: 'center' as const,
    color: colors.text.muted,
    fontSize: typography.fontSize.sm,
  },
};

const lineStyles: Record<string, React.CSSProperties> = {
  add: {
    backgroundColor: `${colors.semantic.success}15`,
    color: colors.text.primary,
  },
  remove: {
    backgroundColor: `${colors.semantic.error}15`,
    color: colors.text.primary,
  },
  context: {
    backgroundColor: 'transparent',
    color: colors.text.secondary,
  },
};

const linePrefix: Record<string, string> = {
  add: '+',
  remove: '-',
  context: ' ',
};

// ============================================================================
// Component
// ============================================================================

export function DiffViewer({ diff, onClose }: DiffViewerProps): React.ReactElement {
  if (diff.hunks.length === 0) {
    return (
      <div style={styles.container}>
        <div style={styles.header}>
          <div style={styles.headerLeft}>
            <span style={styles.fileName}>{diff.filePath}</span>
          </div>
          <button style={styles.closeBtn} onClick={onClose} aria-label="닫기">×</button>
        </div>
        <div style={styles.emptyState}>변경 사항 없음</div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <span style={styles.fileName}>
            {diff.isNew ? '(new) ' : ''}{diff.filePath}
          </span>
          <div style={styles.stats}>
            <span style={styles.addStat}>+{diff.additions}</span>
            <span style={styles.removeStat}>-{diff.deletions}</span>
          </div>
        </div>
        <button style={styles.closeBtn} onClick={onClose} aria-label="닫기">×</button>
      </div>

      <div style={styles.body}>
        {diff.hunks.map((hunk, hi) => (
          <div key={hi}>
            <div style={styles.hunkHeader}>{hunk.header}</div>
            {hunk.lines.map((line, li) => (
              <div key={li} style={{ ...styles.line, ...lineStyles[line.type] }}>
                <span style={styles.lineNumber}>
                  {line.type !== 'add' ? (line.oldLine ?? '') : ''}
                </span>
                <span style={styles.lineNumber}>
                  {line.type !== 'remove' ? (line.newLine ?? '') : ''}
                </span>
                <span style={styles.lineContent}>
                  {linePrefix[line.type]}{line.content}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
