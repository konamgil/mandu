/**
 * Mandu WebSocket Handler
 * filling.ws({ open, message, close }) 패턴
 */

// ========== Types ==========

export interface ManduWebSocket {
  /** 고유 연결 ID */
  readonly id: string;
  /** 연결에 첨부된 데이터 */
  readonly data: Record<string, unknown>;

  /** 메시지 전송 */
  send(data: string | ArrayBuffer | Uint8Array): void;
  /** 토픽 구독 (pub/sub) */
  subscribe(topic: string): void;
  /** 토픽 구독 해제 */
  unsubscribe(topic: string): void;
  /** 토픽에 브로드캐스트 (자신 제외) */
  publish(topic: string, data: string | ArrayBuffer | Uint8Array): void;
  /** 연결 종료 */
  close(code?: number, reason?: string): void;
  /** JSON 전송 헬퍼 */
  sendJSON(data: unknown): void;
}

export interface WSHandlers {
  /** 연결 시 */
  open?(ws: ManduWebSocket): void;
  /** 메시지 수신 시 */
  message?(ws: ManduWebSocket, message: string | ArrayBuffer): void;
  /** 연결 종료 시 */
  close?(ws: ManduWebSocket, code: number, reason: string): void;
  /** 백프레셔 해소 시 */
  drain?(ws: ManduWebSocket): void;
}

export interface WSUpgradeData {
  routeId: string;
  params: Record<string, string>;
  id: string;
}

// ========== Implementation ==========

/**
 * Bun WebSocket을 ManduWebSocket으로 래핑
 */
export function wrapBunWebSocket(
  bunWs: { send: Function; subscribe: Function; unsubscribe: Function; publish: Function; close: Function; data: unknown }
): ManduWebSocket {
  const wsData = bunWs.data as WSUpgradeData;

  return {
    get id() { return wsData.id; },
    get data() { return wsData as unknown as Record<string, unknown>; },

    send(data: string | ArrayBuffer | Uint8Array) {
      bunWs.send(data);
    },
    subscribe(topic: string) {
      bunWs.subscribe(topic);
    },
    unsubscribe(topic: string) {
      bunWs.unsubscribe(topic);
    },
    publish(topic: string, data: string | ArrayBuffer | Uint8Array) {
      bunWs.publish(topic, data);
    },
    close(code?: number, reason?: string) {
      bunWs.close(code, reason);
    },
    sendJSON(data: unknown) {
      bunWs.send(JSON.stringify(data));
    },
  };
}
