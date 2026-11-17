import { describe, it, beforeAll, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { unpackProject } from '../../electron/project-envelope';

// .lmproj local de diagnostic (exclu du repo) : skip si absent du disque.
describe.skipIf(!fs.existsSync(path.join(process.cwd(), 'LM', 'concert.lmproj')))('Concert.lmproj fixture positions', () => {
  beforeAll(async () => {
    const PROJECT = path.join(process.cwd(), 'LM', 'concert.lmproj');
    expect(fs.existsSync(PROJECT)).toBe(true);
    const packed = await unpackProject(PROJECT);
    const proj = JSON.parse(packed.content);
    
    const fixtures = proj.showStore?.patchedFixtures || [];
    const positions = proj.showStore?.fixturePositions || {};
    
    console.error(`Total fixtures: ${fixtures.length}`);
    
    // Print ALL fixtures with their positions
    const output: string[] = [];
    for (let i = 0; i < fixtures.length; i++) {
      const f = fixtures[i];
      const pos = positions[f.id] || 'NO POS';
      output.push(`[${i+1}] ${f.id}: name="${f.name}", x=${pos.x}, y=${pos.y}, h=${pos.h}, heading=${pos.heading}, mountMode=${pos.mountMode}`);
    }
    // Write to file
    fs.writeFileSync('C:/Users/vitte/.openclaw-autoclaw/agents/mon-codeur/workspace/light-maestro/concert_fixture_positions.txt', output.join('\n'));
    output.forEach(line => console.error(line));
  });

  it('logs positions', () => {
    expect(true).toBe(true);
  });
});
