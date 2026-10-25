// Compare preserved legacy fields independently of the calendar metadata introduced in schema 7.
export function legacyFields<T extends object>(task: T): Omit<T, 'requestedStartDate' | 'effortWorkingDays' | 'effortProvenance'> {
  const { requestedStartDate, effortWorkingDays, effortProvenance, ...rest } = task as T & {
    requestedStartDate?: string; effortWorkingDays?: number; effortProvenance?: string;
  };
  return rest;
}
