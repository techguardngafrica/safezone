import { SetMetadata } from '@nestjs/common';

export const PUBLIC_KEY = 'safezone:public';

/** Marks a route as reachable without a signed-in user (AGENTS.md §5.3). Every other route needs auth. */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(PUBLIC_KEY, true);
