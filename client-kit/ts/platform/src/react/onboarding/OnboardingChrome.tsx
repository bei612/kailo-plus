// Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src/features/onboarding/ui/OnboardingChrome.tsx (OnboardingChrome and the CTA classes
// the profile and avatar steps use). DD-125(5): only the profile and avatar positions remain in
// Kailo, so the step dots count those two (identity/harness/config/community/meet-the-team are
// excluded by DD-75/78/79, DD-26 and the Welcome exclusion).
import { BuzzMark } from "../projects/buzz-logo/BuzzMark";

/** Shared pill shape (38px tall) for every onboarding primary CTA. */
const ONBOARDING_CTA_SHAPE = "h-[2.375rem] rounded-full px-6";

/**
 * Primary-CTA styling for the in-step onboarding pages: the shared pill with a
 * light-blue label (`--buzz-onboarding-cta-label`, available on any
 * `.buzz-onboarding-neutral-theme` subtree).
 */
export const ONBOARDING_PRIMARY_CTA_CLASS = `${ONBOARDING_CTA_SHAPE} text-[var(--buzz-onboarding-cta-label)]`;

/** Shared quiet pill for secondary actions throughout onboarding. */
export const ONBOARDING_SECONDARY_CTA_CLASS =
  "h-9 rounded-full bg-foreground/10 px-6 text-foreground hover:bg-foreground/15 hover:text-foreground";

/**
 * Shared onboarding chrome shown on every page after the landing screen: a
 * static Buzz mark pinned to the top-left, and a centered pagination track that
 * sits above the page title. The active page reads as a longer bar; inactive
 * pages are dots.
 */
export function OnboardingChrome({
  current,
  total,
}: {
  current: number;
  total: number;
}) {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 top-12 z-10 flex items-center px-6 text-foreground"
    >
      <span className="block w-11" data-testid="onboarding-logo">
        <BuzzMark className="h-auto w-full" />
      </span>
      <div
        className="absolute left-1/2 top-1/2 -mt-3 flex -translate-x-1/2 -translate-y-1/2 items-center gap-2"
        data-testid="onboarding-step-dots"
      >
        {Array.from({ length: total }, (_, i) => i + 1).map((position) => (
          <span
            className={
              position === current
                ? "block h-1.5 w-7 rounded-full bg-foreground"
                : "block h-1.5 w-1.5 rounded-full bg-foreground/30"
            }
            key={position}
          />
        ))}
      </div>
    </div>
  );
}
