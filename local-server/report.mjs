import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getCombo } from './combos.mjs';
import { parseEvents, summarize } from './metrics.mjs';

const file = fileURLToPath(new URL('./test-results.jsonl', import.meta.url));

let text = '';
try {
  text = fs.readFileSync(file, 'utf8');
} catch (error) {
  if (error.code === 'ENOENT') {
    console.error('No test results yet. Run calls with PROVIDER_TEST_MODE=true first.');
    process.exit(1);
  }
  throw error;
}

const summary = summarize(parseEvents(text));
const ids = Object.keys(summary).map(Number).sort((a, b) => a - b);
if (ids.length === 0) {
  console.error('test-results.jsonl has no usable events.');
  process.exit(1);
}

const ms = (stats) => (stats
  ? `${Math.round(stats.min)}/${Math.round(stats.avg)}/${Math.round(stats.p95)}`
  : '-');

console.log(
  'Combo  Label              Sessions  Turns   Translate ms (min/avg/p95)   Turn-around ms (min/avg/p95)  Prompts/leg'
);
console.log('-'.repeat(112));
for (const id of ids) {
  const row = summary[id];
  let label;
  try {
    label = getCombo(id).label;
  } catch {
    label = `combo ${id}`;
  }
  console.log(
    String(id).padEnd(7)
    + label.padEnd(19)
    + String(row.sessions).padStart(8)
    + String(row.turns).padStart(7)
    + ms(row.translateLatency).padStart(29)
    + ms(row.turnAround).padStart(30)
    + row.promptsPerLeg.toFixed(1).padStart(13)
  );
}
console.log('\nTurn-around includes TTS playback, the listener\'s reply, STT, and endpointing —');
console.log('compare combos only across calls that followed the same script.');
