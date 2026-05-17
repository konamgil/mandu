/**
 * Resource Slot Generator
 * Generate slot templates for resource endpoints
 */

import type { ResourceDefinition } from "../schema";
import { getPluralName, getEnabledEndpoints } from "../schema";

/**
 * Generate slot file for resource
 * IMPORTANT: This should only be generated ONCE - never overwrite existing slots!
 *
 * @returns Slot file content
 */
export function generateResourceSlot(definition: ResourceDefinition): string {
  const resourceName = definition.name;
  const pascalName = toPascalCase(resourceName);
  const pluralName = getPluralName(definition);
  const endpoints = getEnabledEndpoints(definition);

  // Generate endpoint handlers
  const handlers = generateHandlers(definition, endpoints, pascalName, pluralName);

  return `// 🥟 Mandu Filling - ${resourceName} Resource
// Pattern: /api/${pluralName}
// 이 파일에서 비즈니스 로직을 구현하세요.

import { Mandu } from "@mandujs/core";
import contract from "../contracts/${resourceName}.contract";

export default Mandu.filling()
${handlers}

// 💡 Contract 기반 사용법:
// ctx.input(contract, "GET")  - Contract로 요청 검증 + 정규화
// ctx.output(contract, 200, data) - Contract로 응답 검증
// ctx.okContract(contract, data)  - 200 OK (Contract 검증)
// ctx.createdContract(contract, data) - 201 Created (Contract 검증)
//
// 💡 데이터베이스 연동 예시:
// const { data } = await db.select().from(${pluralName}).where(eq(${pluralName}.id, id));
// return ctx.output(contract, 200, { data });
`;
}

/**
 * Generate handlers for enabled endpoints
 */
function generateHandlers(
  definition: ResourceDefinition,
  endpoints: string[],
  pascalName: string,
  pluralName: string
): string {
  const handlers: string[] = [];

  if (endpoints.includes("list")) {
    handlers.push(generateListHandler(pascalName, pluralName));
  }

  if (endpoints.includes("get")) {
    handlers.push(generateGetHandler(pascalName, pluralName));
  }

  if (endpoints.includes("create")) {
    handlers.push(generateCreateHandler(pascalName, pluralName));
  }

  if (endpoints.includes("update")) {
    handlers.push(generateUpdateHandler(pascalName, pluralName));
  }

  if (endpoints.includes("delete")) {
    handlers.push(generateDeleteHandler(pascalName, pluralName));
  }

  return handlers.join("\n\n");
}

/**
 * Generate LIST handler (GET /api/resources)
 */
function generateListHandler(pascalName: string, pluralName: string): string {
  return `  // 📋 List ${pascalName}s
  .get(async (ctx) => {
    const input = await ctx.input(contract, "GET", ctx.params);
    const { page, limit } = input;

    // TODO: Implement database query
    // const offset = (page - 1) * limit;
    // const items = await db.select().from(${pluralName}).limit(limit).offset(offset);
    // const total = await db.select({ count: count() }).from(${pluralName});

    const mockData = {
      data: [], // Replace with actual data
      pagination: {
        page,
        limit,
        total: 0,
      },
    };

    return ctx.output(contract, 200, mockData);
  })`;
}

/**
 * Generate GET handler (GET /api/resources/:id)
 */
function generateGetHandler(pascalName: string, pluralName: string): string {
  return `  // 📄 Get Single ${pascalName}
  .get(async (ctx) => {
    const { id } = ctx.params;

    // TODO: Implement database query
    // const item = await db.select().from(${pluralName}).where(eq(${pluralName}.id, id)).limit(1);
    // if (!item) return ctx.notFound("${pascalName} not found");

    const mockData = {
      data: { id, message: "${pascalName} details" }, // Replace with actual data
    };

    return ctx.output(contract, 200, mockData);
  })`;
}

/**
 * Generate CREATE handler (POST /api/resources)
 */
function generateCreateHandler(pascalName: string, pluralName: string): string {
  return `  // ➕ Create ${pascalName}
  .post(async (ctx) => {
    const input = await ctx.input(contract, "POST", ctx.params);

    // TODO: Implement database insertion
    // const [created] = await db.insert(${pluralName}).values(input).returning();

    const mockData = {
      data: { id: "new-id", ...input }, // Replace with actual created data
    };

    return ctx.output(contract, 201, mockData);
  })`;
}

/**
 * Generate UPDATE handler (PUT /api/resources/:id)
 */
function generateUpdateHandler(pascalName: string, pluralName: string): string {
  return `  // ✏️ Update ${pascalName}
  .put(async (ctx) => {
    const { id } = ctx.params;
    const input = await ctx.input(contract, "PUT", ctx.params);

    // TODO: Implement database update
    // const [updated] = await db.update(${pluralName})
    //   .set(input)
    //   .where(eq(${pluralName}.id, id))
    //   .returning();
    // if (!updated) return ctx.notFound("${pascalName} not found");

    const mockData = {
      data: { id, ...input }, // Replace with actual updated data
    };

    return ctx.output(contract, 200, mockData);
  })`;
}

/**
 * Generate DELETE handler (DELETE /api/resources/:id)
 */
function generateDeleteHandler(pascalName: string, pluralName: string): string {
  return `  // 🗑️ Delete ${pascalName}
  .delete(async (ctx) => {
    const { id } = ctx.params;

    // TODO: Implement database deletion
    // const deleted = await db.delete(${pluralName}).where(eq(${pluralName}.id, id));
    // if (!deleted) return ctx.notFound("${pascalName} not found");

    return ctx.output(contract, 200, { data: { message: "${pascalName} deleted" } });
  })`;
}

/**
 * Convert string to PascalCase
 */
function toPascalCase(str: string): string {
  return str
    .split(/[-_]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}
