import path from 'path';
import { FixtureLibrary } from '@electron/fixtures/library';

const p = require('path');
const OFL = p.join(process.cwd(), 'resources', 'fixtures', 'ofl');
const lib = new FixtureLibrary();

const targets = ['JB-Systems-Twin-Effect-Laser', 'panasonic-PT-RZ120', 'Showtec-Dominator', 'Abstract-Twister-4'];

async function main() {
  await lib.loadOflDirectory(OFL);
  const defs = lib.getAll() as any[];
  const byId = new Map(defs.map((d) => [d.id, d]));
  console.log('== cherche ids alternatifs ==');
  for (const t of targets) if (!byId.has(t)) console.log('ABSENT:', t);
  for (const t of targets) {
    const def = byId.get(t);
    if (!def) continue;
    const mo = def.modes.reduce((a: any, b: any) => (b.channels.length > a.channels.length ? b : a));
    console.log('\n### ' + def.id + ' | type=' + def.type + ' | catégories=' + JSON.stringify(def.categories || null) + ' | mode=' + mo.name);
    let i = 0;
    for (const ch of mo.channels) {
      const caps = (ch.capabilities || []).map((c: any) => c.name).join(' / ');
      const cm: string = ch.defaultValue !== undefined ? `(def=${ch.defaultValue})` : '';
      console.log(`  [${i}] ${ch.name} caps=${ch.capabilities ? caps.slice(0, 120) : ''} ${cm}`);
      i++;
    }
  }
}
main();