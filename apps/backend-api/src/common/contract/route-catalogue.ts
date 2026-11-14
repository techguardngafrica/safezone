import { HTTP_CODE_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod, type Type } from '@nestjs/common';
import type { ModulesContainer } from '@nestjs/core';
import {
  ACCESS_KEY,
  type AccessRule,
  ALLOW_MFA_PENDING_KEY,
  FEATURE_KEY,
} from '../auth/auth.decorators';
import { PUBLIC_KEY } from '../auth/public.decorator';
import { CONTRACT_KEY, type RouteContract } from './contract';

export interface RouteInfo {
  controller: string;
  handler: string;
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  /** OpenAPI style: /v1/estates/{estateId}/files/{id} */
  path: string;
  /** Express style: /v1/estates/:estateId/files/:id */
  expressPath: string;
  contract: RouteContract | undefined;
  access: { kind: 'public' } | AccessRule | undefined;
  allowMfaPending: boolean;
  feature: string | undefined;
  statusCode: number;
}

const METHODS: Partial<Record<RequestMethod, RouteInfo['method']>> = {
  [RequestMethod.GET]: 'get',
  [RequestMethod.POST]: 'post',
  [RequestMethod.PUT]: 'put',
  [RequestMethod.PATCH]: 'patch',
  [RequestMethod.DELETE]: 'delete',
};

function joinPath(...parts: (string | undefined)[]): string {
  const joined = parts
    .flatMap((part) => (part ?? '').split('/'))
    .filter((segment) => segment !== '')
    .join('/');
  return `/${joined}`;
}

/** Every HTTP route of the controllers registered in an application, with its declarations. */
export function collectRoutes(modules: ModulesContainer): RouteInfo[] {
  const routes: RouteInfo[] = [];
  const seen = new Set<Type>();
  for (const module of modules.values()) {
    for (const wrapper of module.controllers.values()) {
      const controller = wrapper.metatype as Type | null;
      if (!controller || seen.has(controller)) continue;
      seen.add(controller);
      const basePath = Reflect.getMetadata(PATH_METADATA, controller) as string | undefined;
      const classPublic = Reflect.getMetadata(PUBLIC_KEY, controller) === true;
      const prototype = controller.prototype as object;
      for (const name of Object.getOwnPropertyNames(prototype)) {
        // Read descriptors, not values: getters on the prototype must not run here.
        const handler: unknown = Object.getOwnPropertyDescriptor(prototype, name)?.value;
        if (name === 'constructor' || typeof handler !== 'function') continue;
        const requestMethod = Reflect.getMetadata(METHOD_METADATA, handler) as
          RequestMethod | undefined;
        const methodPath = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined;
        if (requestMethod === undefined || methodPath === undefined) continue;
        const method = METHODS[requestMethod];
        if (!method) continue;
        const expressPath = joinPath(basePath, methodPath);
        const isPublic = classPublic || Reflect.getMetadata(PUBLIC_KEY, handler) === true;
        const rule = Reflect.getMetadata(ACCESS_KEY, handler) as AccessRule | undefined;
        const contract = Reflect.getMetadata(CONTRACT_KEY, handler) as RouteContract | undefined;
        const statusCode =
          (Reflect.getMetadata(HTTP_CODE_METADATA, handler) as number | undefined) ??
          (method === 'post' ? 201 : 200);
        routes.push({
          controller: controller.name,
          handler: name,
          method,
          path: expressPath.replace(/:(\w+)/g, '{$1}'),
          expressPath,
          contract,
          access: isPublic ? { kind: 'public' } : rule,
          allowMfaPending: Reflect.getMetadata(ALLOW_MFA_PENDING_KEY, handler) === true,
          feature: Reflect.getMetadata(FEATURE_KEY, handler) as string | undefined,
          statusCode,
        });
      }
    }
  }
  return routes.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}
