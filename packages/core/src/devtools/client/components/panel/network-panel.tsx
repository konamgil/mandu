/**
 * Mandu Kitchen DevTools - Network Panel
 * @version 1.0.3
 */

import React, { useMemo, useState } from 'react';
import type { NetworkRequest } from '../../../types';
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
    gap: spacing.md,
  },
  filterGroup: {
    display: 'flex',
    gap: spacing.xs,
  },
  filterButton: {
    padding: `${spacing.xs} ${spacing.sm}`,
    borderRadius: borderRadius.sm,
    border: 'none',
    backgroundColor: colors.background.light,
    color: colors.text.secondary,
    fontSize: typography.fontSize.xs,
    cursor: 'pointer',
    transition: `all ${animation.duration.fast}`,
  },
  filterButtonActive: {
    backgroundColor: colors.brand.accent,
    color: colors.background.dark,
  },
  stats: {
    display: 'flex',
    gap: spacing.md,
    fontSize: typography.fontSize.xs,
    color: colors.text.muted,
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
  requestItem: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: borderRadius.md,
    backgroundColor: colors.background.medium,
    transition: `all ${animation.duration.fast}`,
    cursor: 'pointer',
  },
  method: {
    padding: `2px ${spacing.xs}`,
    borderRadius: borderRadius.sm,
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.semibold,
    fontFamily: typography.fontFamily.mono,
    minWidth: '50px',
    textAlign: 'center' as const,
  },
  url: {
    flex: 1,
    fontSize: typography.fontSize.sm,
    color: colors.text.primary,
    fontFamily: typography.fontFamily.mono,
    whiteSpace: 'nowrap' as const,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  status: {
    padding: `2px ${spacing.xs}`,
    borderRadius: borderRadius.sm,
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.medium,
    minWidth: '36px',
    textAlign: 'center' as const,
  },
  timing: {
    fontSize: typography.fontSize.xs,
    color: colors.text.muted,
    fontFamily: typography.fontFamily.mono,
    minWidth: '50px',
    textAlign: 'right' as const,
  },
  streamingBadge: {
    padding: `2px ${spacing.xs}`,
    borderRadius: borderRadius.sm,
    backgroundColor: `${colors.semantic.info}20`,
    color: colors.semantic.info,
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.medium,
  },
};

const methodColors: Record<string, { bg: string; color: string }> = {
  GET: { bg: `${colors.semantic.success}20`, color: colors.semantic.success },
  POST: { bg: `${colors.semantic.info}20`, color: colors.semantic.info },
  PUT: { bg: `${colors.semantic.warning}20`, color: colors.semantic.warning },
  PATCH: { bg: `${colors.semantic.warning}20`, color: colors.semantic.warning },
  DELETE: { bg: `${colors.semantic.error}20`, color: colors.semantic.error },
};

type FilterType = 'all' | 'fetch' | 'sse' | 'error';

// ============================================================================
// Props
// ============================================================================

export interface NetworkPanelProps {
  requests: NetworkRequest[];
}

// ============================================================================
// Component
// ============================================================================

export function NetworkPanel({ requests }: NetworkPanelProps): React.ReactElement {
  const [filter, setFilter] = useState<FilterType>('all');

  // Filter requests
  const filteredRequests = useMemo(() => {
    return requests.filter((req) => {
      switch (filter) {
        case 'fetch':
          return !req.isStreaming;
        case 'sse':
          return req.isStreaming;
        case 'error':
          return req.status && req.status >= 400;
        default:
          return true;
      }
    });
  }, [requests, filter]);

  // Stats
  const stats = useMemo(() => {
    const total = requests.length;
    const streaming = requests.filter((r) => r.isStreaming).length;
    const errors = requests.filter((r) => r.status && r.status >= 400).length;
    const totalTime = requests.reduce((sum, r) => {
      if (r.startTime && r.endTime) {
        return sum + (r.endTime - r.startTime);
      }
      return sum;
    }, 0);

    return { total, streaming, errors, totalTime };
  }, [requests]);

  const getStatusStyle = (status?: number): React.CSSProperties => {
    if (!status) {
      return { backgroundColor: colors.background.light, color: colors.text.muted };
    }
    if (status >= 500) {
      return { backgroundColor: `${colors.semantic.error}20`, color: colors.semantic.error };
    }
    if (status >= 400) {
      return { backgroundColor: `${colors.semantic.warning}20`, color: colors.semantic.warning };
    }
    if (status >= 300) {
      return { backgroundColor: `${colors.semantic.info}20`, color: colors.semantic.info };
    }
    return { backgroundColor: `${colors.semantic.success}20`, color: colors.semantic.success };
  };

  const formatUrl = (url: string): string => {
    try {
      const parsed = new URL(url);
      return parsed.pathname + parsed.search;
    } catch {
      return url;
    }
  };

  const formatDuration = (start: number, end?: number): string => {
    if (!end) return '...';
    const duration = end - start;
    if (duration < 1000) return `${duration.toFixed(0)}ms`;
    return `${(duration / 1000).toFixed(1)}s`;
  };

  if (requests.length === 0) {
    return (
      <div style={styles.container}>
        <div style={styles.emptyState}>
          📡
          <p>
            아직 네트워크 요청이 없어요.<br />
            API 호출이 발생하면 여기에 표시됩니다.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.filterGroup}>
          {(['all', 'fetch', 'sse', 'error'] as FilterType[]).map((f) => (
            <button
              key={f}
              style={{
                ...styles.filterButton,
                ...(filter === f ? styles.filterButtonActive : {}),
              }}
              onClick={() => setFilter(f)}
            >
              {f === 'all' && `전체 (${stats.total})`}
              {f === 'fetch' && 'Fetch'}
              {f === 'sse' && `SSE (${stats.streaming})`}
              {f === 'error' && `에러 (${stats.errors})`}
            </button>
          ))}
        </div>
        <div style={styles.stats}>
          <span>총 시간: {(stats.totalTime / 1000).toFixed(1)}s</span>
        </div>
      </div>

      {/* Request List */}
      <div style={styles.list}>
        {filteredRequests.map((request) => {
          const methodStyle = methodColors[request.method] ?? methodColors.GET;

          return (
            <div key={request.id} style={styles.requestItem}>
              <span
                style={{
                  ...styles.method,
                  backgroundColor: methodStyle.bg,
                  color: methodStyle.color,
                }}
              >
                {request.method}
              </span>

              <span style={styles.url} title={request.url}>
                {formatUrl(request.url)}
              </span>

              {request.isStreaming && (
                <span style={styles.streamingBadge}>
                  SSE {request.chunkCount && `(${request.chunkCount})`}
                </span>
              )}

              <span style={{ ...styles.status, ...getStatusStyle(request.status) }}>
                {request.status ?? '...'}
              </span>

              <span style={styles.timing}>
                {formatDuration(request.startTime, request.endTime)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
