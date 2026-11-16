import * as fs from 'fs';
import * as path from 'path';
import { FixtureLibrary } from '../../electron/fixtures/library';

async function main(): Promise<void> {
  const lib = new FixtureLibrary();
  console.log('lib id OK', !!lib);
  const ROOT = process.cwd();
  const OFL_DIR = path.join(ROOT, 'resources', 'fixtures', 'ofl');
  // Reproduire le scan pour voir la CAUSE de chaque parse-fail
  const mfrDirs = fs.readdirSync(OFL_DIR, { withFileTypes: true }).filter((e) => e.isDirectory());
  for (const mfrDir of mfrDirs) {
    const mfrPath = path.join(OFL_DIR, mfrDir.name);
    const files = fs.readdirSync(mfrPath, { withFileTypes: true }).filter((e) => e.isFile() && e.name.endsWith('.json'));
    for (const f of files) {
      const full = path.join(mfrPath, f.name);
      const raw = JSON.parse(fs.readFileSync(full, 'utf-8'));
      // test parse
      const content = fs.readFileSync(full, 'utf-8');
      let def: any = { ok: true };
      let err: string | null = null;
      try {
        def = lib.parseOFLFixture(content, mfrDir.name);
      } catch (e) {
        err = (e as Error).message;
      }
      if (!def || err) {
        console.log(`FAIL ${mfrDir.name}/${f.name}` +
          ` | name=${JSON.stringify(raw.name)}` +
          ` | categories=${JSON.stringify(raw.categories)}` +
          ` | redirectTo=${JSON.stringify(raw.redirectTo)}` +
          ` | modes=${Array.isArray(raw.modes) ? raw.modes.length : '?'} (channels: ${Array.isArray(raw.modes) ? raw.modes.map((m: any) => Array.isArray(m.channels) ? m.channels.length : '?').join(',') : ''})` +
          ` | availableChannels=${Object.keys(raw.availableChannels ?? {}).length}` +
          (err ? ` | erreur=${err}` : ' | parse=null silencieux'));
      }
    }
  }
}

main().catch((e) => { console.log('ERR', e); });