import * as fs from 'fs';
import * as path from 'path';
import { FixtureLibrary } from '../../electron/fixtures/library';

const ROOT = path.resolve(__dirname, '..', '..');

async function main(): Promise<void> {
  const lib = new FixtureLibrary();
  await lib.loadOflDirectory(path.join(ROOT, 'resources', 'fixtures', 'ofl'));
  const defs = lib.getAll();
  const lasers = defs.filter((d) => String(d.type).toLowerCase().includes('laser'));
  console.log('defs de type Laser:', lasers.length);
  for (const d of lasers) {
    let best = 0;
    let bestLen = -1;
    d.modes.forEach((m: any, i: number) => {
      if ((m.channels ?? []).length > bestLen) { bestLen = m.channels.length; best = i; }
    });
    const m = d.modes[best];
    console.log('*', `${d.manufacturer} ${d.model}`, '|', m.name, `${m.channels.length}ch`, '|', m.channels.map((c: any) => `${c.name}(${c.type})`).join(' | '));
  }
}

main();