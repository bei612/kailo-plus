// DD-168 (.design/20 §16.3): the layout grammar of platform pages inside the content plane.
// The host draws the 52 px page header; a page body is a column of sections. A section has a
// Title 2 heading, an optional one-line description and its actions at the end of the heading
// row. A detail view has a back affordance, its title with status, then facts, then history.
import type { ReactNode } from "react";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { useT } from "./context";

/** The body column of a platform page: centred, max 64 rem, 24 px gutters. */
export function PageBody({ children, wide, testId }: { children: ReactNode; wide?: boolean; testId?: string }) {
  return <div data-testid={testId} className={`mx-auto flex w-full min-w-0 flex-col gap-6 ${wide ? "max-w-none" : "max-w-5xl"}`}>{children}</div>;
}

/** A titled section of a page. */
export function PageSection({ title, description, actions, children, testId, id }: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  testId?: string;
  id?: string;
}) {
  return <section className="flex min-w-0 flex-col gap-3" data-testid={testId} aria-labelledby={title && id ? `${id}-title` : undefined}>
    {title || actions ? <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
      <div className="flex min-w-0 flex-col gap-0.5">
        {title ? <h2 id={id ? `${id}-title` : undefined} className="text-[1.0625rem] font-semibold leading-6 tracking-[-0.012em] text-foreground">{title}</h2> : null}
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header> : null}
    {children}
  </section>;
}

/** The head of a detail view: back, title and status, a muted subtitle, actions at the end. */
export function DetailHeader({ title, status, subtitle, onBack, actions }: {
  title: ReactNode;
  status?: ReactNode;
  subtitle?: ReactNode;
  onBack?: () => void;
  actions?: ReactNode;
}) {
  const t = useT();
  return <header className="flex flex-col gap-3">
    {onBack ? <button type="button" onClick={onBack}
      className="inline-flex w-fit items-center gap-1 rounded-md px-1.5 py-1 text-sm text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring">
      <ArrowLeft aria-hidden className="h-4 w-4" strokeWidth={1.75} />{t("platform.back")}
    </button> : null}
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h2 className="min-w-0 text-[1.375rem] font-semibold leading-7 tracking-[-0.018em] text-foreground">{title}</h2>
          {status}
        </div>
        {subtitle ? <p className="text-sm text-muted-foreground">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  </header>;
}

/** The refresh icon button of a list toolbar; spins while a read is in flight. */
export function RefreshButton({ onClick, pending, label }: { onClick: () => void; pending?: boolean; label?: string }) {
  const t = useT();
  const text = label ?? t("platform.refresh");
  return <button type="button" onClick={onClick} disabled={pending} aria-label={text} title={text}
    className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-input bg-background text-muted-foreground shadow-xs hover:bg-accent hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60">
    <RefreshCw aria-hidden className={`h-4 w-4 ${pending ? "animate-spin motion-reduce:animate-none" : ""}`} strokeWidth={1.75} />
  </button>;
}

/** A segmented filter for a list toolbar (status: all / active / ended …). */
export function FilterChips<V extends string>({ value, options, onChange, label }: {
  value: V;
  options: readonly { value: V; label: ReactNode; count?: number }[];
  onChange: (value: V) => void;
  label: string;
}) {
  return <div role="radiogroup" aria-label={label} className="inline-flex h-8 items-center gap-0.5 rounded-lg bg-muted p-0.5">
    {options.map((option) => <button key={option.value} type="button" role="radio" aria-checked={option.value === value}
      onClick={() => onChange(option.value)}
      className={`inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors duration-[140ms] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring ${option.value === value ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"}`}>
      {option.label}
      {option.count !== undefined ? <span className="tabular-nums text-muted-foreground">{option.count}</span> : null}
    </button>)}
  </div>;
}
