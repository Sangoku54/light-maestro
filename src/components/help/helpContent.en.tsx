/**
 * Centre d'aide — version anglaise (miroir de helpContent.tsx).
 * Même structure, mêmes ids, même ordre. Le modal choisit selon la langue.
 */
import type { HelpPage } from './helpContent';

export const HELP_GROUPS_EN: string[] = [
  'Getting started',
  'Auto Show',
  'Setup',
  'Performance',
  'Account',
];

export const HELP_PAGES_EN: HelpPage[] = [
  {
    id: 'projets',
    group: 'Getting started',
    emoji: '📁',
    title: 'Projects: create, open, save',
    pitch: 'Your whole show lives in one .lmproj file: patch, scenes, presets, console.',
    steps: [
      'Top bar: New (blank page), Open (an .lmproj), Save (Ctrl+S).',
      'Work fearlessly: on quit, a guard offers Save / Discard.',
      'A dirty dot means one thing: it is not saved yet.',
    ],
    tips: [
      'One .lmproj per gig + date in the name: “2026-10-31-club.lmproj”.',
      'Copy the file to a USB stick before leaving — that is your backup.',
    ],
    challenge: 'Create a project, patch one fixture, save with Ctrl+S.',
  },
  {
    id: 'audio',
    group: 'Getting started',
    emoji: '🎧',
    title: 'Audio: import and analyze',
    pitch: 'No analysis = no auto show. A well analyzed track is 80% of the job done.',
    steps: [
      'Auto Show mode → Audio Source: drop an MP3/WAV/FLAC.',
      'Run the analysis: BPM, sections (intro/verse/chorus/drop) and energy are detected.',
      'Check the displayed sections: if the drop is misplaced, force the BPM with tap tempo.',
    ],
    tips: [
      'Trim silences and spoken intros before analysis: tighter tempo.',
      'A variable-tempo track stays tricky — set the BPM by hand.',
    ],
    challenge: 'Analyze a track and find its drop on the timeline.',
  },
  {
    id: 'show-auto',
    group: 'Auto Show',
    emoji: '⚡',
    title: 'Auto show: your track drives the lights',
    pitch: 'Auto Show generates chasers, colors, strobes and movement from the analysis. You set the taste.',
    steps: [
      'Pick a preset (.lmpreset) or generate from your analyzed track.',
      'Set intensity, palette, movement and time division.',
      'Hit play: lights follow the sections (the drop hits harder).',
      'Save as a preset to replay identically live.',
    ],
    tips: [
      'Strobe too violent? Lower the strobe limit before touching anything else.',
      'Live: Grand Master or Blackout, always within reach.',
    ],
    challenge: 'Play a whole track without touching a slider after launch.',
  },
  {
    id: 'palettes',
    group: 'Auto Show',
    emoji: '🎨',
    title: 'Color palettes',
    pitch: 'Consistent colors across the show, instead of a tired rainbow.',
    steps: [
      'Color Palettes tab: pick Warm, Cool or Party for the mood.',
      'Apply per section: a cold verse + a hot chorus tells a story.',
      'Build your presets: 3 colors that go together beat 12 random ones.',
    ],
    tips: [
      'Fewer colors = more pro show. 3 max per track.',
      'White breaks everything: save it for peaks (drop, finale).',
    ],
    challenge: 'Redo one of your tracks with a single 3-color palette.',
  },
  {
    id: 'scenes-preprog',
    group: 'Auto Show',
    emoji: '✨',
    title: 'Pre-programmed scenes',
    pitch: '128 scenes generated from YOUR patch, in 4 banks of 32. Creative block no longer exists.',
    steps: [
      'Pre-programmed scenes tab: pick a bank (Colors, Effects, Matrix, Mix).',
      'Click a tile: it loops. Click again: it stops AND goes dark.',
      '“Regenerate” produces 128 new variants of the same patch.',
    ],
    tips: [
      'A lit tile stays lit even when you switch tabs — click again to kill it.',
      'Effect tiles move the heads: check where they point before the audience.',
    ],
    challenge: 'Find a moving Effects tile + a killer Colors tile, chain them.',
  },
  {
    id: 'patch',
    group: 'Setup',
    emoji: '🔌',
    title: 'Patch: declare your fixtures',
    pitch: 'The software cannot guess your rig: each fixture is declared once, with its correct address.',
    steps: [
      'Setup mode → Fixtures tab: find your model (1500+ references, .qxf import available).',
      'Place it at its real DMX address (read the fixture manual).',
      'Address conflict = red: fix before continuing.',
      'Repeat for each fixture, in DMX chain order.',
    ],
    tips: [
      'Photo each fixture DMX display before teardown. Always.',
      'Overlapping addresses = two fixtures doing nonsense together.',
    ],
    challenge: 'Patch your first fixture and light it from its card (test).',
  },
  {
    id: 'groupes',
    group: 'Setup',
    emoji: '👥',
    title: 'Groups',
    pitch: '“The 4 front washes” in one click instead of 4: group by role, not randomly.',
    steps: [
      'Groups tab: create one group per role (front, back, movers, strobes).',
      'Drag fixtures into them.',
      'Drive the group at once in scenes, chasers and EFX.',
    ],
    tips: [
      'One fixture can live in several groups (front + all).',
      'Name like you talk at FOH: “front”, “back”, “strobes”.',
    ],
    challenge: 'Create a “front” group and blink it from a scene.',
  },
  {
    id: 'scenes',
    group: 'Setup',
    emoji: '🎬',
    title: 'Scenes: your frozen looks',
    pitch: 'One scene = one full fixture state. It is the brick of everything else.',
    steps: [
      'Scenes tab: new scene, set dimmer/colors/positions.',
      'Dial fade in/out and duration (0 = infinite, stays on).',
      'Right-click a scene: Rename, Edit, Duplicate.',
      'Edit lights the beams so you adjust while seeing — preview holds while you edit.',
    ],
    tips: [
      'Duplicate instead of starting over: 80% of looks look alike.',
      'Duration 0 = infinite hold: perfect for working, avoid in endless chasers.',
    ],
    challenge: 'Create “Red front”: red washes at 100%, everything else dark.',
  },
  {
    id: 'chasers',
    group: 'Setup',
    emoji: '🏃',
    title: 'Chasers: chaining scenes',
    pitch: 'A chaser plays scenes in a loop: chases, waves, rhythmic strobes.',
    steps: [
      'Chasers tab: new one, add scenes as steps.',
      'Set order, speed and direction (forward, backward, ping-pong).',
      'Test: it loops until stopped.',
    ],
    tips: [
      'A tight 2-step chaser beats a messy 12-step one.',
      'Speed at track BPM = chaser breathing with the music.',
    ],
    challenge: 'A clean 2-step (red/blue) chaser at 120 BPM.',
  },
  {
    id: 'cuelists',
    group: 'Setup',
    emoji: '📋',
    title: 'Cue Lists: GO-button cueing',
    pitch: 'Theater, one-man shows, ceremonies: each GO press fires the next cue.',
    steps: [
      'Cue Lists tab: new list, stack scenes and chasers.',
      'Set manual GO or follow (auto-chain after duration).',
      'Live: one button, no 3am improv.',
    ],
    tips: [
      'Number and name each cue like your script (“Q12 - finale”).',
      'Follow for timed transitions, manual GO whenever a human speaks.',
    ],
    challenge: 'A 3-cue list played on GO without a miss.',
  },
  {
    id: 'rgb-matrix',
    group: 'Setup',
    emoji: '🟧',
    title: 'RGB Matrix',
    pitch: 'Turn your PARs into a giant screen: running lines, circles, diamonds.',
    steps: [
      'RGB Matrix tab: draw your matrix (rows/columns).',
      'Pick a pattern: line, circle, diamond, square, triangle.',
      'Launch: the pattern runs, on-beat if audio-reactive.',
    ],
    tips: [
      'Order the matrix as seen from the audience, or patterns run backwards.',
      'Slower = more readable. A slow chase reads, a fast one smears.',
    ],
    challenge: 'A clockwise circle on 4 PARs.',
  },
  {
    id: 'efx',
    group: 'Setup',
    emoji: '🌀',
    title: 'EFX: parametric movement',
    pitch: 'Circles, 8s, squares, waves: clean movement without step programming.',
    steps: [
      'EFX tab: new effect, pick a pattern (circle, 8, square, triangle…).',
      'Set width, height, speed, rotation.',
      'Link it to a scene: the scene plays static + continuous wave.',
    ],
    tips: [
      'Small amplitude + slow speed = class. Big + fast = carnival.',
      'Test on the floor first: too wide a circle ends in the audience.',
    ],
    challenge: 'A slow 8 on 2 movers, 30 seconds hands-off.',
  },
  {
    id: 'vue-2d',
    group: 'Setup',
    emoji: '🗺️',
    title: '2D View: the stage plot',
    pitch: 'Place your fixtures like in real life: 3D and movement follow.',
    steps: [
      '2D View tab: drag each fixture to its place (truss, floor, sides).',
      'Set orientation: audience front, back, side.',
      '3D View and beams follow this plot.',
    ],
    tips: [
      'A wrong plot = beams going nowhere in 3D.',
      'Update the plot at every venue change.',
    ],
    challenge: 'Reproduce your last real rig in 2D.',
  },
  {
    id: 'programmeur',
    group: 'Setup',
    emoji: '🟣',
    title: 'Programmer: live before saving',
    pitch: 'Purple means unsaved live. The programmer tries, the scene keeps.',
    steps: [
      'Touch channels: they go live (purple) without touching scenes.',
      'Like it? Store to a scene (new or existing).',
      'Hate it? Clear: back to programmed state.',
    ],
    tips: [
      'Never Store without looking at what is purple: you would save garbage.',
      'The programmer wins over almost everything: if it is full, nothing else passes.',
    ],
    challenge: 'Build a look in the programmer, Store it as a new scene, Clear.',
  },
  {
    id: 'console',
    group: 'Performance',
    emoji: '🎛️',
    title: 'Virtual Console: your live tiles',
    pitch: 'Your buttons and scenes, big and stress-clickable: your personal console.',
    steps: [
      'Performance mode: add buttons (scenes, chasers, blackout) on the canvas.',
      'Drag/resize. Right-click: configure, delete.',
      'Organize in pages (e.g. one per track) and switch via tabs.',
      'Live: one press = toggle, except flash (held = momentary).',
    ],
    tips: [
      'Big tiles for panic actions (huge blackout, bottom right).',
      'One page per track + one “backup” page: blackout, full, strobe.',
    ],
    challenge: 'A 4-tile page: 2 scenes + 1 chaser + 1 giant blackout.',
  },
  {
    id: 'curseurs',
    group: 'Performance',
    emoji: '🎚️',
    title: 'Faders: Grand Master and DMX channel',
    pitch: 'Two vital faders: the overall light volume, and one direct channel.',
    steps: [
      'Add a slider, Grand Master function: 0 = total black, 255 = all.',
      'Add a Channel slider: pick universe + address + value.',
      'Live, Grand Master dims everything without touching scenes.',
    ],
    tips: [
      'Grand Master at 80% during soundcheck: headroom for the show.',
      'A channel slider on a backup dimmer saves you when a scene derails.',
    ],
    challenge: 'Dim an ongoing show mid-way using Grand Master only.',
  },
  {
    id: 'midi',
    group: 'Performance',
    emoji: '🎹',
    title: 'MIDI: Learn + following LEDs',
    pitch: 'Map your controller once: pads, faders, and LEDs reflecting real state.',
    steps: [
      'Open MIDI mapping: move a control → click an action → mapped.',
      'Mapped buttons switch like tiles.',
      'LED feedback mirrors state: lit pad = truly active tile.',
    ],
    tips: [
      'Map blackout + 4 scenes first: the rest is bonus.',
      'If an LED lies, the mapping is wrong, not the tile.',
    ],
    challenge: 'Map 2 pads (scene on/off) + 1 fader (Grand Master).',
  },
  {
    id: 'distance',
    group: 'Performance',
    emoji: '📡',
    title: 'Remote: OSC, Timecode, web remote',
    pitch: 'Drive from a tablet, a sequencer or an audio desk: lights follow.',
    steps: [
      'OSC: receive TouchOSC/Lemur over the network (same actions as MIDI).',
      'Timecode (MTC): fire cues on sequencer time.',
      'Web remote: start the server, scan the URL on your phone — same network required.',
    ],
    tips: [
      'Test the venue Wi-Fi BEFORE: a saturated network = lost orders.',
      'Remote stays local: never exposed to the internet, by design.',
    ],
    challenge: 'Fire a scene from your phone via Remote.',
  },
  {
    id: 'licence',
    group: 'Account',
    emoji: '🔑',
    title: 'Account & License: free, Standard, Full',
    pitch: 'Free: 1 fixture, 1 universe. Standard (€69): unlimited fixtures. Full (€99): everything unlimited. Perpetual, never a subscription.',
    steps: [
      'Top right: version badge + Sign in button.',
      'Create your account (confirmation email), sign in.',
      'Buy from the modal: Standard €69 or Full €99, Stripe payment.',
      'After purchase: sign back in to activate. Offline after that: no worry.',
    ],
    tips: [
      'Sign in once BEFORE going off-grid.',
      'Never sign out live: offline = back to free.',
    ],
    challenge: 'Create your account and find your version badge.',
  },
];
