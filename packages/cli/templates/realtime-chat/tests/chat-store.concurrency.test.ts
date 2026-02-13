import { beforeEach, describe, expect, it } from "bun:test";
import {
  __resetChatStoreForTests,
  __setSubscribeCommitHookForTests,
  appendMessage,
  subscribeWithSnapshot,
} from "../src/server/application/chat-store.ts";

describe("chat-store concurrency", () => {
  beforeEach(() => {
    __resetChatStoreForTests();
    __setSubscribeCommitHookForTests(undefined);
  });

  it("keeps snapshot/subscription consistent when write happens during subscribe", () => {
    let hookTriggered = false;

    __setSubscribeCommitHookForTests(() => {
      if (hookTriggered) return;
      hookTriggered = true;
      appendMessage("user", "racing-message");
    });

    const seen: string[] = [];
    const subscription = subscribeWithSnapshot((message) => {
      seen.push(message.text);
    });

    expect(subscription.snapshot.some((message) => message.text === "racing-message")).toBe(true);

    // listener 활성화
    const unsubscribe = subscription.commit();

    appendMessage("assistant", "after-subscribe");
    expect(seen).toContain("after-subscribe");

    unsubscribe();
  });
});
