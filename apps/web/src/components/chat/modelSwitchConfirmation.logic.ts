/**
 * Pure model-switch confirmation decision helper (issue #55, web half).
 *
 * Freebuff runs one free-session seat per account: switching models on a live
 * session requires releasing it first. Since #60 the server half handles the
 * release on stop, so a confirmed switch = apply selection + stop the thread
 * session; the next turn re-admits on the new model. Cancel leaves everything
 * untouched.
 *
 * Kept pure so the wire/UX decision is testable without React or dialogs.
 *
 * @module components/chat/modelSwitchConfirmation
 */

interface ModelRow {
  readonly slug: string;
  readonly name: string;
}

interface ModelSwitchConfirmationInput {
  readonly hasStartedSession: boolean;
  readonly driver: string | null;
  readonly currentModel: string | undefined;
  readonly nextModel: string;
  readonly models: ReadonlyArray<ModelRow> | undefined;
}

export type ModelSwitchConfirmationDecision =
  | { readonly action: "proceed" }
  | { readonly action: "cancel" }
  | { readonly action: "confirm"; readonly message: string };

export function resolveModelSwitchConfirmation(
  input: ModelSwitchConfirmationInput,
): ModelSwitchConfirmationDecision {
  const { hasStartedSession, driver, currentModel, nextModel, models } = input;

  if (!hasStartedSession || driver !== "freebuff") {
    return { action: "proceed" };
  }

  if (currentModel !== undefined && currentModel === nextModel) {
    // No-op: releasing the seat to re-admit the same model burns an
    // admission for nothing.
    return { action: "cancel" };
  }

  const displayName = (slug: string): string => {
    const row = models?.find((candidate) => candidate.slug === slug);
    return row?.name ?? slug;
  };

  const from = currentModel === undefined ? "the current model" : displayName(currentModel);
  const to = displayName(nextModel);

  return {
    action: "confirm",
    message: `Switching from ${from} to ${to} stops the current free session so the next message runs on ${to}. Continue?`,
  };
}
