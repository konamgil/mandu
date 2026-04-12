/**
 * Mandu Kitchen DevTools - Mandu Character Component
 * @version 1.0.3
 */

import React from 'react';
import type { ManduState } from '../../types';
import { MANDU_CHARACTERS } from '../../types';
import { colors, typography, animation, testIds } from '../../design-tokens';

const styles = {
  container: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '12px 16px',
    borderRadius: '16px',
    background: `linear-gradient(180deg, ${colors.background.medium}, ${colors.background.dark})`,
    border: `1px solid ${colors.background.light}`,
    boxShadow: '0 14px 32px rgba(7, 7, 12, 0.28)',
    transition: `all ${animation.duration.normal} ${animation.easing.easeOut}`,
  },
  mark: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: '44px',
    height: '44px',
    padding: '0 12px',
    borderRadius: '9999px',
    fontSize: '11px',
    lineHeight: 1,
    letterSpacing: '0.12em',
    fontWeight: 700,
    userSelect: 'none' as const,
    fontFamily: typography.fontFamily.mono,
    textTransform: 'uppercase' as const,
    border: `1px solid ${colors.background.light}`,
  },
  content: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '2px',
  },
  message: {
    fontSize: '14px',
    color: colors.text.primary,
    fontWeight: 600,
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
    50% { transform: scale(1.08); }
    100% { transform: scale(1); }
  }
`;

export interface ManduCharacterProps {
  state: ManduState;
  errorCount?: number;
  className?: string;
  compact?: boolean;
  onClick?: () => void;
}

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

  const containerStyle: React.CSSProperties = {
    ...styles.container,
    borderLeft: `4px solid ${stateColor}`,
    cursor: onClick ? 'pointer' : 'default',
    ...(compact && {
      padding: '8px 12px',
      gap: '8px',
      borderRadius: '14px',
    }),
  };

  const markStyle: React.CSSProperties = {
    ...styles.mark,
    animation: getAnimation(),
    color: stateColor,
    backgroundColor: `${stateColor}18`,
    borderColor: `${stateColor}45`,
    boxShadow: `inset 0 1px 0 rgba(255, 255, 255, 0.03), 0 0 0 1px ${stateColor}10`,
    ...(compact && {
      minWidth: '36px',
      height: '36px',
      padding: '0 10px',
      fontSize: '10px',
    }),
  };

  return (
    <>
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
        <span style={markStyle} aria-hidden="true">
          {character.mark}
        </span>

        {!compact && (
          <div style={styles.content}>
            <span style={styles.message}>{character.message}</span>
            {errorCount > 0 && (
              <span style={styles.status}>
                {errorCount}개의 {state === 'error' ? '에러' : '경고'}가 있습니다
              </span>
            )}
          </div>
        )}
      </div>
    </>
  );
}

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
  const [isPressed, setIsPressed] = React.useState(false);

  const badgeStyle: React.CSSProperties = {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '72px',
    height: '56px',
    padding: '0 14px',
    borderRadius: '18px',
    background: isPressed
      ? `linear-gradient(180deg, ${colors.background.light}, ${colors.background.medium})`
      : isHovered
        ? `linear-gradient(180deg, ${colors.background.medium}, ${colors.background.dark})`
        : `linear-gradient(180deg, ${colors.background.dark}, ${colors.background.medium})`,
    border: `1px solid ${isPressed ? stateColor : isHovered ? colors.brand.accent : `${stateColor}80`}`,
    cursor: 'pointer',
    transition: `all 200ms ${animation.easing.spring}`,
    boxShadow: isPressed
      ? '0 8px 18px rgba(8, 6, 18, 0.36), inset 0 2px 4px rgba(0, 0, 0, 0.12)'
      : isHovered
        ? `0 18px 36px rgba(8, 6, 18, 0.42), 0 0 0 4px ${stateColor}18`
        : `0 10px 22px rgba(8, 6, 18, 0.3), 0 0 0 1px ${stateColor}14`,
    userSelect: 'none',
    transform: isPressed
      ? 'scale(0.92) translateY(1px)'
      : isHovered
        ? 'scale(1.04) translateY(-2px)'
        : 'scale(1) translateY(0px)',
    outline: 'none',
    lineHeight: 1,
    animation: isHovered || isPressed
      ? 'none'
      : state === 'normal'
        ? 'mk-badge-breathe 3s ease-in-out infinite'
        : state === 'error' && count > 0
          ? 'mk-badge-attention 2s ease-in-out infinite'
          : state === 'loading'
            ? 'mk-badge-float 2s ease-in-out infinite'
            : 'none',
  };

  const textStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: '3px',
    fontFamily: typography.fontFamily.sans,
    color: colors.brand.accent,
    fontSize: '13px',
    fontWeight: typography.fontWeight.bold,
    lineHeight: 1,
    letterSpacing: '0.08em',
    transition: `transform 200ms ${animation.easing.spring}`,
    transform: isHovered ? 'translateY(-1px)' : 'translateY(0px)',
    userSelect: 'none',
  };

  const subtextStyle: React.CSSProperties = {
    fontSize: '9px',
    fontWeight: typography.fontWeight.medium,
    letterSpacing: '0.16em',
    color: colors.text.secondary,
    textTransform: 'uppercase',
  };

  const countBubbleStyle: React.CSSProperties = {
    position: 'absolute',
    top: '-4px',
    right: '-4px',
    minWidth: '20px',
    height: '20px',
    padding: '0 5px',
    borderRadius: '9999px',
    backgroundColor: stateColor,
    color: colors.background.dark,
    fontSize: '11px',
    fontWeight: 700,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    lineHeight: 1,
    boxShadow: `0 2px 8px ${stateColor}66`,
    border: `2px solid ${colors.background.dark}`,
    transition: `all 200ms ${animation.easing.spring}`,
    transform: isHovered ? 'scale(1.15)' : 'scale(1)',
  };

  return (
    <button
      data-testid={testIds.badge}
      style={badgeStyle}
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => {
        setIsHovered(false);
        setIsPressed(false);
      }}
      onMouseDown={() => setIsPressed(true)}
      onMouseUp={() => setIsPressed(false)}
      onFocus={() => setIsHovered(true)}
      onBlur={() => {
        setIsHovered(false);
        setIsPressed(false);
      }}
      aria-label={`Mandu Kitchen: ${character.message}${count > 0 ? `, ${count} issues` : ''}`}
    >
      <span aria-hidden="true" style={textStyle}>
        <span>MK</span>
        <span style={subtextStyle}>Dev</span>
      </span>
      {count > 0 && (
        <span style={countBubbleStyle}>
          {count > 99 ? '99+' : count}
        </span>
      )}
    </button>
  );
}
