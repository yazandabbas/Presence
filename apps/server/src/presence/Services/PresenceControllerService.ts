import { Context } from "effect";
import type { Effect, Scope } from "effect";

export interface PresenceControllerServiceShape {
  readonly start: () => Effect.Effect<void, never, Scope.Scope>;
}

export class PresenceControllerService extends Context.Service<
  PresenceControllerService,
  PresenceControllerServiceShape
>()("t3/presence/Services/PresenceControllerService") {}
