// Static brand mark for onboarding (originally Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/shared/ui/buzz-logo/BuzzMark.tsx). DD-141: renders the Kailo glyph
// in `currentColor`, complete on the first frame; the export name stays.
export function BuzzMark({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={["buzz-mark", className].filter(Boolean).join(" ")}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeWidth="2.4"
    >
      <path d="M8.6 6.6v10.8" />
      <path d="M9.4 12.6l5.5-5.2" />
      <path d="M11.5 10.9l4.3 6.1" />
      <circle cx="16.1" cy="6.3" r="1.75" fill="currentColor" stroke="none" />
      <circle cx="16.3" cy="17.6" r="1.75" fill="currentColor" stroke="none" />
    </svg>
  );
}
