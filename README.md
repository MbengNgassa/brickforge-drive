# BrickForge Drive

Build custom 3D interlocking brick vehicles piece by piece using hardware-accelerated WebGL2 graphics, then race them through Red Rock Canyon or smash rival brick cars in the Destruction Derby Arena. Designed as an installable, offline-first Progressive Web App (PWA).

## Highlights

- **3D Brick Garage Builder**: Authentic stud-grid face snapping with 3D green snap-target brackets, 27 interlocking vehicle parts (chassis plates, bricks, slopes, fenders, translucent windshields, seats, steering wheels, street/off-road/monster wheels, plasma jet thrusters, spike plows, heavy ram bumpers, titanium armor), 16 glossy ABS / metallic / translucent colors, mirror symmetry mode, paint & erase tools, 50-step Undo/Redo, and 5 starter blueprints.
- **Red Rock Canyon Circuit Race**: 3-lap desert canyon circuit with brick-built mesas, overhead gantries, boost pads, stunt ramps, drifting, plasma jet boost trails, minimap, and 5 AI brick racers with nameplates.
- **Destruction Derby Bowl Arena**: Wave-based demolition arena with **real brick-by-brick structural shattering** — high-speed impacts knock individual bricks loose into tumbling 3D debris until rivals explode! Includes front-ram damage multipliers, scatterable cones, Repair Wrench pickups, and Nitro Cores.
- **Full-GPU Graphics Engine**: WebGL2 hardware-accelerated Three.js renderer with PBR clearcoat ABS materials, `RoomEnvironment` IBL reflections, ACES Filmic tone mapping, 2048px soft shadows, and selective `UnrealBloomPass` post-processing (Ultra / High / Balanced presets).
- **100% Offline Installable PWA**: Procedural textures & procedural Web Audio synthesizer with Service Worker precaching — install directly from Chrome, Edge, Samsung Internet, or Safari onto Android, iOS, or Desktop.

## Local Development

```bash
npm install
npm run dev
```

## Production Build

```bash
npm run build
npm run preview
```

## Controls

| Action | Keyboard | Touch / Mobile |
| --- | --- | --- |
| Drive / Steer | `W A S D` or Arrow Keys | Bottom-left `◄ ►` & bottom-right `GAS / REV` |
| Plasma Boost | `Space` | `JET` button |
| Handbrake Drift | `Shift` | `DRIFT` button |
| Switch Camera | `C` | Top-right `Cam` button |
| Reset Vehicle | `R` | Top-right `Reset` button |
| Garage Rotate / Mirror | `R` / `M` | Right tool rail |
| Garage Undo / Redo | `Ctrl+Z` / `Ctrl+Y` | Top-right `↶ / ↷` |
