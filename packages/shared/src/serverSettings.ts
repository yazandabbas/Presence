import { ServerSettings, type ServerSettingsPatch } from "@t3tools/contracts";
import { Schema } from "effect";
import { deepMerge } from "./Struct.ts";
import { fromLenientJson } from "./schemaJson.ts";
import { createModelSelection } from "./model.ts";

const ServerSettingsJson = fromLenientJson(ServerSettings);

export interface PersistedServerObservabilitySettings {
  readonly otlpTracesUrl: string | undefined;
  readonly otlpMetricsUrl: string | undefined;
}

export function normalizePersistedServerSettingString(
  value: string | null | undefined,
): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

export function extractPersistedServerObservabilitySettings(input: {
  readonly observability?: {
    readonly otlpTracesUrl?: string;
    readonly otlpMetricsUrl?: string;
  };
}): PersistedServerObservabilitySettings {
  return {
    otlpTracesUrl: normalizePersistedServerSettingString(input.observability?.otlpTracesUrl),
    otlpMetricsUrl: normalizePersistedServerSettingString(input.observability?.otlpMetricsUrl),
  };
}

export function parsePersistedServerObservabilitySettings(
  raw: string,
): PersistedServerObservabilitySettings {
  try {
    const decoded = Schema.decodeUnknownSync(ServerSettingsJson)(raw);
    return extractPersistedServerObservabilitySettings(decoded);
  } catch {
    return { otlpTracesUrl: undefined, otlpMetricsUrl: undefined };
  }
}

function shouldReplaceTextGenerationModelSelection(
  patch: ServerSettingsPatch["textGenerationModelSelection"] | undefined,
): boolean {
  return Boolean(patch && (patch.provider !== undefined || patch.model !== undefined));
}

function shouldReplacePresenceModelSelection(
  patch: ServerSettingsPatch["presence"] | undefined,
): boolean {
  return patch?.modelSelection !== undefined;
}

function mergeModelSelectionOptionsById(input: {
  current: ReadonlyArray<{ readonly id: string; readonly value: string | boolean }> | undefined;
  patch: ReadonlyArray<{ readonly id: string; readonly value: string | boolean }> | undefined;
}): Array<{ id: string; value: string | boolean }> | undefined {
  if (input.patch === undefined) {
    return input.current ? [...input.current] : undefined;
  }
  if (input.patch.length === 0) {
    return undefined;
  }

  const merged = new Map((input.current ?? []).map((selection) => [selection.id, selection.value]));
  for (const selection of input.patch) {
    merged.set(selection.id, selection.value);
  }
  return [...merged.entries()].map(([id, value]) => ({ id, value }));
}

function applyModelSelectionPatch(
  current: ServerSettings["textGenerationModelSelection"],
  patch: NonNullable<ServerSettingsPatch["textGenerationModelSelection"]>,
): ServerSettings["textGenerationModelSelection"] {
  const provider = patch.provider ?? current.provider;
  const model = patch.model ?? current.model;
  const options = shouldReplaceTextGenerationModelSelection(patch)
    ? patch.options
    : mergeModelSelectionOptionsById({
        current: current.options,
        patch: patch.options,
      });

  return createModelSelection(provider, model, options);
}

/**
 * Applies a server settings patch while treating textGenerationModelSelection as
 * replace-on-provider/model updates. This prevents stale nested options from
 * surviving a reset patch that intentionally omits options.
 */
export function applyServerSettingsPatch(
  current: ServerSettings,
  patch: ServerSettingsPatch,
): ServerSettings {
  const selectionPatch = patch.textGenerationModelSelection;
  const presenceSelectionPatch = patch.presence?.modelSelection;
  let next = deepMerge(current, patch);

  if (selectionPatch) {
    next = {
      ...next,
      textGenerationModelSelection: applyModelSelectionPatch(
        current.textGenerationModelSelection,
        selectionPatch,
      ),
    };
  }

  if (shouldReplacePresenceModelSelection(patch.presence)) {
    next = {
      ...next,
      presence: {
        ...next.presence,
        modelSelection:
          presenceSelectionPatch === null
            ? null
            : applyModelSelectionPatch(
                current.presence.modelSelection ?? current.textGenerationModelSelection,
                presenceSelectionPatch!,
              ),
      },
    };
  }

  return next;
}
