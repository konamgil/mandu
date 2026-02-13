export interface ChatErrorFeedback {
  title: string;
  message: string;
  retryable: boolean;
}

export function toUserFeedback(error: unknown): ChatErrorFeedback {
  const message = extractErrorMessage(error);
  const lower = message.toLowerCase();

  if (lower.includes('invalid request body')) {
    return {
      title: '요청 형식 오류',
      message: '요청 데이터가 올바르지 않습니다. 입력 내용을 확인 후 다시 시도해주세요.',
      retryable: true,
    };
  }

  if (lower.includes('network') || lower.includes('failed to fetch')) {
    return {
      title: '네트워크 오류',
      message: '서버에 연결할 수 없습니다. 네트워크 상태를 확인하고 다시 시도해주세요.',
      retryable: true,
    };
  }

  if (lower.includes('timeout') || lower.includes('abort')) {
    return {
      title: '응답 지연',
      message: '응답이 지연되고 있습니다. 잠시 후 다시 시도해주세요.',
      retryable: true,
    };
  }

  if (lower.includes('스트림') || lower.includes('stream')) {
    return {
      title: '응답 스트림 오류',
      message: '응답을 수신하는 중 문제가 발생했습니다. 다시 시도해주세요.',
      retryable: true,
    };
  }

  if (lower.includes('http 4')) {
    return {
      title: '요청 처리 실패',
      message: '요청을 처리할 수 없습니다. 입력 내용을 확인하고 다시 시도해주세요.',
      retryable: true,
    };
  }

  if (lower.includes('http 5')) {
    return {
      title: '서버 오류',
      message: '일시적인 서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
      retryable: true,
    };
  }

  return {
    title: '처리 중 오류 발생',
    message: '요청을 처리하는 중 오류가 발생했습니다. 다시 시도해주세요.',
    retryable: true,
  };
}

export function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;

  if (error && typeof error === 'object') {
    const withMessage = error as { message?: unknown; error?: unknown; status?: unknown };
    if (typeof withMessage.message === 'string') return withMessage.message;
    if (typeof withMessage.error === 'string') return withMessage.error;
    if (typeof withMessage.status === 'number') return `HTTP ${withMessage.status}`;
  }

  return 'Unknown error';
}
