import { isLaserFixture } from '../../src/engine/fixture-analyzer';
import type { DmxFixtureChannel } from '../../src/hooks/dmx-cues';

const ch = (name: string, type: DmxFixtureChannel['type'], caps?: { min: number; max: number; name: string }[]) =>
  ({ name, type, offset: 0, ...(caps ? { capabilities: caps } : {}) });
const el = [
  ch('Mode', 'Effect', [{ min: 0, max: 49, name: 'Laser off' }, { min: 200, max: 255, name: 'Dynamic pattern' }]),
  ch('Pattern Selection', 'Nothing'),
  ch('Horizontal Angle', 'Beam'),
  ch('Vertical Angle', 'Beam'),
  ch('Zoom', 'Beam'),
  ch('Color Segment', 'Nothing'),
];
console.log('isLaser(Color Changer):', isLaserFixture({ fixtureType: 'Color Changer' } as any, el as DmxFixtureChannel[]));
console.log('isLaser(laser):', isLaserFixture({ fixtureType: 'laser' } as any, el as DmxFixtureChannel[]));
const par = [ch('Dimmer', 'Intensity'), chC3('Program')];
function chC3(name: string) { return { name, type: 'Shutter' as const, offset: 1, capabilities: [{ min: 0, max: 255, name: 'x' }] }; }
console.log('isLaser(par Program):', isLaserFixture({ fixtureType: 'Par' } as any, par as DmxFixtureChannel[]));