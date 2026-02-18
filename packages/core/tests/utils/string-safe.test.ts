/**
 * DNA-005: UTF-16 Safe String Tests
 */

import { describe, it, expect } from "bun:test";
import {
  sliceUtf16Safe,
  truncateSafe,
  lengthInCodePoints,
  sliceByCodePoints,
  stripEmoji,
  hasSurrogates,
  sanitizeSurrogates,
  truncateByBytes,
} from "../../src/utils/string-safe";

describe("DNA-005: UTF-16 Safe String Utilities", () => {
  describe("sliceUtf16Safe", () => {
    it("should slice ASCII strings normally", () => {
      expect(sliceUtf16Safe("Hello World", 0, 5)).toBe("Hello");
      expect(sliceUtf16Safe("Hello World", 6)).toBe("World");
    });

    it("should not break emoji surrogate pairs", () => {
      const text = "Hi 👋 there";
      // 👋 is at index 3-4 (surrogate pair)
      // "Hi 👋 there".length = 11 (👋 takes 2 chars)

      // Slicing at emoji boundary
      expect(sliceUtf16Safe(text, 0, 4)).toBe("Hi ");
      expect(sliceUtf16Safe(text, 0, 5)).toBe("Hi 👋");

      // Slicing from middle of emoji should skip the low surrogate
      expect(sliceUtf16Safe(text, 5)).toBe(" there");
    });

    it("should handle multiple emojis", () => {
      const text = "🎉🎊🎁";
      expect(sliceUtf16Safe(text, 0, 2)).toBe("🎉");
      expect(sliceUtf16Safe(text, 2, 4)).toBe("🎊");
      expect(sliceUtf16Safe(text, 4, 6)).toBe("🎁");
    });

    it("should handle empty string", () => {
      expect(sliceUtf16Safe("", 0, 5)).toBe("");
    });

    it("should handle out of bounds", () => {
      expect(sliceUtf16Safe("Hi", 0, 100)).toBe("Hi");
      expect(sliceUtf16Safe("Hi", -5, 2)).toBe("Hi");
    });
  });

  describe("truncateSafe", () => {
    it("should truncate long strings", () => {
      const result = truncateSafe("Hello World!", { maxLength: 8 });
      expect(result).toBe("Hello...");
    });

    it("should not truncate short strings", () => {
      const result = truncateSafe("Hi", { maxLength: 10 });
      expect(result).toBe("Hi");
    });

    it("should use custom ellipsis", () => {
      const result = truncateSafe("Hello World!", {
        maxLength: 10,
        ellipsis: "…",
      });
      expect(result).toBe("Hello Wor…");
    });

    it("should truncate at word boundary", () => {
      const result = truncateSafe("Hello beautiful World!", {
        maxLength: 15,
        wordBoundary: true,
      });
      // availableLen = 15 - 3 = 12, "Hello beauti" → lastSpace at 5 → "Hello"
      expect(result).toBe("Hello...");
    });

    it("should truncate at middle", () => {
      const result = truncateSafe("Hello World!", {
        maxLength: 11,
        position: "middle",
      });
      // availableLen = 11 - 3 = 8, halfLen = 4
      // first 4: "Hell", last 4: "rld!"
      expect(result).toBe("Hell...rld!");
    });

    it("should truncate at start", () => {
      const result = truncateSafe("Hello World!", {
        maxLength: 10,
        position: "start",
      });
      expect(result).toBe("... World!");
    });

    it("should handle emoji safely", () => {
      const text = "Hello 👋 World!";
      const result = truncateSafe(text, { maxLength: 10 });
      // Should not break emoji
      expect(result).not.toContain("\uD83D");
      expect(result).not.toContain("\uDC4B");
    });
  });

  describe("lengthInCodePoints", () => {
    it("should count ASCII characters", () => {
      expect(lengthInCodePoints("Hello")).toBe(5);
    });

    it("should count emojis as single code points", () => {
      expect(lengthInCodePoints("👋")).toBe(1);
      expect(lengthInCodePoints("🎉🎊🎁")).toBe(3);
    });

    it("should count combined emojis with ZWJ", () => {
      // Family emoji (👨‍👩‍👧‍👦) has multiple code points joined by ZWJ
      const family = "👨‍👩‍👧‍👦";
      expect(family.length).toBeGreaterThan(4); // UTF-16 length
      expect(lengthInCodePoints(family)).toBe(7); // Code points (including ZWJ)
    });
  });

  describe("sliceByCodePoints", () => {
    it("should slice by code points", () => {
      const emoji = "👋🌍🎉";
      expect(sliceByCodePoints(emoji, 0, 1)).toBe("👋");
      expect(sliceByCodePoints(emoji, 1, 2)).toBe("🌍");
      expect(sliceByCodePoints(emoji, 0, 2)).toBe("👋🌍");
    });

    it("should handle mixed content", () => {
      const text = "Hi👋Bye";
      expect(sliceByCodePoints(text, 0, 3)).toBe("Hi👋");
      expect(sliceByCodePoints(text, 3)).toBe("Bye");
    });
  });

  describe("stripEmoji", () => {
    it("should remove emojis", () => {
      expect(stripEmoji("Hello 👋 World 🌍")).toBe("Hello  World ");
    });

    it("should keep non-emoji characters", () => {
      expect(stripEmoji("Hello World!")).toBe("Hello World!");
    });

    it("should handle emoji-only strings", () => {
      expect(stripEmoji("👋🌍🎉")).toBe("");
    });
  });

  describe("hasSurrogates", () => {
    it("should detect surrogate pairs", () => {
      expect(hasSurrogates("Hello 👋")).toBe(true);
      expect(hasSurrogates("Hello World")).toBe(false);
    });

    it("should handle empty string", () => {
      expect(hasSurrogates("")).toBe(false);
    });
  });

  describe("sanitizeSurrogates", () => {
    it("should keep valid surrogate pairs", () => {
      expect(sanitizeSurrogates("Hello 👋 World")).toBe("Hello 👋 World");
    });

    it("should replace isolated high surrogate", () => {
      const isolated = "Hi\uD800there";
      expect(sanitizeSurrogates(isolated)).toBe("Hi\uFFFDthere");
    });

    it("should replace isolated low surrogate", () => {
      const isolated = "Hi\uDC00there";
      expect(sanitizeSurrogates(isolated)).toBe("Hi\uFFFDthere");
    });

    it("should use custom replacement", () => {
      const isolated = "Hi\uD800there";
      expect(sanitizeSurrogates(isolated, "?")).toBe("Hi?there");
    });
  });

  describe("truncateByBytes", () => {
    it("should truncate by byte length", () => {
      // "Hello" = 5 bytes in UTF-8
      expect(truncateByBytes("Hello World", 5)).toBe("Hello");
    });

    it("should handle emoji bytes", () => {
      // 👋 = 4 bytes in UTF-8
      const text = "Hi 👋";
      // "Hi " = 3 bytes, 👋 = 4 bytes, total = 7 bytes
      expect(truncateByBytes(text, 3)).toBe("Hi ");
      expect(truncateByBytes(text, 7)).toBe("Hi 👋");
    });

    it("should not produce invalid UTF-8", () => {
      const text = "Hello 👋 World";
      const result = truncateByBytes(text, 8);
      // Should not end with broken UTF-8 sequence
      expect(result).toBe("Hello ");
    });

    it("should add ellipsis when truncated", () => {
      const result = truncateByBytes("Hello World", 8, "...");
      expect(result).toBe("Hello...");
    });
  });
});
