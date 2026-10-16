// Fixed Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/projects/lib/projectBranchErrors.ts::projectBranchErrorMessage.
// DD-118: the BFF answers with contract reason codes instead of git/relay stderr, so the dialog
// copy maps the reason (REF_CONFLICT -> TARGET_STATE_CONFLICT, PUSH_REJECTED -> PUBLISH_REJECTED,
// RELAY_UNAVAILABLE -> DEPENDENCY_UNAVAILABLE). An UNKNOWN outcome is never shown as a failure.
import { ReasonCode } from "@client-kit/contracts";
import { translateCurrent as t } from "../../../i18n";
import { BffError, isOutcomeUnknown } from "../../../transport";

/** No answer, an UNKNOWN class or PUBLISH_RESULT_UNKNOWN: the push may have landed. */
export function isProjectBranchOutcomeUnknown(error: unknown): boolean {
  return isOutcomeUnknown(error) || (error instanceof BffError && error.reason === ReasonCode.PublishResultUnknown);
}

/** Map a thrown branch-operation error to user-facing dialog copy. */
export function projectBranchErrorMessage(error: unknown, fallback: string): string {
  if (isProjectBranchOutcomeUnknown(error)) return t("projects.branch.unknown");
  if (!(error instanceof BffError)) return fallback;
  switch (error.reason) {
    case ReasonCode.TargetNotFound:
      return t("projects.branch.error.notFound");
    case ReasonCode.TargetStateConflict:
      return t("projects.branch.error.conflict");
    case ReasonCode.PublishRejected:
      return t("projects.branch.error.rejected");
    case ReasonCode.PayloadTooLarge:
      return t("projects.branch.error.tooLarge");
    case ReasonCode.DependencyUnavailable:
      return t("projects.branch.error.unavailable");
    default:
      return fallback;
  }
}
