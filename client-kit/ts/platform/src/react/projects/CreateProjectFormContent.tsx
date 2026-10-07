// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/projects/ui/CreateProjectFormContent.tsx and
// CreateProjectFormSettings.tsx: shared original field/layout and listing controls.
// Template/team/persona consumers are separately recorded restoration gaps.
import { ArrowLeft, ChevronDown } from "lucide-react";
import * as React from "react";
import { WorkspaceVisibility } from "@client-kit/contracts";
import { useUiT } from "../context";
import { cn } from "../profile/buzz/shared/lib/cn";
import { Button } from "../profile/buzz/shared/ui/button";
import { ChooserDialogContent } from "../composer/shared/ui/chooser-dialog-content";
import { Input } from "../composer/shared/ui/input";
import { Textarea } from "../profile/buzz/shared/ui/textarea";
import { ChannelPermissionsSettings } from "../channel-permissions-settings";
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "../sidebar/dropdown-menu";
import { ProjectCreationPending, type CreateProjectInput } from "./createProject";
import { isOutcomeUnknown } from "../../transport";

const CREATE_FIELD_SHELL_CLASS = "rounded-xl border border-input bg-muted/40 transition-colors duration-150 ease-out hover:border-muted-foreground/40 focus-within:border-muted-foreground/50";
const CREATE_FIELD_CONTROL_CLASS = "border-0 bg-transparent text-muted-foreground/55 shadow-none outline-none ring-0 transition-colors duration-150 ease-out placeholder:text-muted-foreground/55 focus:bg-transparent focus:text-foreground focus:outline-hidden focus-visible:ring-0";
const CREATE_LABEL_OPTIONAL_CLASS = "ml-1 text-xs font-normal text-muted-foreground/50";

export function CreateProjectFormContent({ active, initialName = "", isCreating, frozen, onBack, onCreate, onCreated }: {
  active: boolean; initialName?: string; isCreating: boolean; frozen?: CreateProjectInput;
  onBack: () => void; onCreate: (input: CreateProjectInput) => Promise<void>; onCreated: () => void;
}) {
  const t = useUiT();
  const [name, setName] = React.useState(initialName);
  const [description, setDescription] = React.useState("");
  const [channelVisibility, setChannelVisibility] = React.useState(WorkspaceVisibility.Open);
  const [projectVisibility, setProjectVisibility] = React.useState<"listed" | "unlisted">("listed");
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [completed, setCompleted] = React.useState(false);
  const nameInputRef = React.useRef<HTMLInputElement>(null);
  const locked = isCreating || completed || frozen !== undefined;
  React.useEffect(() => {
    if (!active) return;
    setName(initialName); setDescription(""); setErrorMessage(null);
    const timer = globalThis.setTimeout(() => nameInputRef.current?.focus(), 50);
    return () => globalThis.clearTimeout(timer);
  }, [active, initialName]);
  const input = frozen ?? { name, description: description.trim() || undefined, channelVisibility, projectVisibility };
  const listingLabel = t(input.projectVisibility === "unlisted" ? "projects.unlisted" : "projects.listed");
  return <ChooserDialogContent className="max-w-lg" contentClassName="pt-3" data-testid="create-project-dialog"
    headerSubtitle={t("projects.create.description")}
    footer={<div className="flex w-full items-center justify-end gap-3"><Button data-testid="create-project-submit"
      disabled={isCreating || completed || input.name.trim().length === 0} form="create-project-form" type="submit">
      {t(isCreating ? "projects.create.busy" : frozen ? "projects.create.resume" : "projects.create.submit")}
    </Button></div>}
    footerClassName="border-t-0 pt-0" headerClassName="pb-2" title={t("projects.create.title")}>
    <Button className="mb-3 h-8 gap-1.5 px-2 text-muted-foreground" disabled={isCreating} onClick={onBack} size="sm" type="button" variant="ghost">
      <ArrowLeft className="h-4 w-4" />{t("projects.create.back")}
    </Button>
    <form className="space-y-5" id="create-project-form" onSubmit={event => {
      event.preventDefault(); setErrorMessage(null);
      if (isCreating || completed) return;
      void onCreate(input).then(() => {
        setCompleted(true);
        // Closing/navigation is not another creation attempt if it throws.
        try { onCreated(); } catch { setErrorMessage(t("projects.create.navigationFailed")); }
      }, error => setErrorMessage(t(error instanceof ProjectCreationPending || isOutcomeUnknown(error)
        ? "projects.create.unconfirmed" : "projects.create.failed")));
    }}>
      <div className="space-y-1.5"><label className="text-sm font-medium text-foreground" htmlFor="create-project-name">{t("projects.name")}</label>
        <div className={cn("flex min-h-11 items-center px-3", CREATE_FIELD_SHELL_CLASS)}><Input autoCapitalize="none" autoComplete="off" autoCorrect="off"
          className={cn("h-8 px-0 py-0 leading-6", CREATE_FIELD_CONTROL_CLASS)} data-testid="create-project-name" disabled={locked} id="create-project-name"
          onChange={event => { setName(event.target.value); setErrorMessage(null); }} placeholder={t("projects.create.namePlaceholder")}
          ref={nameInputRef} spellCheck={false} value={input.name} /></div>
      </div>
      <div className="space-y-1.5"><label className="text-sm font-medium text-foreground" htmlFor="create-project-description">
        {t("projects.create.about")}<span className={CREATE_LABEL_OPTIONAL_CLASS}>{t("channel.create.optional")}</span></label>
        <div className={CREATE_FIELD_SHELL_CLASS}><Textarea className={cn("min-h-20 resize-none px-3 py-3 leading-5", CREATE_FIELD_CONTROL_CLASS)}
          data-testid="create-project-description" disabled={locked} id="create-project-description" onChange={event => { setDescription(event.target.value); setErrorMessage(null); }}
          placeholder={t("projects.create.aboutPlaceholder")} rows={2} value={input.description ?? ""} /></div>
      </div>
      <ChannelPermissionsSettings disabled={locked} onVisibilityChange={setChannelVisibility} testIdPrefix="create-project-channel" visibility={input.channelVisibility} />
      <div className={cn("flex min-h-12 items-center justify-between gap-4 rounded-xl border border-input bg-background px-3 py-3", locked && "opacity-50")}>
        <span className="text-sm font-medium text-foreground">{t("projects.create.listing")}</span>
        <DropdownMenu modal={false}><DropdownMenuTrigger asChild><Button aria-label={`${t("projects.create.listing")}: ${listingLabel}`}
          className="-mr-2.5 ml-auto h-9 w-fit justify-end px-2.5 text-right text-sm font-medium text-foreground hover:bg-muted/50"
          data-testid="create-project-listing" disabled={locked} type="button" variant="ghost"><span className="text-right">{listingLabel}</span>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground/70" /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end" onCloseAutoFocus={event => event.preventDefault()} style={{ minWidth: "var(--radix-dropdown-menu-trigger-width)" }}>
            <DropdownMenuRadioGroup onValueChange={value => { if (value === "listed" || value === "unlisted") setProjectVisibility(value); }} value={input.projectVisibility}>
              <DropdownMenuRadioItem data-testid="create-project-listing-option-listed" value="listed">{t("projects.listed")}</DropdownMenuRadioItem>
              <DropdownMenuRadioItem data-testid="create-project-listing-option-unlisted" value="unlisted">{t("projects.unlisted")}</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {errorMessage ? <p role="status" className="text-sm text-destructive">{errorMessage}</p> : null}
    </form>
  </ChooserDialogContent>;
}
