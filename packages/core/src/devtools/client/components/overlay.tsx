/**
 * Mandu Kitchen DevTools - Error Overlay Component
 * @version 1.0.3
 */

import React, { useCallback, useEffect, useRef } from 'react';
import type { NormalizedError } from '../../types';
import { colors, typography, spacing, borderRadius, shadows, zIndex, animation, testIds } from '../../design-tokens';
import { ManduCharacter } from './mandu-character';
import { sanitizeStackTrace, sanitizeErrorMessage } from '../filters';

// ============================================================================
// Styles
// ============================================================================

const overlayStyles = {
  backdrop: {
    position: 'fixed' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.background.overlay,
    zIndex: zIndex.overlay,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    fontFamily: typography.fontFamily.sans,
  },
  container: {
    width: '100%',
    maxWidth: '800px',
    maxHeight: '90vh',
    backgroundColor: colors.background.dark,
    borderRadius: borderRadius.lg,
    boxShadow: shadows.overlay,
    display: 'flex',
    flexDirection: 'column' as const,
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.lg,
    borderBottom: `1px solid ${colors.background.light}`,
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing.md,
  },
  title: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.semibold,
    color: colors.text.primary,
    margin: 0,
  },
  badge: {
    padding: `${spacing.xs} ${spacing.sm}`,
    borderRadius: borderRadius.sm,
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.medium,
    textTransform: 'uppercase' as const,
  },
  closeButton: {
    background: 'transparent',
    border: 'none',
    color: colors.text.secondary,
    fontSize: typography.fontSize.xl,
    cursor: 'pointer',
    padding: spacing.sm,
    borderRadius: borderRadius.sm,
    transition: `color ${animation.duration.fast}`,
    lineHeight: 1,
  },
  content: {
    flex: 1,
    overflow: 'auto',
    padding: spacing.lg,
  },
  errorMessage: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.medium,
    color: colors.semantic.error,
    marginBottom: spacing.lg,
    wordBreak: 'break-word' as const,
  },
  section: {
    marginBottom: spacing.lg,
  },
  sectionTitle: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    color: colors.text.secondary,
    textTransform: 'uppercase' as const,
    marginBottom: spacing.sm,
  },
  stackTrace: {
    backgroundColor: colors.background.medium,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    fontFamily: typography.fontFamily.mono,
    fontSize: typography.fontSize.sm,
    color: colors.text.secondary,
    lineHeight: typography.lineHeight.relaxed,
    overflow: 'auto',
    maxHeight: '300px',
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-all' as const,
  },
  meta: {
    display: 'grid',
    gridTemplateColumns: 'auto 1fr',
    gap: `${spacing.xs} ${spacing.md}`,
    fontSize: typography.fontSize.sm,
  },
  metaLabel: {
    color: colors.text.muted,
  },
  metaValue: {
    color: colors.text.secondary,
    wordBreak: 'break-all' as const,
  },
  footer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.lg,
    borderTop: `1px solid ${colors.background.light}`,
    gap: spacing.md,
  },
  footerHint: {
    fontSize: typography.fontSize.sm,
    color: colors.text.muted,
  },
  buttonGroup: {
    display: 'flex',
    gap: spacing.sm,
  },
  button: {
    padding: `${spacing.sm} ${spacing.lg}`,
    borderRadius: borderRadius.md,
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium,
    cursor: 'pointer',
    transition: `all ${animation.duration.fast}`,
    border: 'none',
  },
  primaryButton: {
    backgroundColor: colors.brand.accent,
    color: colors.background.dark,
  },
  secondaryButton: {
    backgroundColor: colors.background.light,
    color: colors.text.primary,
  },
};

const severityColors: Record<string, string> = {
  critical: colors.semantic.error,
  error: colors.semantic.error,
  warning: colors.semantic.warning,
  info: colors.semantic.info,
};

// ============================================================================
// Props
// ============================================================================

export interface ErrorOverlayProps {
  error: NormalizedError;
  onClose: () => void;
  onIgnore: () => void;
  onCopy: () => void;
  onAskAI?: () => void;
}

// ============================================================================
// Component
// ============================================================================

