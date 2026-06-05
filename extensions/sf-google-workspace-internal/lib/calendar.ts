/* SPDX-License-Identifier: Apache-2.0 */
/**
 * calendar.ts — calendar date helpers and compact event formatting.
 *
 * Avoids context bloat by computing date boundaries locally and formatting
 * events compactly (time + title) unless `detailed=true`.
 */

/**
 * Resolve a convenience date string into RFC-3339 time_min/time_max boundaries.
 *
 * Supports:
 *  - "today"     → current local day
 *  - "tomorrow"  → next local day
 *  - "YYYY-MM-DD" → that specific day
 *
 * Returns undefined for both fields when no date is provided, leaving
 * explicit time_min/time_max pass-through to the caller.
 */
export function resolveDateBoundaries(
  date: string | undefined,
  now: Date = new Date(),
): { time_min?: string; time_max?: string } {
  if (!date) return {};

  const normalized = date.trim().toLowerCase();

  let targetDate: Date;

  if (normalized === "today") {
    targetDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  } else if (normalized === "tomorrow") {
    targetDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  } else {
    // Expect YYYY-MM-DD
    const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return {};
    const [, yearStr, monthStr, dayStr] = match;
    const year = Number(yearStr);
    const month = Number(monthStr) - 1;
    const day = Number(dayStr);
    // Validate ranges (JS Date overflows silently)
    if (month < 0 || month > 11 || day < 1 || day > 31) return {};
    targetDate = new Date(year, month, day);
    if (Number.isNaN(targetDate.getTime())) return {};
    // Verify Date didn't overflow (e.g. Feb 30 → Mar 2)
    if (targetDate.getMonth() !== month || targetDate.getDate() !== day) return {};
  }

  const nextDay = new Date(targetDate.getTime() + 24 * 60 * 60 * 1000);

  return {
    time_min: toLocalIso(targetDate),
    time_max: toLocalIso(nextDay),
  };
}

/**
 * Build MCP arguments for `get_events` from our friendly wrapper params.
 */
export interface CalendarGetEventsParams {
  calendar_id?: string;
  date?: string;
  time_min?: string;
  time_max?: string;
  query?: string;
  max_results?: number;
  detailed?: boolean;
  include_attachments?: boolean;
}

export interface CalendarFreeBusyParams {
  time_min?: string;
  time_max?: string;
  date?: string;
  start_time?: string;
  end_time?: string;
  calendar_ids?: string[];
}

export function buildCalendarEventsArgs(
  params: CalendarGetEventsParams,
  now: Date = new Date(),
): Record<string, unknown> {
  const args: Record<string, unknown> = {};

  if (params.calendar_id) args.calendar_id = params.calendar_id;

  // Resolve date convenience or pass explicit time boundaries
  const boundaries = resolveDateBoundaries(params.date, now);
  const timeMin = params.time_min || boundaries.time_min;
  const timeMax = params.time_max || boundaries.time_max;
  if (timeMin) args.time_min = timeMin;
  if (timeMax) args.time_max = timeMax;

  if (params.query) args.query = params.query;
  if (params.max_results != null) args.max_results = params.max_results;
  if (params.detailed != null) args.detailed = params.detailed;
  if (params.include_attachments != null) args.include_attachments = params.include_attachments;

  return args;
}

export function buildCalendarFreeBusyArgs(
  params: CalendarFreeBusyParams,
  now: Date = new Date(),
): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  const fromDateAndTimes = resolveDateTimeWindow(
    params.date,
    params.start_time,
    params.end_time,
    now,
  );
  const timeMin = params.time_min || fromDateAndTimes.time_min;
  const timeMax = params.time_max || fromDateAndTimes.time_max;
  if (timeMin) args.time_min = timeMin;
  if (timeMax) args.time_max = timeMax;
  if (params.calendar_ids?.length) args.calendar_ids = params.calendar_ids;
  return args;
}

export function resolveDateTimeWindow(
  date: string | undefined,
  startTime: string | undefined,
  endTime: string | undefined,
  now: Date = new Date(),
): { time_min?: string; time_max?: string } {
  if (!date || !startTime || !endTime) return {};
  const day = resolveDateBoundaries(date, now).time_min;
  if (!day) return {};
  const datePart = day.slice(0, 10);
  const start = parseLocalTimeOnDate(datePart, startTime);
  const end = parseLocalTimeOnDate(datePart, endTime);
  if (!start || !end || end <= start) return {};
  return { time_min: toLocalIso(start), time_max: toLocalIso(end) };
}

function parseLocalTimeOnDate(datePart: string, timeText: string): Date | null {
  const trimmed = timeText.trim().toLowerCase();
  const match = trimmed.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = match[2] ? Number(match[2]) : 0;
  const meridiem = match[3];
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || minute < 0 || minute > 59)
    return null;
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    if (meridiem === "pm" && hour !== 12) hour += 12;
    if (meridiem === "am" && hour === 12) hour = 0;
  } else if (hour < 0 || hour > 23) {
    return null;
  }
  const [year, month, day] = datePart.split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day, hour, minute, 0);
}

/**
 * Format a local Date as ISO-8601 string with timezone offset.
 * Avoids UTC conversion so boundaries are in the user's local day.
 */
function toLocalIso(date: Date): string {
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const absOffset = Math.abs(offset);
  const hours = String(Math.floor(absOffset / 60)).padStart(2, "0");
  const minutes = String(absOffset % 60).padStart(2, "0");
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${hours}:${minutes}`
  );
}
