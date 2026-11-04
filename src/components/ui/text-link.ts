import { cn } from "@/lib/utils";

// Text links share one hover language: the underline never pops in or out (text-decoration-line
// cannot transition), it changes colour and distance in 150 ms on the door curve. The link colour
// stays with the caller (text-link, or muted text that turns foreground on hover).

/** A standalone link (an action set in text): a soft underline that firms up and tightens on hover. */
export const textLinkClassName = cn(
  "underline decoration-current/40 underline-offset-4",
  "transition-[color,text-decoration-color,text-underline-offset] duration-150 ease-door",
  "hover:decoration-current hover:underline-offset-2",
);

/**
 * A 44 px touch target around a short one-line text link, the text left where it is: a transparent
 * ::after 44 px high, centred on the link. A link right above a field moves it with `after:` classes.
 */
export const touchLinkClassName = "relative inline-block after:absolute after:inset-x-0 after:top-1/2 after:h-11 after:-translate-y-1/2";

/** A quiet link (breadcrumbs, footer, names): no underline until hover, then it fades in. */
export const quietLinkClassName = cn(
  "underline decoration-transparent underline-offset-2",
  "transition-[color,text-decoration-color] duration-150 ease-door",
  "hover:decoration-current",
);
