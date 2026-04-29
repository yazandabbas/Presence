import type { ProviderKind, ServerProvider } from "@t3tools/contracts";

export interface PresenceHarnessReadiness {
  readonly readyProviders: readonly ServerProvider[];
  readonly selectedProviderUnavailable: boolean;
}

export function isReadyPresenceHarnessProvider(provider: ServerProvider): boolean {
  return (
    provider.enabled &&
    provider.installed &&
    provider.status === "ready" &&
    provider.auth.status !== "unauthenticated" &&
    provider.models.length > 0
  );
}

export function resolvePresenceHarnessReadiness(
  providers: readonly ServerProvider[],
  selectedProvider: ProviderKind | null | undefined,
): PresenceHarnessReadiness {
  const readyProviders = providers.filter(isReadyPresenceHarnessProvider);
  return {
    readyProviders,
    selectedProviderUnavailable: selectedProvider
      ? !readyProviders.some((provider) => provider.provider === selectedProvider)
      : false,
  };
}
