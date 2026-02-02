/**
 * Mandu Client-safe Contract Utilities
 * Reduce contract exposure for client usage (forms, UI validation)
 */

import type {
  ContractSchema,
  ContractMethod,
  MethodRequestSchema,
  ClientSafeOptions,
  ContractRequestSchema,
  ContractResponseSchema,
} from "./schema";

const ERROR_STATUS_CODES = [400, 401, 403, 404, 500] as const;

function normalizeResponseSelection(
  selection: ClientSafeOptions["response"]
): number[] {
  if (!selection) return [];
  if (Array.isArray(selection)) return selection;

  const result: number[] = [];
  for (const [code, enabled] of Object.entries(selection)) {
    if (enabled) {
      const num = Number(code);
      if (!Number.isNaN(num)) {
        result.push(num);
      }
    }
  }
  return result;
}

function pickRequestSchema(
  methodSchema: MethodRequestSchema,
  selection: NonNullable<ClientSafeOptions["request"]>[ContractMethod]
): MethodRequestSchema | undefined {
  if (!selection) return undefined;

  const picked: MethodRequestSchema = {};

  if (selection.query && methodSchema.query) {
    picked.query = methodSchema.query;
  }
  if (selection.body && methodSchema.body) {
    picked.body = methodSchema.body;
  }
  if (selection.params && methodSchema.params) {
    picked.params = methodSchema.params;
  }
  if (selection.headers && methodSchema.headers) {
    picked.headers = methodSchema.headers;
  }

  return Object.keys(picked).length > 0 ? picked : undefined;
}

/**
 * Create a client-safe contract by selecting exposed schemas.
 * If options are omitted and contract.clientSafe is not defined,
 * the original contract is returned (with a warning).
 */
export function createClientContract<T extends ContractSchema>(
  contract: T,
  options?: ClientSafeOptions
): ContractSchema {
  const resolved = options ?? contract.clientSafe;

  if (!resolved) {
    console.warn(
      "[Mandu] clientContract: no clientSafe options provided. Returning original contract."
    );
    return contract;
  }

  const requestSelection = resolved.request ?? {};
  const responseSelection = normalizeResponseSelection(resolved.response);
  const safeRequest: ContractRequestSchema = {};
  const safeResponse: ContractResponseSchema = {};

  for (const method of Object.keys(requestSelection) as ContractMethod[]) {
    const methodSchema = contract.request[method] as MethodRequestSchema | undefined;
    if (!methodSchema) continue;

    const picked = pickRequestSchema(methodSchema, requestSelection[method]);
    if (picked) {
      safeRequest[method] = picked;
    }
  }

  const allowedResponses = new Set(responseSelection);

  if (resolved.includeErrors) {
    for (const code of ERROR_STATUS_CODES) {
      if (contract.response[code]) {
        allowedResponses.add(code);
      }
    }
  }

  for (const code of allowedResponses) {
    const schema = contract.response[code];
    if (schema) {
      safeResponse[code] = schema;
    }
  }

  return {
    ...contract,
    request: safeRequest,
    response: safeResponse,
  };
}
