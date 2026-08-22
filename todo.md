
Optamization in the characters where we have points but when camera see the characters and vehecle points to generate will generate else not. Also do same optamization with assets like buildings, trees, and other objects.


CPU vehecles will wiped out or hide while runnning in race and pedestrians fix it, no consistent pattern. cpu vehecles stops when come something infront of it - make it when vehecle mesh come infront will stop for 5 seconds.

Add Lights to vehicles, spread light infront of it, increase visibility in spots, enable in night. Add day cycle of 30 minutes as option.

Add waves in oceans and beaches, reaching the end of beaches waves.


fix the junction road foothpath upper part is not visible gray and visible in beneath the footpath.

pedestrians seem like translucent, increase its opacity.

Add clouds sfx in the sky and also sun and moon with stars at night.

Fix the lands where roads touchs with mountains vehecle stuck in to the road problem is with the mesh and physics.

Also in setting we can increase pedestrians and traffic density up to 50.

dont generate vehecle infront of the player.

On game press m to show the map, on race more will show the race track and opponent cars.

Think about achivements by doing race save data locally. After race we get tier of medel on getting 1,2 or 3 increase the bar from one medal to the next. medals are bronze, silver, gold, platinum, ruby, sapphire, diamond.

---

## 🎵 Comprehensive Procedural Audio & Music System Plan

### 1. 🏎️ Vehicle Sounds
- **Engine Sound (`src/audio/engine.js`)**:
  - 4-cylinder firing pulses, mechanical idle lope, load-dependent wave-shaping distortion under acceleration, and exhaust pipe resonance tracking engine `rpm` and `gear`.
- **Tire Squeal & Surface Friction (`src/audio/surface.js`)**:
  - Dual-mode tire screech with stick-slip amplitude modulation during drifting, high-G cornering, and handbrake turns.
  - Low-frequency rumble and stone scatter when driving off-road / on grass (`offRoad > 0`).
- **High-Speed Wind Roar (`src/audio/surface.js`)**:
  - Aerodynamic buffeting and rushing wind hiss scaling non-linearly with vehicle speed.
- **Crash & Impact Crunch (`src/audio/impact.js`)**:
  - Metal impact thud and crunch triggered on collisions (`p.lastImpact > 0.02`).
- **Vehicle Horn**:
  - Dual-tone automotive horn (440 Hz & 554 Hz tuned interval) on key `H` or touch trigger.

### 2. 🚶 Pedestrian & City Interaction
- Footstep scuffs when pedestrians walk.
- Startled pedestrian shouts / horns when a fast vehicle zooms closely past them (< 3.5m) or impacts them.

### 3. 🌅 Dynamic Time-of-Day & Location Ambience (`src/audio/ambience.js`)
- **Dawn (`timeOfDay` 0.00 – 0.15)**:
  - **Crows & Morning Birds**: Procedural `caw... caw...` and high-frequency morning chirps spaced naturally.
- **Day (`timeOfDay` 0.15 – 0.55)**:
  - **Daytime Wind & City Airflow**: Gentle warm breeze and open-air atmosphere.
- **Night (`timeOfDay` 0.60 – 0.95)**:
  - **Grasshoppers & Crickets**: Realistic high-pitch cricket chirping (`chirp... chirp...`) with rhythmic micro-tremolo bursts.
- **Beach & Coastline (`distFromCenter > 750m`)**:
  - **Ocean Surf**: 3-band wave simulation (low swell boom, continuous mid wash, and bright foam hiss).
  - **Seagulls**: Soaring gull calls near the shore.

### 4. 🎵 Procedural Synthwave / Lo-Fi Background Music (`src/audio/music.js`)
- 100% synthesized procedural music engine (zero external audio file downloads):
  - Punchy analog kick & snare drum rhythm.
  - Closed / open hi-hat patterns.
  - Warm synth bassline following driving chord progressions.
  - Dreamy retro polyphonic pads and melodic arpeggiator hooks.
- Seamless, non-fatiguing loop with multiple music styles (`CHILL DRIVE`, `RETRO SYNTH`, `OFF`).

### 5. ⚙️ Settings & Audio Controls (`src/main.js`)
- Settings menu options in `ESC` → `SETTINGS`:
  - `AUDIO VOLUME`: `100%`, `75%`, `50%`, `25%`, `MUTED`
  - `MUSIC`: `CHILL DRIVE`, `RETRO SYNTH`, `OFF`
- Automatic browser audio context unlocking on first touch / click gesture.
- Preferences saved to `localStorage`.
