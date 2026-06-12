import { computeStats } from './stats.mjs';

export function parseEvents(jsonlText) {
  return jsonlText
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

export function summarize(events) {
  /** per-session pairing state: sessionId -> { lastPromptIn, lastTextOut } */
  const sessions = new Map();
  /** comboId -> accumulators */
  const byCombo = new Map();

  const sorted = [...events].sort((a, b) => a.ts - b.ts);

  for (const event of sorted) {
    if (event.comboId === undefined || event.comboId === null) continue;

    if (!byCombo.has(event.comboId)) {
      byCombo.set(event.comboId, {
        sessionIds: new Set(),
        translateSamples: [],
        turnAroundSamples: [],
        perCharSamples: [],
        charSamples: [],
        promptCounts: new Map()
      });
    }
    const bucket = byCombo.get(event.comboId);
    bucket.sessionIds.add(event.sessionId);

    if (!sessions.has(event.sessionId)) {
      sessions.set(event.sessionId, { lastPromptIn: null, lastTextOut: null });
    }
    const state = sessions.get(event.sessionId);

    if (event.direction === 'in' && event.type === 'prompt') {
      const legKey = `${event.sessionId}:${event.leg}`;
      bucket.promptCounts.set(legKey, (bucket.promptCounts.get(legKey) ?? 0) + 1);

      if (state.lastTextOut && state.lastTextOut.leg === event.leg) {
        const elapsed = event.ts - state.lastTextOut.ts;
        bucket.turnAroundSamples.push(elapsed);
        if (state.lastTextOut.chars > 0) {
          bucket.perCharSamples.push(elapsed / state.lastTextOut.chars);
        }
        state.lastTextOut = null;
      }
      state.lastPromptIn = { ts: event.ts, leg: event.leg };
    } else if (event.direction === 'out' && event.type === 'text') {
      if (state.lastPromptIn && state.lastPromptIn.leg !== event.leg) {
        bucket.translateSamples.push(event.ts - state.lastPromptIn.ts);
        state.lastPromptIn = null;
      }
      if (event.chars > 0) bucket.charSamples.push(event.chars);
      state.lastTextOut = { ts: event.ts, leg: event.leg, chars: event.chars };
    }
  }

  const summary = {};
  for (const [comboId, bucket] of byCombo) {
    const counts = [...bucket.promptCounts.values()];
    summary[comboId] = {
      sessions: bucket.sessionIds.size,
      turns: bucket.translateSamples.length,
      translateLatency: computeStats(bucket.translateSamples),
      turnAround: computeStats(bucket.turnAroundSamples),
      turnAroundPerChar: computeStats(bucket.perCharSamples),
      avgChars: bucket.charSamples.length
        ? bucket.charSamples.reduce((sum, n) => sum + n, 0) / bucket.charSamples.length
        : null,
      promptsPerLeg: counts.length
        ? counts.reduce((sum, n) => sum + n, 0) / counts.length
        : 0
    };
  }
  return summary;
}
