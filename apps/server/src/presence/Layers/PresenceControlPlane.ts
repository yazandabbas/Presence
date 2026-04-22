import { Layer } from "effect";

import { PresenceControlPlane } from "../Services/PresenceControlPlane.ts";
import { SupervisorPolicyLive } from "./SupervisorPolicy.ts";
import { makePresenceControlPlane } from "./internal/PresenceRuntime.ts";

export const PresenceControlPlaneLive = Layer.effect(
  PresenceControlPlane,
  makePresenceControlPlane,
).pipe(Layer.provideMerge(SupervisorPolicyLive));
