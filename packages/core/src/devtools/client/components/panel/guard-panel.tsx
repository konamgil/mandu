/**
 * Mandu Kitchen DevTools - Guard Panel
 * @version 1.0.3
 */

import React, { useMemo, useState, useCallback } from 'react';
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

export interface GuardDecisionState {
  violationKey: string;
  action: 'approve' | 'reject';
}

export interface GuardPanelProps {
  violations: DevToolsGuardViolation[];
  onClear: () => void;
}

// ============================================================================
// Component
// ============================================================================

export function GuardPanel({ violations, onClear }: GuardPanelProps): React.ReactElement {
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<{ total: number; errors: number; warnings: number } | null>(null);
  const [decisions, setDecisions] = useState<Map<string, 'approve' | 'reject'>>(new Map());
  const [showApproved, setShowApproved] = useState(false);

  const handleDecision = useCallback(async (ruleId: string, filePath: string, action: 'approve' | 'reject') => {
    try {
      const endpoint = action === 'approve' ? '/__kitchen/api/guard/approve' : '/__kitchen/api/guard/reject';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ruleId, filePath }),
      });
      if (res.ok) {
        setDecisions(prev => {
          const next = new Map(prev);
          next.set(`${ruleId}::${filePath}`, action);
          return next;
        });
      }
    } catch {
      // Kitchen API not available
    }
  }, []);

  const handleScan = useCallback(async () => {
    setScanning(true);
    setScanResult(null);
    try {
      const res = await fetch('/__kitchen/api/guard/scan', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        if (data.report) {
          setScanResult({
            total: data.report.totalViolations,
            errors: data.report.bySeverity?.error ?? 0,
            warnings: data.report.bySeverity?.warn ?? data.report.bySeverity?.warning ?? 0,
          });
        }
      }
    } catch {
      // Kitchen API not available (non-dev or older version)
    } finally {
      setScanning(false);
    }
  }, []);

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
          <p>
            현재 아키텍처 위반이 없습니다.<br />
            새 스캔 결과가 생기면 여기에 표시됩니다.
          </p>
          <button
            style={{
              ...styles.clearButton,
              padding: `${spacing.sm} ${spacing.md}`,
              marginTop: spacing.sm,
              opacity: scanning ? 0.5 : 1,
            }}
            onClick={handleScan}
            disabled={scanning}
          >
            {scanning ? '스캔 중...' : '전체 스캔'}
          </button>
          {scanResult && (
            <p style={{ marginTop: spacing.sm, fontSize: typography.fontSize.xs }}>
              스캔 결과: {scanResult.total === 0
                ? '위반 없음'
                : `${scanResult.total}개 위반 (에러 ${scanResult.errors}, 경고 ${scanResult.warnings})`
              }
            </p>
          )}
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
        <div style={{ display: 'flex', gap: spacing.xs }}>
          <button
            style={styles.clearButton}
            onClick={() => setShowApproved(!showApproved)}
          >
            {showApproved ? '승인 숨기기' : '승인 보기'}
          </button>
          <button
            style={{ ...styles.clearButton, opacity: scanning ? 0.5 : 1 }}
            onClick={handleScan}
            disabled={scanning}
          >
            {scanning ? '스캔 중...' : '스캔'}
          </button>
          <button style={styles.clearButton} onClick={onClear}>
            모두 지우기
          </button>
        </div>
      </div>

      {/* Violation List */}
      <div style={styles.list}>
        {violations.map((violation) => {
          const severity = severityStyles[violation.severity] ?? severityStyles.warning;
          const decisionKey = `${violation.ruleId}::${violation.source.file}`;
          const decision = decisions.get(decisionKey);
          const isApproved = decision === 'approve';

          if (isApproved && !showApproved) return null;

          return (
            <div
              key={violation.id}
              style={{
                ...styles.violationItem,
                borderLeftColor: severity.border,
                opacity: isApproved ? 0.5 : 1,
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
                  {isApproved && (
                    <span
                      style={{
                        ...styles.badge,
                        backgroundColor: `${colors.semantic.success}20`,
                        color: colors.semantic.success,
                      }}
                    >
                      Approved
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: '4px' }}>
                  <button
                    style={{
                      ...styles.clearButton,
                      fontSize: typography.fontSize.xs,
                      padding: '2px 6px',
                      backgroundColor: isApproved ? `${colors.semantic.success}20` : colors.background.light,
                      color: isApproved ? colors.semantic.success : colors.text.secondary,
                    }}
                    onClick={() => handleDecision(violation.ruleId, violation.source.file, 'approve')}
                  >
                    허용
                  </button>
                  <button
                    style={{
                      ...styles.clearButton,
                      fontSize: typography.fontSize.xs,
                      padding: '2px 6px',
                      backgroundColor: decision === 'reject' ? `${colors.semantic.error}20` : colors.background.light,
                      color: decision === 'reject' ? colors.semantic.error : colors.text.secondary,
                    }}
                    onClick={() => handleDecision(violation.ruleId, violation.source.file, 'reject')}
                  >
                    차단
                  </button>
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
                  <div style={styles.suggestionLabel}>제안</div>
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
