import type { paths } from '@safezone/contracts';

type SuccessBody<R> = R extends { 200: infer A } ? A : R extends { 201: infer B } ? B : never;

/** The `data` of an endpoint's success envelope, straight from the generated contract. */
export type ApiData<P extends keyof paths, M extends keyof paths[P]> = paths[P][M] extends {
  responses: infer R;
}
  ? SuccessBody<R> extends { content: { 'application/json': { data: infer D } } }
    ? D
    : never
  : never;

/** One row of a list endpoint. */
export type ApiRow<P extends keyof paths, M extends keyof paths[P]> =
  ApiData<P, M> extends readonly (infer T)[] ? T : never;
