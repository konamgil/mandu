import { describe, expect, it } from 'bun:test';
import { extractErrorMessage, toUserFeedback } from './chatError';

describe('chatError utilities', () => {
  it('extracts message from Error', () => {
    expect(extractErrorMessage(new Error('boom'))).toBe('boom');
  });

  it('maps network errors to user-friendly feedback', () => {
    const feedback = toUserFeedback(new Error('Failed to fetch'));
    expect(feedback.title).toBe('네트워크 오류');
    expect(feedback.retryable).toBe(true);
  });

  it('maps 5xx errors to server error feedback', () => {
    const feedback = toUserFeedback(new Error('HTTP 500: Internal Server Error'));
    expect(feedback.title).toBe('서버 오류');
  });

  it('returns generic fallback for unknown errors', () => {
    const feedback = toUserFeedback({});
    expect(feedback.title).toBe('처리 중 오류 발생');
  });
});
