=== ANALYSE PIPELINE MOUNT MODE ===

1. UI CLICK → setFixturePosition(id, { mountMode: 'rear' })
2. STORE: setFixturePosition merge dans fixturePositions[id] → OK
3. REACT: fixturePositions change → second useEffect [fixturePositions, patchedFixtures]
4. EFFECT: appelle fitMountRotation(f3d, 'rear') → group.rotation.x = Math.PI/2
5. RENDER: Three.js render loop → group pivoté

POINTS DE BLOCAGE POTENTIELS:
A. Le head mesh est caché (bodyMesh.visible = !hasThumbnail) → invisible
B. Le sprite Three.js est un BILLBOARD → toujours face caméra → rotation invisible
C. Le beam cone est long (50 unités) et subtil → difficile à voir
D. Pas de logs → impossible de diagnostiquer

CONFIRMATION VISUELLE: tout le code est CORRECT mais INVISIBLE à l'écran.