export function ErrorOverlay({
  error,
  onClose,
  onIgnore,
  onCopy,
  onAskAI,
}: ErrorOverlayProps): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);

  // ESC 키로 닫기
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'i' || e.key === 'I') {
        onIgnore();
      } else if (e.key === 'c' || e.key === 'C') {
        onCopy();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, onIgnore, onCopy]);

  // 포커스 트랩
  useEffect(() => {
    const container = containerRef.current;
    if (container) {
      container.focus();
    }
  }, []);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [onClose]
  );

  const severityColor = severityColors[error.severity] ?? colors.semantic.error;
  const sanitizedMessage = sanitizeErrorMessage(error.message);
  const sanitizedStack = sanitizeStackTrace(error.stack);

  const formatTimestamp = (ts: number): string => {
    return new Date(ts).toLocaleTimeString('ko-KR', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  return (
    <div
      data-testid={testIds.overlay}
      style={overlayStyles.backdrop}
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="error-title"
    >
      <div
        ref={containerRef}
        style={overlayStyles.container}
        tabIndex={-1}
      >
        {/* Header */}
        <div style={overlayStyles.header}>
          <div style={overlayStyles.headerLeft}>
            <ManduCharacter state="error" compact />
            <div>
              <h2 id="error-title" style={overlayStyles.title}>
                에러 발생
              </h2>
            </div>
            <span
              style={{
                ...overlayStyles.badge,
                backgroundColor: `${severityColor}20`,
                color: severityColor,
              }}
            >
              {error.severity}
            </span>
          </div>
          <button
            style={overlayStyles.closeButton}
            onClick={onClose}
            aria-label="닫기"
          >
            ×
          </button>
        </div>

        {/* Content */}
        <div style={overlayStyles.content}>
          {/* Error Message */}
          <p style={overlayStyles.errorMessage}>{sanitizedMessage}</p>

          {/* Stack Trace */}
          {sanitizedStack && (
            <div style={overlayStyles.section}>
              <h3 style={overlayStyles.sectionTitle}>Stack Trace</h3>
              <pre style={overlayStyles.stackTrace}>{sanitizedStack}</pre>
            </div>
          )}

          {/* Component Stack (React) */}
          {error.componentStack && (
            <div style={overlayStyles.section}>
              <h3 style={overlayStyles.sectionTitle}>Component Stack</h3>
              <pre style={overlayStyles.stackTrace}>{error.componentStack}</pre>
            </div>
          )}

          {/* Meta Info */}
          <div style={overlayStyles.section}>
            <h3 style={overlayStyles.sectionTitle}>상세 정보</h3>
            <div style={overlayStyles.meta}>
              <span style={overlayStyles.metaLabel}>타입:</span>
              <span style={overlayStyles.metaValue}>{error.type}</span>

              <span style={overlayStyles.metaLabel}>시간:</span>
              <span style={overlayStyles.metaValue}>
                {formatTimestamp(error.timestamp)}
              </span>

              {error.source && (
                <>
                  <span style={overlayStyles.metaLabel}>파일:</span>
                  <span style={overlayStyles.metaValue}>
                    {error.source}
                    {error.line && `:${error.line}`}
                    {error.column && `:${error.column}`}
                  </span>
                </>
              )}

              {error.islandId && (
                <>
                  <span style={overlayStyles.metaLabel}>Island:</span>
                  <span style={overlayStyles.metaValue}>{error.islandId}</span>
                </>
              )}

              <span style={overlayStyles.metaLabel}>URL:</span>
              <span style={overlayStyles.metaValue}>{error.url}</span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={overlayStyles.footer}>
          <span style={overlayStyles.footerHint}>
            ESC: 닫기 | I: 무시 | C: 복사
          </span>
          <div style={overlayStyles.buttonGroup}>
            <button
              style={{ ...overlayStyles.button, ...overlayStyles.secondaryButton }}
              onClick={onIgnore}
            >
              무시하기
            </button>
            <button
              style={{ ...overlayStyles.button, ...overlayStyles.secondaryButton }}
              onClick={onCopy}
            >
              복사하기
            </button>
            {onAskAI && (
              <button
                style={{ ...overlayStyles.button, ...overlayStyles.primaryButton }}
                onClick={onAskAI}
              >
                AI에게 물어보기
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
