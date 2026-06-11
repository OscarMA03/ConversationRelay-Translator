export function computeStats(samples) {
  if (samples.length === 0) return null;

  const sorted = [...samples].sort((a, b) => a - b);
  const min = sorted[0];
  const avg = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  const p95 = sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)];
  return { min, avg, p95 };
}
