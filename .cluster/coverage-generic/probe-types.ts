import { FixtureLibrary } from '../../electron/fixtures/library';
import { isLaserFixture } from '../../src/engine/fixture-analyzer';

async function main(): Promise<void> {
  const lib = new FixtureLibrary();
  await lib.loadOflDirectory('resources/fixtures/ofl');
  const all = lib.getAll();
  console.log('total:', all.length);
  for (const d of all) {
    if (!String(d.type).toLowerCase().includes('laser')) continue;
    let best = 0, len = -1;
    d.modes.forEach((m: any, i: number) => { if ((m.channels ?? []).length > len) { len = m.channels.length; best = i; } });
    const chans = d.modes[best].channels as any[];
    const pf: any = {
      id: d.id, fixtureDefId: d.id, manufacturer: d.manufacturer, model: d.model,
      fixtureType: d.type, modeIndex: best, modeName: (d.modes[best] as any).name,
      universeId: 'U1', startAddress: 1, channelCount: chans.length, name: d.model, tier: 'primary',
    };
    let il = false;
    try { il = isLaserFixture(pf, chans); } catch (e) { il = `THROW ${e}`; }
    console.log(`type=${JSON.stringify(d.type)} isLaserFixture=${il} | ${d.id}`);
  }
}

main().catch((e) => { console.log('ERR', e); });