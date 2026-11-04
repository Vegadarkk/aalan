import { SITE_NAME } from "@/config/site";
import { icsStamp, icsText } from "@/lib/appointments/ics";
import { dayNumber, dayString } from "@/lib/listings/rental-availability";

// Rentals in the renter's or the agency's own calendar (audit zone 4, iCal export): iCalendar
// (RFC 5545) built in the browser and downloaded as a .ics file, like the appointments' (no server
// call, no public feed to guard). Days are all-day DATE values of Morocco's calendar: a rental from
// the 3rd to the 5th covers the 3rd, 4th and 5th, so DTEND (exclusive) is the day after the last.

export interface IcsDays {
  /** "YYYY-MM-DD": first and last days, both included. */
  from: string;
  to: string;
}

export interface RentalIcsEvent extends IcsDays {
  /** Stable per event: a calendar imported twice updates it instead of doubling it. */
  uid: string;
  title: string;
  description?: string;
  url?: string;
  /** A reminder the evening before the first day (18:00). */
  alarm?: boolean;
}

const date = (day: string) => day.replace(/-/g, "");
const dayAfter = (day: string) => dayString(dayNumber(day) + 1);

/** One VCALENDAR of all-day events; `name` names the calendar when it is imported. */
export function rentalIcs(events: readonly RentalIcsEvent[], options: { name?: string; now?: number } = {}): string {
  const stamp = icsStamp(options.now ?? Date.now());
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:-//${SITE_NAME}//Locations//FR`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    ...(options.name ? [`X-WR-CALNAME:${icsText(options.name)}`] : []),
  ];
  for (const event of events) {
    if (Number.isNaN(dayNumber(event.from)) || Number.isNaN(dayNumber(event.to)) || event.to < event.from) continue;
    lines.push(
      "BEGIN:VEVENT",
      `UID:${event.uid}@${SITE_NAME.toLowerCase()}.ma`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${date(event.from)}`,
      `DTEND;VALUE=DATE:${date(dayAfter(event.to))}`,
      `SUMMARY:${icsText(event.title)}`,
      ...(event.description ? [`DESCRIPTION:${icsText(event.description)}`] : []),
      ...(event.url ? [`URL:${event.url}`] : []),
      "TRANSP:OPAQUE",
    );
    if (event.alarm) lines.push("BEGIN:VALARM", "ACTION:DISPLAY", "TRIGGER:-PT6H", `DESCRIPTION:${icsText(event.title)}`, "END:VALARM");
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return `${lines.join("\r\n")}\r\n`;
}
