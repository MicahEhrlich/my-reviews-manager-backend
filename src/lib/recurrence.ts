export function nextFutureOccurrence(previous: Date, frequencyDays: number, now = new Date()): Date {
  if (!Number.isInteger(frequencyDays) || frequencyDays < 1 || frequencyDays > 30) throw new Error('frequencyDays must be between 1 and 30');
  const interval = frequencyDays * 86_400_000;
  const next = previous.getTime() + interval;
  if (next > now.getTime()) return new Date(next);
  const skipped = Math.floor((now.getTime() - previous.getTime()) / interval) + 1;
  return new Date(previous.getTime() + skipped * interval);
}
