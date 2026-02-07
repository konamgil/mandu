/**
 * Mandu Kitchen DevTools - Errors Panel
 * @version 1.0.3
 */

import React, { useCallback } from 'react';
import type { NormalizedError } from '../../../types';
import { colors, typography, spacing, borderRadius, animation, testIds } from '../../../design-tokens';
import { ManduCharacter } from '../mandu-character';
import { sanitizeErrorMessage } from '../../filters';

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
    gap: spacing.sm,
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
  },
  emptyMessage: {
    fontSize: typography.fontSize.sm,
    textAlign: 'center' as const,
  },
  errorItem: {
    padding: spacing.md,
    borderRadius: borderRadius.md,
    backgroundColor: colors.background.medium,
    cursor: 'pointer',
    transition: `all ${animation.duration.fast}`,
    borderLeft: '3px solid',
  },
  errorHeader: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  errorType: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing.xs,
  },
  errorBadge: {
    padding: `2px ${spacing.xs}`,
    borderRadius: borderRadius.sm,
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.medium,
    textTransform: 'uppercase' as const,
  },
  errorTime: {
    fontSize: typography.fontSize.xs,
    color: colors.text.muted,
    whiteSpace: 'nowrap' as const,
  },
  errorMessage: {
    fontSize: typography.fontSize.sm,
    color: colors.text.primary,
    lineHeight: typography.lineHeight.normal,
    wordBreak: 'break-word' as const,
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical' as const,
    overflow: 'hidden',
  },
  errorSource: {
    marginTop: spacing.xs,
    fontSize: typography.fontSize.xs,
    color: colors.text.muted,
    fontFamily: typography.fontFamily.mono,
  },
  actionButton: {
    padding: spacing.xs,
    borderRadius: borderRadius.sm,
    backgroundColor: 'transparent',
    border: 'none',
    color: colors.text.muted,
    fontSize: typography.fontSize.sm,
    cursor: 'pointer',
    opacity: 0,
    transition: `opacity ${animation.duration.fast}`,
  },
};

const severityColors: Record<string, { bg: string; border: string; text: string }> = {
  critical: {
    bg: `${colors.semantic.error}15`,
    border: colors.semantic.error,
    text: colors.semantic.error,
  },
  error: {
    bg: `${colors.semantic.error}15`,
    border: colors.semantic.error,
    text: colors.semantic.error,
  },
  warning: {
    bg: `${colors.semantic.warning}15`,
    border: colors.semantic.warning,
    text: colors.semantic.warning,
  },
  info: {
    bg: `${colors.semantic.info}15`,
    border: colors.semantic.info,
    text: colors.semantic.info,
  },
};

// ============================================================================
// Props
// ============================================================================

export interface ErrorsPanelProps {
  errors: NormalizedError[];
  onErrorClick: (error: NormalizedError) => void;
  onErrorIgnore: (id: string) => void;
  onClearAll: () => void;
}

// ============================================================================
// Component
// ============================================================================

export function ErrorsPanel({
  errors,
  onErrorClick,
  onErrorIgnore,
  onClearAll,
}: ErrorsPanelProps): React.ReactElement {
  const formatTime = useCallback((timestamp: number): string => {
    return new Date(timestamp).toLocaleTimeString('ko-KR', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }, []);

  if (errors.length === 0) {
    return (
      <div style={styles.container}>
        <div style={styles.emptyState}>
          <ManduCharacter state="normal" compact />
          <p style={styles.emptyMessage}>
            에러가 없어요!<br />
            만두가 잘 익고 있어요 🥟
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <span style={{ fontSize: typography.fontSize.sm, color: colors.text.secondary }}>
          {errors.length}개의 이슈
        </span>
        <button style={styles.clearButton} onClick={onClearAll}>
          모두 지우기
        </button>
      </div>

      {/* Error List */}
      <div data-testid={testIds.errorList} style={styles.list}>
        {errors.map((error) => {
          const severity = severityColors[error.severity] ?? severityColors.error;

          return (
            <div
              key={error.id}
              style={{
                ...styles.errorItem,
                borderLeftColor: severity.border,
              }}
              onClick={() => onErrorClick(error)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onErrorClick(error);
              }}
              tabIndex={0}
              role="button"
            >
              <div style={styles.errorHeader}>
                <div style={styles.errorType}>
                  <span
                    style={{
                      ...styles.errorBadge,
                      backgroundColor: severity.bg,
                      color: severity.text,
                    }}
                  >
                    {error.type}
                  </span>
                  <span
                    style={{
                      ...styles.errorBadge,
                      backgroundColor: severity.bg,
                      color: severity.text,
                    }}
                  >
                    {error.severity}
                  </span>
                </div>
                <span style={styles.errorTime}>{formatTime(error.timestamp)}</span>
              </div>

              <p style={styles.errorMessage}>
                {sanitizeErrorMessage(error.message)}
              </p>

              {error.source && (
                <p style={styles.errorSource}>
                  {error.source}
                  {error.line && `:${error.line}`}
                  {error.column && `:${error.column}`}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
