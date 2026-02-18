/**
 * Mandu Kitchen DevTools - Guard Panel
 * @version 1.0.3
 */

import React, { useMemo } from 'react';
import type { DevToolsGuardViolation } from '../../../types';
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
    fontSize: typography.fontSize.sm,
    textAlign: 'center' as const,
  },
  violationItem: {
    padding: spacing.md,
    borderRadius: borderRadius.md,
    backgroundColor: colors.background.medium,
    borderLeft: '3px solid',
    transition: `all ${animation.duration.fast}`,
  },
  violationHeader: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  ruleName: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing.xs,
  },
  badge: {
    padding: `2px ${spacing.xs}`,
    borderRadius: borderRadius.sm,
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.medium,
  },
  message: {
    fontSize: typography.fontSize.sm,
    color: colors.text.primary,
    lineHeight: typography.lineHeight.normal,
    marginBottom: spacing.sm,
  },
  location: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing.sm,
    fontSize: typography.fontSize.xs,
    fontFamily: typography.fontFamily.mono,
    color: colors.text.muted,
  },
  arrow: {
    color: colors.text.muted,
  },
  suggestion: {
    marginTop: spacing.sm,
    padding: spacing.sm,
    borderRadius: borderRadius.sm,
    backgroundColor: `${colors.semantic.info}10`,
    borderLeft: `2px solid ${colors.semantic.info}`,
    fontSize: typography.fontSize.xs,
    color: colors.text.secondary,
    lineHeight: typography.lineHeight.normal,
  },
  suggestionLabel: {
    fontWeight: typography.fontWeight.semibold,
    color: colors.semantic.info,
    marginBottom: '4px',
  },
};

const severityStyles: Record<string, { border: string; bg: string; color: string }> = {
  error: {
    border: colors.semantic.error,
    bg: `${colors.semantic.error}20`,
    color: colors.semantic.error,
  },
  warning: {
    border: colors.semantic.warning,
    bg: `${colors.semantic.warning}20`,
    color: colors.semantic.warning,
  },
};

// ============================================================================
// Props
// ============================================================================

export interface GuardPanelProps {
  violations: DevToolsGuardViolation[];
  onClear: () => void;
}

// ============================================================================
// Component
// ============================================================================

export function GuardPanel({ violations, onClear }: GuardPanelProps): React.ReactElement {
  // Group by rule
  const groupedByRule = useMemo(() => {
    const groups = new Map<string, DevToolsGuardViolation[]>();
    for (const v of violations) {
      const existing = groups.get(v.ruleId) ?? [];
      groups.set(v.ruleId, [...existing, v]);
    }
    return groups;
  }, [violations]);

  if (violations.length === 0) {
    return (
      <div style={styles.container}>
        <div style={styles.emptyState}>
          🛡️
          <p>
            아키텍처 위반이 없어요!<br />
            코드가 규칙을 잘 따르고 있어요.
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
          {violations.length}개의 위반 ({groupedByRule.size}개 규칙)
        </span>
        <button style={styles.clearButton} onClick={onClear}>
          모두 지우기
        </button>
      </div>

      {/* Violation List */}
      <div style={styles.list}>
        {violations.map((violation) => {
          const severity = severityStyles[violation.severity] ?? severityStyles.warning;

          return (
            <div
              key={violation.id}
              style={{
                ...styles.violationItem,
                borderLeftColor: severity.border,
              }}
            >
              <div style={styles.violationHeader}>
                <div style={styles.ruleName}>
                  <span
                    style={{
                      ...styles.badge,
                      backgroundColor: severity.bg,
                      color: severity.color,
                    }}
                  >
                    {violation.severity}
                  </span>
                  <span
                    style={{
                      ...styles.badge,
                      backgroundColor: colors.background.light,
                      color: colors.text.secondary,
                    }}
                  >
                    {violation.ruleName}
                  </span>
                </div>
              </div>

              <p style={styles.message}>{violation.message}</p>

              <div style={styles.location}>
                <span>
                  {violation.source.file}
                  {violation.source.line && `:${violation.source.line}`}
                </span>
                {violation.target && (
                  <>
                    <span style={styles.arrow}>→</span>
                    <span>
                      {violation.target.file}
                      {violation.target.line && `:${violation.target.line}`}
                    </span>
                  </>
                )}
              </div>

              {violation.suggestion && (
                <div style={styles.suggestion}>
                  <div style={styles.suggestionLabel}>💡 제안</div>
                  {violation.suggestion}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
