import fs from 'fs';
import path from 'path';
import { FixtureLibrary } from '../../electron/fixtures/library';

const OFL = path.join(process.cwd(), 'resources', 'fixtures', 'ofl');
const lib = new FixtureLibrary();
const targets: [string, string][] = [
  ['cameo', 'ioda-400-rgy.json'],
  ['american-dj', 'galaxian-3d.json'],
  ['jb-systems', 'stinger-ii.json'],
  ['jb-systems', 'inno-pocket-fusion.json'],
  ['american-dj', 'boom-box-fx2.json'],
];
for (const [mfr, file] of targets) {
  const def = lib.parseOFLFixture(fs.readFileSync(path.join(OFL, mfr, file), 'utf8'), mfr);
  if (!def) { console.log(file, 'parse KO'); continue; }
  const longest = Math.max(...def.modes.map((mo) => mo.channels.length));
  const mo = def.modes.find((x) => x.channels.length === longest)!;
  console.log('\n=== ' + file + ' | mode ' + mo.name + ' | ' + mo.channels.length + ' ch ===');
  mo.channels.forEach((c, i) => {
    const caps = (c.capabilities || []).map((x: any) => `${x.min}-${x.max}${x.name ? ':' + x.name : ''}`).join(' | ');
    console.log(`${i}: [${c.type || ''}] ${c.name} => ${caps.slice(0, 170)}`);
  });
}