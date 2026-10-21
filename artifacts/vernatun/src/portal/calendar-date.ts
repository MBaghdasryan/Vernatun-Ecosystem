/** A date-only business value, independent of the browser's local time zone.
 * Existing Vernatun calendars use Yerevan; callers with an explicit zone can
 * supply it without converting a calendar date into a UTC timestamp.
 */
export function calendarDay(now = new Date(), timeZone = 'Asia/Yerevan'): string {
 const parts = new Intl.DateTimeFormat('en-CA', {
  timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
 }).formatToParts(now);
 const value = (type: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === type)!.value;
 return `${value('year')}-${value('month')}-${value('day')}`;
}
