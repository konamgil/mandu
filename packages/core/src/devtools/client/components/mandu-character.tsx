/**
 * Mandu Kitchen DevTools - Mandu Character Component
 * @version 1.0.3
 */

import React from 'react';
import type { ManduState } from '../../types';
import { MANDU_CHARACTERS } from '../../types';
import { colors, animation, testIds } from '../../design-tokens';

// ============================================================================
// Styles
// ============================================================================

const styles = {
  container: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '12px 16px',
    borderRadius: '12px',
    backgroundColor: colors.background.medium,
    transition: `all ${animation.duration.normal} ${animation.easing.easeOut}`,
  },
  emoji: {
    fontSize: '32px',
    lineHeight: 1,
    userSelect: 'none' as const,
  },
  content: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '2px',
  },
  message: {
    fontSize: '14px',
    color: colors.text.primary,
    fontWeight: 500,
  },
  status: {
    fontSize: '12px',
    color: colors.text.secondary,
  },
} as const;

const stateColors: Record<ManduState, string> = {
  normal: colors.semantic.success,
  warning: colors.semantic.warning,
  error: colors.semantic.error,
  loading: colors.semantic.info,
  hmr: colors.brand.accent,
};

// ============================================================================
// Animation Keyframes (inline)
// ============================================================================

const bounceAnimation = `
  @keyframes mk-bounce {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-4px); }
  }
`;

const pulseAnimation = `
  @keyframes mk-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.6; }
  }
`;

const shakeAnimation = `
  @keyframes mk-shake {
    0%, 100% { transform: translateX(0); }
    10%, 30%, 50%, 70%, 90% { transform: translateX(-2px); }
    20%, 40%, 60%, 80% { transform: translateX(2px); }
  }
`;

const sparkleAnimation = `
  @keyframes mk-sparkle {
    0% { transform: scale(1); }
    50% { transform: scale(1.1); }
    100% { transform: scale(1); }
  }
`;

// ============================================================================
// Props
// ============================================================================

export interface ManduCharacterProps {
  state: ManduState;
  errorCount?: number;
  className?: string;
  compact?: boolean;
  onClick?: () => void;
}

// ============================================================================
// Component
// ============================================================================

export function ManduCharacter({
  state,
  errorCount = 0,
  className,
  compact = false,
  onClick,
}: ManduCharacterProps): React.ReactElement {
  const character = MANDU_CHARACTERS[state];
  const stateColor = stateColors[state];

  const getAnimation = (): string => {
    switch (state) {
      case 'loading':
        return 'mk-bounce 1s ease-in-out infinite';
      case 'error':
        return 'mk-shake 0.5s ease-in-out';
      case 'hmr':
        return 'mk-sparkle 0.6s ease-in-out';
      case 'warning':
        return 'mk-pulse 2s ease-in-out infinite';
      default:
        return 'none';
    }
  };

  const containerStyle = {
    ...styles.container,
    borderLeft: `4px solid ${stateColor}`,
    cursor: onClick ? 'pointer' : 'default',
    ...(compact && {
      padding: '8px 12px',
      gap: '8px',
    }),
  };

  const emojiStyle = {
    ...styles.emoji,
    animation: getAnimation(),
    ...(compact && { fontSize: '24px' }),
  };

  return (
    <>
      {/* Inject keyframes */}
      <style>
        {bounceAnimation}
        {pulseAnimation}
        {shakeAnimation}
        {sparkleAnimation}
      </style>

      <div
        data-testid={testIds.mandu}
        className={className}
        style={containerStyle}
        onClick={onClick}
        role={onClick ? 'button' : undefined}
        tabIndex={onClick ? 0 : undefined}
        onKeyDown={(e) => {
          if (onClick && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            onClick();
          }
        }}
      >
        <span style={emojiStyle} aria-hidden="true">
          {character.emoji}
        </span>

        {!compact && (
          <div style={styles.content}>
            <span style={styles.message}>{character.message}</span>
            {errorCount > 0 && (
              <span style={styles.status}>
                {errorCount}개의 {state === 'error' ? '에러' : '경고'}가 있어요
              </span>
            )}
          </div>
        )}
      </div>
    </>
  );
}

// ============================================================================
// Badge Component (for mini display)
// ============================================================================

export interface ManduBadgeProps {
  state: ManduState;
  count?: number;
  onClick?: () => void;
}

export function ManduBadge({
  state,
  count = 0,
  onClick,
}: ManduBadgeProps): React.ReactElement {
  const character = MANDU_CHARACTERS[state];
  const stateColor = stateColors[state];
  const [isHovered, setIsHovered] = React.useState(false);

  const badgeStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    padding: count > 0 ? '10px 16px' : '0',
    width: count > 0 ? 'auto' : '48px',
    height: '48px',
    borderRadius: '9999px',
    backgroundColor: colors.background.dark,
    border: `2px solid ${isHovered ? colors.brand.accent : stateColor}`,
    cursor: 'pointer',
    transition: `all ${animation.duration.normal} ${animation.easing.spring}`,
    boxShadow: isHovered
      ? `0 8px 24px rgba(0, 0, 0, 0.4), 0 0 0 4px ${stateColor}33`
      : `0 4px 12px rgba(0, 0, 0, 0.3)`,
    fontSize: '22px',
    userSelect: 'none',
    transform: isHovered ? 'scale(1.08)' : 'scale(1)',
    outline: 'none',
    lineHeight: 1,
  };

  const countStyle: React.CSSProperties = {
    fontSize: '13px',
    fontWeight: 700,
    color: stateColor,
    minWidth: '18px',
    textAlign: 'center',
    lineHeight: 1,
  };

  return (
    <button
      data-testid={testIds.badge}
      style={badgeStyle}
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onFocus={() => setIsHovered(true)}
      onBlur={() => setIsHovered(false)}
      aria-label={`Mandu Kitchen: ${character.message}${count > 0 ? `, ${count} issues` : ''}`}
    >
      <span aria-hidden="true">🥟</span>
      {count > 0 && <span style={countStyle}>{count}</span>}
    </button>
  );
}
