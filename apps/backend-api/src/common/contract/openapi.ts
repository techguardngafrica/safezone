import { z } from 'zod';
import type { RouteInfo } from './route-catalogue';

type JsonSchema = Record<string, unknown>;

function toJsonSchema(schema: z.ZodType, io: 'input' | 'output'): JsonSchema {
  const { $schema: _drop, ...rest } = z.toJSONSchema(schema, {
    io,
    unrepresentable: 'any',
    target: 'draft-2020-12',
  }) as JsonSchema;
  return rest;
}

const ERROR_STATUS_TEXT: Record<number, string> = {
  400: 'Validation failed',
  401: 'Not signed in or session ended',
  403: 'Not permitted (or two-step verification required)',
  404: 'Not found in your scope',
  409: 'Conflict with the current state',
  412: 'Version mismatch (If-Match)',
  422: 'Business rule violation',
  429: 'Too many requests (see Retry-After)',
  500: 'Unexpected error',
  503: 'Temporarily unavailable',
};

function operationId(route: RouteInfo): string {
  const controller = route.controller.replace(/Controller$/, '');
  return `${controller.charAt(0).toLowerCase()}${controller.slice(1)}_${route.handler}`;
}

function parameters(schema: z.ZodType | undefined, location: 'path' | 'query'): JsonSchema[] {
  if (!schema) return [];
  const json = toJsonSchema(schema, 'input');
  const properties = (json.properties ?? {}) as Record<string, JsonSchema>;
  const required = new Set((json.required as string[] | undefined) ?? []);
  return Object.entries(properties).map(([name, property]) => ({
    name,
    in: location,
    required: location === 'path' ? true : required.has(name),
    schema: property,
    ...(typeof property.description === 'string' ? { description: property.description } : {}),
  }));
}

/**
 * Builds the OpenAPI 3.1 document from route contracts (AGENTS.md §5.6: generated from code, never edited
 * by hand). Every response is shown inside the standard envelope.
 */
export function buildOpenApiDocument(routes: readonly RouteInfo[], version: string): JsonSchema {
  const paths: Record<string, Record<string, JsonSchema>> = {};
  for (const route of routes) {
    const contract = route.contract;
    if (!contract)
      throw new Error(`Route ${route.method.toUpperCase()} ${route.expressPath} has no @Contract`);
    const access = route.access;
    if (!access)
      throw new Error(
        `Route ${route.method.toUpperCase()} ${route.expressPath} has no access declaration`,
      );

    const status = contract.status ?? route.statusCode;
    const dataSchema = contract.response
      ? contract.paginated
        ? { type: 'array', items: toJsonSchema(contract.response, 'output') }
        : toJsonSchema(contract.response, 'output')
      : { type: 'null' };
    const successBody = {
      type: 'object',
      required: ['success', 'data'],
      properties: {
        success: { const: true },
        data: dataSchema,
        ...(contract.paginated ? { meta: { $ref: '#/components/schemas/PageMeta' } } : {}),
      },
    };

    const errorStatuses = new Set<number>([400, 500, ...(contract.errors ?? [])]);
    if (access.kind !== 'public') {
      errorStatuses.add(401);
      errorStatuses.add(403);
    }
    if (route.expressPath.includes(':estateId')) errorStatuses.add(404);

    const responses: Record<string, JsonSchema> = {
      [String(status)]:
        status === 204
          ? { description: 'No content' }
          : { description: 'Success', content: { 'application/json': { schema: successBody } } },
    };
    for (const code of [...errorStatuses].sort()) {
      responses[String(code)] = { $ref: `#/components/responses/Error${code}` };
    }

    const accessText =
      access.kind === 'public'
        ? 'Public.'
        : access.kind === 'signed_in'
          ? 'Any signed-in user.'
          : access.kind === 'member'
            ? 'Any active member of the estate.'
            : `Requires \`${access.permission}\`.`;

    (paths[route.path] ??= {})[route.method] = {
      operationId: operationId(route),
      summary: contract.summary,
      description: `${accessText}${route.allowMfaPending ? ' Allowed before two-step verification.' : ''}${route.feature ? ` Needs the \`${route.feature}\` feature.` : ''}`,
      tags: [...(contract.tags ?? [])],
      'x-safezone-access': access,
      ...(access.kind === 'public' ? { security: [] } : {}),
      parameters: [...parameters(contract.params, 'path'), ...parameters(contract.query, 'query')],
      ...(contract.body
        ? {
            requestBody: {
              required: true,
              content: { 'application/json': { schema: toJsonSchema(contract.body, 'input') } },
            },
          }
        : {}),
      responses,
    };
  }

  const errorResponses = Object.fromEntries(
    Object.entries(ERROR_STATUS_TEXT).map(([code, description]) => [
      `Error${code}`,
      {
        description,
        content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } },
      },
    ]),
  );

  return {
    openapi: '3.1.0',
    info: {
      title: 'Safezone API',
      version,
      description:
        'Generated from apps/backend-api route contracts (pnpm --filter @safezone/backend-api openapi). Do not edit by hand.',
    },
    servers: [{ url: 'http://localhost:4000', description: 'Local' }],
    security: [{ bearerAuth: [] }],
    paths,
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
      schemas: {
        ApiError: {
          type: 'object',
          required: ['success', 'error'],
          properties: {
            success: { const: false },
            error: {
              type: 'object',
              required: ['code', 'message', 'statusCode'],
              properties: {
                code: { type: 'string' },
                message: { type: 'string' },
                statusCode: { type: 'integer' },
                requestId: { type: 'string' },
                details: {
                  type: 'array',
                  items: {
                    type: 'object',
                    required: ['path', 'message'],
                    properties: { path: { type: 'string' }, message: { type: 'string' } },
                  },
                },
              },
            },
          },
        },
        PageMeta: {
          type: 'object',
          required: ['nextCursor'],
          properties: { nextCursor: { type: ['string', 'null'] } },
        },
      },
      responses: errorResponses,
    },
  };
}
