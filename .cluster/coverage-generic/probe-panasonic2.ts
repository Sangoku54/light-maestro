import * as fs from 'fs';
import * as path from 'path';
import { FixtureLibrary } from '../../electron/fixtures/library';

async function main(): Promise<void> {
  const lib = new FixtureLibrary();
  await lib.loadOflDirectory('resources/fixtures/ofl');
  const d = lib.getAll().find((x) => x.id === 'panasonic-PT-RZ120')!;
  console.log('id:', d.id);
  console.log('type:', JSON.stringify(d.type), '| typeof:', typeof d.type);
  console.log('manufacturer:', JSON.stringify(d.manufacturer));
  // Re-parse brut
  const raw = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'resources/fixtures/ofl/panasonic/pt-rz120.json'), 'utf-8'));
  console.log('categories brutes:', JSON.stringify(raw.categories));
  console.log('name brut:', JSON.stringify(raw.name));
  // Test isLaserFixture en dupliquant le code ici (fiabilité)
  const norm = String((d as any).type ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  console.log('norm depuis d.type:', JSON.stringify(norm), '| includes laser:', norm.includes('laser'));
}

main().catch((e) => { console.log('ERR', e); });