// Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src/features/onboarding/ui/ProfileStep.tsx::ProfileStep. DD-125(5): the community
// profile name step, shown with the existing identity ("Continue"); the original identity
// creation label and "I already have a key" import belong to the excluded identity pages
// (DD-75/78/79). A save failure shows the plain original error banner; the browser has no
// direct relay connection whose reconnect card could apply.
import * as React from "react";

import { useUiT } from "../context";
import { cn } from "../profile/buzz/shared/lib/cn";
import { Button } from "../profile/buzz/shared/ui/button";
import { Spinner } from "../profile/buzz/shared/ui/spinner";
import { ONBOARDING_PRIMARY_CTA_CLASS } from "./OnboardingChrome";
import { useOnboardingCardLayout } from "./OnboardingCard";
import { OnboardingFooter } from "./OnboardingFooter";
import { OnboardingInput } from "./OnboardingInput";
import {
  type OnboardingTransitionDirection,
  type OnboardingTransitionEffect,
  OnboardingSlideTransition,
} from "./OnboardingSlideTransition";
import type { ProfileStepActions, ProfileStepState } from "./types";

type ProfileStepProps = {
  actions: ProfileStepActions;
  direction: OnboardingTransitionDirection;
  transitionEffect?: OnboardingTransitionEffect;
  state: ProfileStepState;
};

function ErrorBanner({ message }: { message: string | null }) {
  if (!message) {
    return null;
  }

  return (
    <p
      className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
      role="alert"
    >
      {message}
    </p>
  );
}

export function ProfileStep({
  actions,
  direction,
  transitionEffect = "line-slide",
  state,
}: ProfileStepProps) {
  const t = useUiT();
  const {
    advanceWithoutSaving,
    back,
    skipForNow,
    submit,
    updateDisplayName,
  } = actions;
  const { isReadyToSubmit, isSaving, name, saveRecovery } = state;
  const displayNameDraft = name.draftValue;
  const hasDisplayNameDraft = displayNameDraft.length > 0;
  const canSubmit =
    displayNameDraft.trim().length > 0 && isReadyToSubmit && !isSaving;
  const cardLayout = useOnboardingCardLayout();
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  React.useLayoutEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <OnboardingSlideTransition
      className={cn(
        "flex w-full flex-col",
        cardLayout ? "items-stretch text-left" : "items-center text-center",
      )}
      data-testid="onboarding-page-1"
      direction={direction}
      effect={transitionEffect}
      transitionKey={`profile-${direction}`}
    >
      <div className="w-full max-w-2xl">
        <h1 className="text-title font-normal text-foreground">
          {t("onboarding.profile.title")}
        </h1>
        <p className="mt-5 text-sm leading-6 text-muted-foreground">
          {t("onboarding.profile.body")}
        </p>
      </div>

      {cardLayout ? (
        <label
          className="mt-8 block w-full text-sm font-medium text-foreground"
          htmlFor="onboarding-display-name"
        >
          <span className="mb-2 block">{t("onboarding.profile.nameLabel")}</span>
          <OnboardingInput
            aria-label={t("onboarding.profile.nameLabel")}
            autoCapitalize="none"
            autoComplete="off"
            autoCorrect="off"
            data-testid="onboarding-display-name"
            disabled={isSaving}
            id="onboarding-display-name"
            onChange={(event) => updateDisplayName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && canSubmit) {
                event.preventDefault();
                submit();
              }
            }}
            placeholder={t("onboarding.profile.namePlaceholder")}
            ref={inputRef}
            spellCheck={false}
            value={displayNameDraft}
          />
        </label>
      ) : (
        <label
          className="mt-12 flex w-full cursor-text flex-col items-center"
          htmlFor="onboarding-display-name"
        >
          <span className="sr-only">{t("onboarding.profile.nameLabel")}</span>
          <div className="relative h-20 w-full max-w-[576px]">
            {!hasDisplayNameDraft ? (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 flex select-none items-center justify-center"
              >
                <span className="relative inline-flex select-none items-center gap-0 text-4xl font-semibold text-muted-foreground/35 sm:text-5xl">
                  <span
                    aria-hidden="true"
                    className="buzz-onboarding-name-placeholder-caret h-[0.9em] w-0.5 rounded-full bg-primary"
                  />
                  {t("onboarding.profile.namePlaceholder")}
                </span>
              </div>
            ) : null}
            <input
              aria-label={t("onboarding.profile.nameLabel")}
              autoCapitalize="none"
              autoComplete="off"
              autoCorrect="off"
              className={cn(
                "h-full w-full border-0 bg-transparent px-0 py-0 text-center text-4xl font-semibold text-foreground shadow-none outline-none caret-foreground disabled:cursor-not-allowed disabled:opacity-50 sm:text-5xl",
                !hasDisplayNameDraft && "text-transparent caret-transparent",
              )}
              data-testid="onboarding-display-name"
              disabled={isSaving}
              id="onboarding-display-name"
              onChange={(event) => updateDisplayName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && canSubmit) {
                  event.preventDefault();
                  submit();
                }
              }}
              ref={inputRef}
              spellCheck={false}
              value={displayNameDraft}
            />
          </div>
        </label>
      )}

      {saveRecovery.errorMessage ? (
        <ErrorBanner message={saveRecovery.errorMessage} />
      ) : null}

      <OnboardingFooter>
        <Button
          className={ONBOARDING_PRIMARY_CTA_CLASS}
          data-testid="onboarding-next"
          disabled={!canSubmit}
          onClick={submit}
          type="button"
        >
          {isSaving ? (
            <Spinner aria-label={t("onboarding.savingProfile")} className="h-4 w-4 border-2" />
          ) : (
            t("onboarding.continue")
          )}
        </Button>

        {back ? (
          <Button
            className="h-10 w-full text-muted-foreground hover:text-accent-foreground"
            data-testid="onboarding-back"
            disabled={isSaving}
            onClick={back}
            type="button"
            variant="ghost"
          >
            {t("onboarding.back")}
          </Button>
        ) : null}

        {saveRecovery.canSkipForNow || saveRecovery.canAdvanceWithoutSaving ? (
          <div className="flex min-h-8 items-center gap-2">
            <div className="flex-1" />
            {saveRecovery.canSkipForNow ? (
              <Button
                className="text-muted-foreground hover:text-accent-foreground"
                data-testid="onboarding-skip"
                onClick={skipForNow}
                type="button"
                variant="ghost"
              >
                {t("onboarding.skipForNow")}
              </Button>
            ) : null}
            {saveRecovery.canAdvanceWithoutSaving ? (
              <Button
                className="text-muted-foreground hover:text-accent-foreground"
                data-testid="onboarding-next-without-saving"
                onClick={advanceWithoutSaving}
                type="button"
                variant="ghost"
              >
                {t("onboarding.continueWithoutSaving")}
              </Button>
            ) : null}
            <div className="flex-1" />
          </div>
        ) : null}
      </OnboardingFooter>
    </OnboardingSlideTransition>
  );
}
