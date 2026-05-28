/**
 * Browser-safe Mandu props serialization.
 *
 * This module intentionally has no DOM, Bun, or Node imports. Runtime entry
 * code may read from the document, but serialization semantics live here.
 */

const TYPE_MARKERS = {
  UNDEFINED: "\x00_",
  DATE: "\x00D",
  URL: "\x00U",
  REGEXP: "\x00R",
  MAP: "\x00M",
  SET: "\x00S",
  REF: "\x00$",
  BIGINT: "\x00B",
  SYMBOL: "\x00Y",
  ERROR: "\x00E",
} as const;

interface SerializeContext {
  seen: Map<object, number>;
  refs: object[];
}

interface DeserializeContext {
  refs: unknown[];
}

export function serializeProps(props: Record<string, unknown>): string {
  const ctx: SerializeContext = { seen: new Map(), refs: [] };
  return JSON.stringify(serialize(props, ctx));
}

function serialize(value: unknown, ctx: SerializeContext): unknown {
  if (value === null) return null;
  if (value === undefined) return TYPE_MARKERS.UNDEFINED;

  if (typeof value === "boolean" || typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    return value.startsWith("\x00") ? "\x00\x00" + value : value;
  }

  if (typeof value === "bigint") {
    return TYPE_MARKERS.BIGINT + value.toString();
  }

  if (typeof value === "symbol") {
    return TYPE_MARKERS.SYMBOL + (value.description ?? "");
  }

  if (typeof value === "function") {
    console.warn("[Mandu Serialize] Functions cannot be serialized, skipping");
    return undefined;
  }

  if (typeof value === "object") {
    const existing = ctx.seen.get(value);
    if (existing !== undefined) {
      return TYPE_MARKERS.REF + existing;
    }

    const idx = ctx.refs.length;
    ctx.seen.set(value, idx);
    ctx.refs.push(value);
  }

  if (value instanceof Date) {
    return TYPE_MARKERS.DATE + value.toISOString();
  }

  if (value instanceof URL) {
    return TYPE_MARKERS.URL + value.href;
  }

  if (value instanceof RegExp) {
    return TYPE_MARKERS.REGEXP + value.toString();
  }

  if (value instanceof Error) {
    return [
      TYPE_MARKERS.ERROR,
      value.name,
      value.message,
      value.stack ?? "",
    ];
  }

  if (value instanceof Map) {
    const entries: [unknown, unknown][] = [];
    for (const [key, nested] of value.entries()) {
      entries.push([serialize(key, ctx), serialize(nested, ctx)]);
    }
    return [TYPE_MARKERS.MAP, ...entries];
  }

  if (value instanceof Set) {
    const items: unknown[] = [];
    for (const item of value) {
      items.push(serialize(item, ctx));
    }
    return [TYPE_MARKERS.SET, ...items];
  }

  if (Array.isArray(value)) {
    return value.map((item) => serialize(item, ctx));
  }

  const result: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as object)) {
    const serialized = serialize(nested, ctx);
    if (serialized !== undefined) {
      result[key] = serialized;
    }
  }
  return result;
}

export function deserializeProps(json: string): Record<string, unknown> {
  const ctx: DeserializeContext = { refs: [] };
  const parsed = JSON.parse(json);
  return deserialize(parsed, ctx) as Record<string, unknown>;
}

function deserialize(value: unknown, ctx: DeserializeContext): unknown {
  if (value === null) return null;

  if (typeof value === "string") {
    if (value === TYPE_MARKERS.UNDEFINED) return undefined;
    if (value.startsWith("\x00\x00")) return value.slice(2);
    if (value.startsWith(TYPE_MARKERS.DATE)) return new Date(value.slice(2));
    if (value.startsWith(TYPE_MARKERS.URL)) return new URL(value.slice(2));
    if (value.startsWith(TYPE_MARKERS.REGEXP)) {
      const str = value.slice(2);
      const match = str.match(/^\/(.*)\/([gimsuy]*)$/);
      return match ? new RegExp(match[1], match[2]) : str;
    }
    if (value.startsWith(TYPE_MARKERS.BIGINT)) return BigInt(value.slice(2));
    if (value.startsWith(TYPE_MARKERS.SYMBOL)) return Symbol(value.slice(2));
    if (value.startsWith(TYPE_MARKERS.REF)) {
      return ctx.refs[parseInt(value.slice(2), 10)];
    }
    return value;
  }

  if (typeof value === "boolean" || typeof value === "number") {
    return value;
  }

  if (Array.isArray(value)) {
    const marker = value[0];

    if (marker === TYPE_MARKERS.ERROR) {
      const [, name, message, stack] = value as [string, string, string, string];
      const error = new Error(message);
      error.name = name;
      if (stack) error.stack = stack;
      ctx.refs.push(error);
      return error;
    }

    if (marker === TYPE_MARKERS.MAP) {
      const map = new Map();
      ctx.refs.push(map);
      for (let i = 1; i < value.length; i++) {
        const [key, nested] = value[i] as [unknown, unknown];
        map.set(deserialize(key, ctx), deserialize(nested, ctx));
      }
      return map;
    }

    if (marker === TYPE_MARKERS.SET) {
      const set = new Set();
      ctx.refs.push(set);
      for (let i = 1; i < value.length; i++) {
        set.add(deserialize(value[i], ctx));
      }
      return set;
    }

    const arr: unknown[] = [];
    ctx.refs.push(arr);
    for (const item of value) {
      arr.push(deserialize(item, ctx));
    }
    return arr;
  }

  if (typeof value === "object") {
    const obj: Record<string, unknown> = {};
    ctx.refs.push(obj);
    for (const [key, nested] of Object.entries(value)) {
      obj[key] = deserialize(nested, ctx);
    }
    return obj;
  }

  return value;
}

export function isSerializable(value: unknown): boolean {
  if (value === null || value === undefined) return true;

  const type = typeof value;
  if (type === "boolean" || type === "number" || type === "string" || type === "bigint") {
    return true;
  }

  if (type === "function" || type === "symbol") {
    return false;
  }

  if (value instanceof Date || value instanceof URL || value instanceof RegExp) {
    return true;
  }

  if (value instanceof Map || value instanceof Set) {
    return true;
  }

  if (Array.isArray(value)) {
    return value.every(isSerializable);
  }

  if (type === "object") {
    return Object.values(value as object).every(isSerializable);
  }

  return false;
}
