const monthsShort = ['հնվ.', 'փտվ.', 'մրտ.', 'ապր.', 'մյս.', 'հնս.', 'հլս.', 'օգս.', 'սեպ.', 'հոկ.', 'նոյ.', 'դեկ.'];
const monthsLong = ['հունվարի', 'փետրվարի', 'մարտի', 'ապրիլի', 'մայիսի', 'հունիսի', 'հուլիսի', 'օգոստոսի', 'սեպտեմբերի', 'հոկտեմբերի', 'նոյեմբերի', 'դեկտեմբերի'];

export function formatArmenianDate(value: unknown, includeYear = false): string {
  if (typeof value !== 'string' && typeof value !== 'number' && !(value instanceof Date)) return 'Ամսաթիվը նշված չէ';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Ամսաթիվը նշված չէ';
  const month = includeYear ? monthsLong[date.getMonth()] : monthsShort[date.getMonth()];
  return includeYear
    ? `${date.getDate()} ${month}, ${date.getFullYear()} թ.`
    : `${date.getDate()} ${month}`;
}

export function localizeRequestStatus(value: string): string {
  const status = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
  const labels: Record<string, string> = {
    new: 'Նոր', open: 'Բաց', pending: 'Սպասում է',
    assigned: 'Կատարողը նշանակված է', accepted: 'Ընդունված',
    in_progress: 'Ընթացքի մեջ է', started: 'Ընթացքի մեջ է',
    on_hold: 'Ժամանակավորապես դադարեցված է',
    waiting: 'Սպասում է', awaiting_review: 'Ստուգման է սպասում',
    under_review: 'Ստուգվում է', review: 'Ստուգվում է',
    resolved: 'Լուծված է', complete: 'Ավարտված է', completed: 'Ավարտված է',
    done: 'Ավարտված է', closed: 'Փակված է', cancelled: 'Չեղարկված է',
    rejected: 'Մերժված է',
  };
  return labels[status] ?? 'Կարգավիճակը թարմացվում է';
}

export function isCompletedRequestStatus(value: string): boolean {
  const status = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
  return ['resolved', 'complete', 'completed', 'done', 'closed'].includes(status);
}

export function requestCount(count: number): string {
  return `${count} հայտ`;
}

export function armenianCurrency(code?: string | null): string {
  if (!code) return 'ՀՀ դրամ';
  const labels: Record<string, string> = {
    AMD: 'ՀՀ դրամ', USD: 'ԱՄՆ դոլար', RUB: 'Ռուսական ռուբլի',
    EUR: 'Եվրո', GEL: 'Վրացական լարի',
  };
  return labels[code.toUpperCase()] ?? code.toUpperCase();
}

export function friendlyError(_error: unknown, message: string): string {
  return message;
}
