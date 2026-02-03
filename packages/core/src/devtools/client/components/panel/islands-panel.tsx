/**
 * Mandu Kitchen DevTools - Islands Panel
 * @version 1.0.3
 */

import React, { useMemo } from 'react';
import type { IslandSnapshot } from '../../../types';
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
  stats: {
    display: 'flex',
    gap: spacing.md,
  },
  stat: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing.xs,
    fontSize: typography.fontSize.xs,
    color: colors.text.secondary,
  },
  statValue: {
    fontWeight: typography.fontWeight.semibold,
    color: colors.text.primary,
  },
  timeline: {
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
  islandItem: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.sm,
    borderRadius: borderRadius.md,
    backgroundColor: colors.background.medium,
    transition: `all ${animation.duration.fast}`,
  },
  islandIcon: {
    fontSize: typography.fontSize.lg,
    width: '28px',
    textAlign: 'center' as const,
  },
  islandInfo: {
    flex: 1,
    minWidth: 0,
  },
  islandName: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium,
    color: colors.text.primary,
    whiteSpace: 'nowrap' as const,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  islandMeta: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: '2px',
  },
  badge: {
    padding: `1px ${spacing.xs}`,
    borderRadius: borderRadius.sm,
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.medium,
  },
  timeBar: {
    width: '80px',
    height: '4px',
    borderRadius: borderRadius.full,
    backgroundColor: colors.background.light,
    overflow: 'hidden',
  },
  timeBarFill: {
    height: '100%',
    borderRadius: borderRadius.full,
    transition: `width ${animation.duration.normal}`,
  },
  timing: {
    fontSize: typography.fontSize.xs,
    color: colors.text.muted,
    fontFamily: typography.fontFamily.mono,
    minWidth: '50px',
    textAlign: 'right' as const,
  },
};

const statusConfig: Record<string, { icon: string; color: string; bg: string }> = {
  ssr: { icon: '📄', color: colors.text.muted, bg: colors.background.light },
  pending: { icon: '⏳', color: colors.semantic.warning, bg: `${colors.semantic.warning}20` },
  hydrating: { icon: '💧', color: colors.semantic.info, bg: `${colors.semantic.info}20` },
  hydrated: { icon: '✅', color: colors.semantic.success, bg: `${colors.semantic.success}20` },
  error: { icon: '❌', color: colors.semantic.error, bg: `${colors.semantic.error}20` },
};

const strategyLabels: Record<string, string> = {
  load: '즉시',
  idle: 'Idle',
  visible: 'Visible',
  media: 'Media',
  never: 'Never',
};

// ============================================================================
// Props
// ============================================================================

export interface IslandsPanelProps {
  islands: IslandSnapshot[];
}

// ============================================================================
// Component
// ============================================================================

export function IslandsPanel({ islands }: IslandsPanelProps): React.ReactElement {
  // Statistics
  const stats = useMemo(() => {
    const total = islands.length;
    const hydrated = islands.filter((i) => i.status === 'hydrated').length;
    const pending = islands.filter((i) => i.status === 'pending' || i.status === 'hydrating').length;
    const errors = islands.filter((i) => i.status === 'error').length;
    const totalHydrateTime = islands.reduce((sum, i) => {
      if (i.hydrateStartTime && i.hydrateEndTime) {
        return sum + (i.hydrateEndTime - i.hydrateStartTime);
      }
      return sum;
    }, 0);

    return { total, hydrated, pending, errors, totalHydrateTime };
  }, [islands]);

  // Max hydration time for scaling
  const maxHydrateTime = useMemo(() => {
    return Math.max(
      100,
      ...islands.map((i) =>
        i.hydrateStartTime && i.hydrateEndTime
          ? i.hydrateEndTime - i.hydrateStartTime
          : 0
      )
    );
  }, [islands]);

  if (islands.length === 0) {
    return (
      <div style={styles.container}>
        <div style={styles.emptyState}>
          🏝️
          <p>
            아직 등록된 Island가 없어요.<br />
            Island 컴포넌트를 사용하면 여기에 표시됩니다.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {/* Header Stats */}
      <div style={styles.header}>
        <div style={styles.stats}>
          <div style={styles.stat}>
            <span>전체:</span>
            <span style={styles.statValue}>{stats.total}</span>
          </div>
          <div style={styles.stat}>
            <span>✅</span>
            <span style={styles.statValue}>{stats.hydrated}</span>
          </div>
          {stats.pending > 0 && (
            <div style={styles.stat}>
              <span>⏳</span>
              <span style={styles.statValue}>{stats.pending}</span>
            </div>
          )}
          {stats.errors > 0 && (
            <div style={styles.stat}>
              <span>❌</span>
              <span style={{ ...styles.statValue, color: colors.semantic.error }}>
                {stats.errors}
              </span>
            </div>
          )}
        </div>
        <div style={styles.stat}>
          <span>총 시간:</span>
          <span style={styles.statValue}>{stats.totalHydrateTime.toFixed(0)}ms</span>
        </div>
      </div>

      {/* Timeline */}
      <div style={styles.timeline}>
        {islands.map((island) => {
          const status = statusConfig[island.status] ?? statusConfig.pending;
          const hydrateTime =
            island.hydrateStartTime && island.hydrateEndTime
              ? island.hydrateEndTime - island.hydrateStartTime
              : null;
          const timePercent = hydrateTime ? (hydrateTime / maxHydrateTime) * 100 : 0;

          return (
            <div key={island.id} style={styles.islandItem}>
              <span style={styles.islandIcon}>{status.icon}</span>

              <div style={styles.islandInfo}>
                <div style={styles.islandName}>{island.name}</div>
                <div style={styles.islandMeta}>
                  <span
                    style={{
                      ...styles.badge,
                      backgroundColor: status.bg,
                      color: status.color,
                    }}
                  >
                    {island.status}
                  </span>
                  <span
                    style={{
                      ...styles.badge,
                      backgroundColor: colors.background.light,
                      color: colors.text.muted,
                    }}
                  >
                    {strategyLabels[island.strategy] ?? island.strategy}
                  </span>
                  {island.bundleSize && (
                    <span
                      style={{
                        ...styles.badge,
                        backgroundColor: colors.background.light,
                        color: colors.text.muted,
                      }}
                    >
                      {(island.bundleSize / 1024).toFixed(1)}KB
                    </span>
                  )}
                </div>
              </div>

              {/* Time Bar */}
              {hydrateTime !== null && (
                <>
                  <div style={styles.timeBar}>
                    <div
                      style={{
                        ...styles.timeBarFill,
                        width: `${timePercent}%`,
                        backgroundColor:
                          hydrateTime > 100
                            ? colors.semantic.warning
                            : colors.semantic.success,
                      }}
                    />
                  </div>
                  <span style={styles.timing}>{hydrateTime.toFixed(0)}ms</span>
                </>
              )}

              {hydrateTime === null && island.status === 'hydrating' && (
                <span style={{ ...styles.timing, color: colors.semantic.info }}>
                  진행중...
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
