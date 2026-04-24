import { Context } from "effect";
import type { Effect, Scope } from "effect";

export interface PresenceObservationServiceShape {
  readonly start: () => Effect.Effect<void, never, Scope.Scope>;
}

export class PresenceObservationService extends Context.Service<
  PresenceObservationService,
  PresenceObservationServiceShape
>()("t3/presence/Services/PresenceObservationService") {}
