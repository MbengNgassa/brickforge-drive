import './style.css';
import { registerSW } from 'virtual:pwa-register';
import {
  CATEGORIES,
  COLORS,
  PARTS,
  PARTS_MAP,
  calculateVehicleStats,
} from './catalog';
import { STARTER_BLUEPRINTS, cloneBlueprint, makeUid } from './blueprints';
import { getPartIconSvg } from './partIcons';
import { GraphicsEngine } from './engine';
import { GarageController } from './garage';
import { GameWorldController } from './gameWorld';
import { sound } from './audio';
import {
  deleteSavedVehicle,
  loadActiveVehicle,
  loadSavedVehicles,
  saveActiveVehicle,
  saveCustomVehicle,
} from './storage';
import type { BrickCategory, GameMode, GraphicsQuality, HudState, VehicleBlueprint } from './types';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

// Register Service Worker so the app installs locally & works 100% offline!
registerSW({ immediate: true });

class BrickForgeApp {
  private root: HTMLElement;
  private engine!: GraphicsEngine;
  private garage!: GarageController;
  private world!: GameWorldController;

  private mode: GameMode = 'garage';
  private activeCategory: BrickCategory = 'bricks';
  private activeBlueprint: VehicleBlueprint = loadActiveVehicle();
  private savedVehicles: VehicleBlueprint[] = loadSavedVehicles();

  private deferredInstallPrompt: BeforeInstallPromptEvent | null = null;
  private isInstalledStandalone = false;
  private showTouchControls: 'auto' | 'on' | 'off' = 'auto';
  private isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

  // Garage UX state
  private dockCollapsed = false;
  private showMobileSpecs = false;
  private coachDismissed = false;

  private lastTime = performance.now();
  private fpsAccum = 0;
  private fpsFrames = 0;
  private currentFps = 60;
  private finishModalShown = false;

  // DOM References
  private garageUi!: HTMLElement;
  private driveUi!: HTMLElement;
  private modalHost!: HTMLElement;
  private touchLayer!: HTMLElement;

  constructor() {
    this.root = document.getElementById('app')!;
    this.isInstalledStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      Boolean((window.navigator as unknown as { standalone?: boolean }).standalone);

    try {
      const savedTouch = localStorage.getItem('brickforge_touch');
      if (savedTouch === 'on' || savedTouch === 'off' || savedTouch === 'auto') {
        this.showTouchControls = savedTouch;
      }
    } catch {
      // ignore
    }

    this.setupPwaInstallHook();
    this.buildDomSkeleton();

    const viewport = document.getElementById('viewport')!;
    this.engine = new GraphicsEngine(viewport);
    this.garage = new GarageController(this.engine, () => this.onGarageStateChanged());
    this.world = new GameWorldController(this.engine);

    this.enterGarage();
    requestAnimationFrame(this.loop);
  }

  private setupPwaInstallHook(): void {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.deferredInstallPrompt = e as BeforeInstallPromptEvent;
      this.updateInstallButton();
    });
    window.addEventListener('appinstalled', () => {
      this.deferredInstallPrompt = null;
      this.isInstalledStandalone = true;
      this.updateInstallButton();
    });
  }

  private buildDomSkeleton(): void {
    this.root.innerHTML = `
      <div id="viewport"></div>

      <!-- GARAGE BUILDER UI (Mobile-first unobstructed 3D stage) -->
      <div id="garage-ui" class="ui-layer">
        <header class="top-bar">
          <div class="panel brand-group interactive">
            <div class="brand-logo">
              <div class="brand-mark"><span></span><span></span><span></span><span></span></div>
              <h1 class="brand-title">BrickForge</h1>
            </div>
            <input id="vehicle-name" class="vehicle-name-input desktop-only" type="text" maxlength="24" aria-label="Vehicle Name" />
            <span id="brick-counter" class="brick-counter">0 / 250</span>
          </div>

          <div class="panel launch-group desktop-only interactive">
            <button id="btn-play-race" class="btn btn-primary" title="Race your custom vehicle in Red Rock Canyon">
              🏁 Race Canyon
            </button>
            <button id="btn-play-derby" class="btn btn-danger" title="Smash rival brick vehicles in the Demolition Bowl">
              💥 Destruction Derby
            </button>
            <button id="btn-play-freeroam" class="btn btn-cyan" title="Open Stunt Park test drive">
              🚀 Test Drive
            </button>
          </div>

          <div class="panel util-group interactive">
            <button id="btn-blueprints" class="btn" title="Switch cars & saved builds">🚗 Cars</button>
            <button id="btn-undo" class="btn btn-icon" title="Undo (Ctrl+Z)">↶</button>
            <button id="btn-redo" class="btn btn-icon desktop-only" title="Redo (Ctrl+Y)">↷</button>
            <button id="btn-install" class="btn btn-cyan desktop-only" title="Install BrickForge locally">⬇ Install</button>
            <button id="btn-settings" class="btn btn-icon" title="Graphics, Audio & Help">⚙</button>
            <button id="btn-play-sheet" class="btn btn-primary mobile-only" title="Race or Smash your car!">▶ PLAY</button>
          </div>
        </header>

        <!-- Wide-open center viewport -->
        <div class="garage-middle">
          <div id="garage-coach" class="coach-pill interactive">
            <span id="coach-text">Tap the car to snap a brick • Drag to spin</span>
            <button id="coach-close" class="coach-close" aria-label="Dismiss tip">✕</button>
          </div>

          <aside class="panel stats-card interactive" id="stats-card"></aside>
        </div>

        <!-- Bottom Workspace: Nudge Strip + Compact Action Strip + Collapsible Visual Brick Dock -->
        <div class="garage-bottom-stack">
          <div id="nudge-strip" class="panel nudge-strip interactive">
            <span id="nudge-label" class="nudge-label">Slide</span>
            <button id="nudge-left" class="nudge-btn" title="Move left (←)">◄</button>
            <button id="nudge-fwd" class="nudge-btn" title="Move forward (↑)">▲</button>
            <button id="nudge-back" class="nudge-btn" title="Move back (↓)">▼</button>
            <button id="nudge-right" class="nudge-btn" title="Move right (→)">►</button>
            <span class="nudge-sep"></span>
            <button id="nudge-up" class="nudge-btn tall" title="Raise 1 plate (E)">⬆ Up</button>
            <button id="nudge-down" class="nudge-btn tall" title="Lower 1 plate (Q)">⬇ Dn</button>
            <button id="nudge-delete" class="nudge-btn danger hidden" title="Delete selected brick (Del)">🗑</button>
          </div>

          <div class="panel action-strip interactive">
            <button id="tool-snap" class="btn btn-green" title="Snap the green preview brick onto the car (Enter)">✓ Snap</button>
            <button id="tool-place" class="btn btn-active" title="Add bricks (1)">+ Build</button>
            <button id="tool-move" class="btn" title="Select &amp; move placed bricks (2)">✋ Move</button>
            <button id="tool-paint" class="btn" title="Paint existing bricks (3)">🎨 Paint</button>
            <button id="tool-erase" class="btn" title="Remove bricks (4)">✕ Erase</button>
            <button id="tool-rotate" class="btn" title="Rotate brick 90° (R)">↻ Turn</button>
            <button id="tool-mirror" class="btn" title="Mirror left/right symmetry (M)">⇄ Mirror</button>
            <button id="tool-recenter" class="btn btn-icon" title="Center camera on car">🎯</button>
            <button id="tool-specs" class="btn mobile-only" title="Show vehicle stats">📊</button>
            <button id="tool-clear" class="btn" title="Start from bare chassis">⟲ New</button>
            <button id="tool-toggle-dock" class="btn" title="Hide or show brick tray">▼ Hide</button>
          </div>

          <footer id="brick-dock" class="panel brick-dock interactive">
            <div class="dock-top-row">
              <div id="category-tabs" class="category-tabs"></div>
              <div id="color-palette" class="color-palette"></div>
            </div>
            <div id="parts-strip" class="parts-strip"></div>
          </footer>
        </div>
      </div>

      <!-- DRIVING / RACING / DERBY HUD -->
      <div id="drive-ui" class="ui-layer hidden">
        <div class="hud-top">
          <div class="panel hud-primary-box" id="hud-primary-box"></div>

          <div class="hud-right-stack">
            <div class="panel hud-actions interactive">
              <button id="hud-btn-cam" class="btn" title="Switch Camera (C)">🎥 Cam</button>
              <button id="hud-btn-reset" class="btn" title="Reset Vehicle (R)">⟲ Reset</button>
              <button id="hud-btn-settings" class="btn btn-icon" title="Settings">⚙</button>
              <button id="hud-btn-garage" class="btn btn-primary" title="Back to Garage">🔧 Garage</button>
            </div>
            <div class="panel minimap-wrap">
              <canvas id="minimap-canvas" width="128" height="128"></canvas>
            </div>
            <div id="fps-pill" class="fps-pill">60 FPS • ULTRA GPU</div>
          </div>
        </div>

        <div class="hud-center">
          <div id="countdown-num" class="countdown-num hidden"></div>
          <div id="event-banner" class="event-banner hidden"></div>
        </div>

        <div class="hud-bottom">
          <div class="panel telemetry-panel">
            <div class="speed-readout">
              <span id="hud-speed" class="speed-num">0</span>
              <span class="speed-unit">KM/H</span>
            </div>
            <div class="bars-cluster">
              <div class="hud-bar-row">
                <div class="hud-bar-header">
                  <span>Plasma Boost</span>
                  <span id="hud-boost-val">100%</span>
                </div>
                <div class="hud-bar-track">
                  <div id="hud-boost-bar" class="hud-bar-fill boost" style="width:100%"></div>
                </div>
              </div>
              <div class="hud-bar-row">
                <div class="hud-bar-header">
                  <span id="hud-hp-label">Integrity</span>
                  <span id="hud-bricks-val">0/0 Bricks</span>
                </div>
                <div class="hud-bar-track">
                  <div id="hud-hp-bar" class="hud-bar-fill hp" style="width:100%"></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- MOBILE TOUCH CONTROLS -->
      <div id="touch-controls" class="touch-controls hidden">
        <div class="touch-cluster">
          <button class="touch-btn" data-touch="left">◄</button>
          <button class="touch-btn" data-touch="right">►</button>
          <button class="touch-btn brake" data-touch="drift">DRIFT</button>
        </div>
        <div class="touch-cluster">
          <button class="touch-btn brake" data-touch="brake">REV</button>
          <button class="touch-btn boost" data-touch="boost">JET</button>
          <button class="touch-btn gas" data-touch="gas">GAS</button>
        </div>
      </div>

      <!-- MODAL HOST -->
      <div id="modal-host"></div>
    `;

    this.garageUi = document.getElementById('garage-ui')!;
    this.driveUi = document.getElementById('drive-ui')!;
    this.modalHost = document.getElementById('modal-host')!;
    this.touchLayer = document.getElementById('touch-controls')!;

    this.bindStaticUiEvents();
  }

  private bindStaticUiEvents(): void {
    const nameInput = document.getElementById('vehicle-name') as HTMLInputElement;
    nameInput.addEventListener('input', () => {
      this.activeBlueprint.name = nameInput.value.trim() || 'Custom Build';
      this.persistCurrentBuild();
    });

    document.getElementById('btn-play-race')!.addEventListener('click', () => this.launchMode('race'));
    document.getElementById('btn-play-derby')!.addEventListener('click', () => this.launchMode('derby', 1));
    document.getElementById('btn-play-freeroam')!.addEventListener('click', () => this.launchMode('freeroam'));
    document.getElementById('btn-play-sheet')!.addEventListener('click', () => this.openPlaySheetModal());

    document.getElementById('btn-blueprints')!.addEventListener('click', () => this.openBlueprintsModal());
    document.getElementById('btn-undo')!.addEventListener('click', () => this.garage.undo());
    document.getElementById('btn-redo')!.addEventListener('click', () => this.garage.redo());
    document.getElementById('btn-install')!.addEventListener('click', () => this.handleInstallClick());
    document.getElementById('btn-settings')!.addEventListener('click', () => this.openSettingsModal());

    document.getElementById('coach-close')!.addEventListener('click', () => {
      this.coachDismissed = true;
      document.getElementById('garage-coach')!.classList.add('hidden');
    });

    document.getElementById('tool-snap')!.addEventListener('click', () => {
      this.garage.placeCurrentPreview();
    });
    document.getElementById('tool-place')!.addEventListener('click', () => this.garage.setTool('place'));
    document.getElementById('tool-move')!.addEventListener('click', () => this.garage.setTool('move'));
    document.getElementById('tool-paint')!.addEventListener('click', () => this.garage.setTool('paint'));
    document.getElementById('tool-erase')!.addEventListener('click', () => this.garage.setTool('erase'));
    document.getElementById('tool-rotate')!.addEventListener('click', () => this.garage.rotatePart());
    document.getElementById('tool-mirror')!.addEventListener('click', () => this.garage.toggleMirror());

    // Nudge D-Pad controls (work during placement preview AND after placing in Move mode!)
    document.getElementById('nudge-left')!.addEventListener('click', () => this.garage.nudge(-1, 0, 0));
    document.getElementById('nudge-right')!.addEventListener('click', () => this.garage.nudge(1, 0, 0));
    document.getElementById('nudge-fwd')!.addEventListener('click', () => this.garage.nudge(0, 1, 0));
    document.getElementById('nudge-back')!.addEventListener('click', () => this.garage.nudge(0, -1, 0));
    document.getElementById('nudge-up')!.addEventListener('click', () => this.garage.nudge(0, 0, 1));
    document.getElementById('nudge-down')!.addEventListener('click', () => this.garage.nudge(0, 0, -1));
    document.getElementById('nudge-delete')!.addEventListener('click', () => this.garage.deleteSelected());
    document.getElementById('tool-recenter')!.addEventListener('click', () => {
      this.garage.recenterCamera();
      sound.playUiTick();
    });
    document.getElementById('tool-specs')!.addEventListener('click', () => {
      this.showMobileSpecs = !this.showMobileSpecs;
      document.getElementById('stats-card')!.classList.toggle('mobile-open', this.showMobileSpecs);
      document.getElementById('tool-specs')!.classList.toggle('btn-active', this.showMobileSpecs);
      sound.playUiTick();
    });
    document.getElementById('tool-clear')!.addEventListener('click', () => {
      this.garage.clearToChassis();
      this.garage.recenterCamera();
    });
    document.getElementById('tool-toggle-dock')!.addEventListener('click', () => {
      this.dockCollapsed = !this.dockCollapsed;
      document.getElementById('brick-dock')!.classList.toggle('hidden', this.dockCollapsed);
      document.getElementById('tool-toggle-dock')!.textContent = this.dockCollapsed ? '▲ Bricks' : '▼ Hide';
      sound.playUiTick();
    });

    // Drive HUD buttons
    document.getElementById('hud-btn-cam')!.addEventListener('click', () => this.world.cycleCamera());
    document.getElementById('hud-btn-reset')!.addEventListener('click', () => this.world.resetPlayerPosition());
    document.getElementById('hud-btn-settings')!.addEventListener('click', () => this.openSettingsModal());
    document.getElementById('hud-btn-garage')!.addEventListener('click', () => this.enterGarage());

    // Multi-touch buttons for mobile driving
    const touchBtns = this.touchLayer.querySelectorAll<HTMLButtonElement>('[data-touch]');
    touchBtns.forEach((btn) => {
      const key = btn.dataset.touch as keyof typeof this.world.touchInput;
      const setPressed = (val: boolean) => {
        this.world.touchInput[key] = val;
        btn.classList.toggle('pressed', val);
      };
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        btn.setPointerCapture(e.pointerId);
        setPressed(true);
      });
      btn.addEventListener('pointerup', () => setPressed(false));
      btn.addEventListener('pointercancel', () => setPressed(false));
      btn.addEventListener('lostpointercapture', () => setPressed(false));
    });
  }

  private openPlaySheetModal(): void {
    sound.playUiTick();
    const stats = calculateVehicleStats(this.activeBlueprint.bricks);
    this.showModal(`
      <div class="panel modal-card interactive">
        <div class="modal-header">
          <h2 class="modal-title">Drive "${this.escapeHtml(this.activeBlueprint.name)}"</h2>
          <button class="btn btn-icon" data-close-modal>✕</button>
        </div>
        <div style="font-size:12px;color:#9aa7b8">
          ${stats.brickCount} bricks • Speed ${stats.topSpeed} • Armor ${stats.armor} • Ram ${stats.ramPower}
        </div>
        <div class="play-mode-list">
          <button id="sheet-race" class="play-mode-card race">
            <span class="play-mode-icon">🏁</span>
            <div>
              <strong>Red Rock Canyon Race</strong>
              <span>3-lap circuit with boost pads, jump ramps &amp; 5 AI brick racers</span>
            </div>
          </button>
          <button id="sheet-derby" class="play-mode-card derby">
            <span class="play-mode-icon">💥</span>
            <div>
              <strong>Mega Destruction Derby</strong>
              <span>Giant coliseum arena • 8 badass rivals • brick-by-brick smashing!</span>
            </div>
          </button>
          <button id="sheet-freeroam" class="play-mode-card stunt">
            <span class="play-mode-icon">🚀</span>
            <div>
              <strong>Mega Stunt Park Test</strong>
              <span>Huge stadium bowl with 8 mega-ramps &amp; boost pads to test builds</span>
            </div>
          </button>
        </div>
      </div>
    `);

    document.getElementById('sheet-race')?.addEventListener('click', () => this.launchMode('race'));
    document.getElementById('sheet-derby')?.addEventListener('click', () => this.launchMode('derby', 1));
    document.getElementById('sheet-freeroam')?.addEventListener('click', () => this.launchMode('freeroam'));
  }

  private updateInstallButton(): void {
    const btn = document.getElementById('btn-install')!;
    if (this.isInstalledStandalone) {
      btn.classList.add('hidden');
    } else {
      btn.classList.remove('hidden');
      btn.textContent = this.deferredInstallPrompt ? '⬇ Install App' : '⬇ Install';
    }
  }

  private async handleInstallClick(): Promise<void> {
    sound.playUiTick();
    if (this.deferredInstallPrompt) {
      await this.deferredInstallPrompt.prompt();
      const choice = await this.deferredInstallPrompt.userChoice;
      if (choice.outcome === 'accepted') {
        this.deferredInstallPrompt = null;
        this.updateInstallButton();
      }
      return;
    }

    this.showModal(`
      <div class="panel modal-card interactive">
        <div class="modal-header">
          <h2 class="modal-title">Install BrickForge Drive Locally</h2>
          <button class="btn btn-icon" data-close-modal>✕</button>
        </div>
        <p style="margin:0;font-size:13px;color:#cbd5e1;line-height:1.5">
          BrickForge Drive is an offline-ready Progressive Web App that runs directly on your device's GPU.
        </p>
        <div class="setting-row">
          <div class="setting-info">
            <strong>Android (Chrome / Edge / Samsung Internet)</strong>
            <span>Tap the browser menu (⋮) → <b>"Install app"</b> or <b>"Add to Home screen"</b>.</span>
          </div>
        </div>
        <div class="setting-row">
          <div class="setting-info">
            <strong>iPhone / iPad (Safari)</strong>
            <span>Tap the <b>Share</b> button (□↑) → scroll down and tap <b>"Add to Home Screen"</b>.</span>
          </div>
        </div>
        <div class="setting-row">
          <div class="setting-info">
            <strong>Windows / Mac / Linux (Chrome / Edge)</strong>
            <span>Click the <b>Install icon</b> in the address bar to launch in a standalone window.</span>
          </div>
        </div>
        <div style="display:flex;justify-content:flex-end">
          <button class="btn btn-primary" data-close-modal>Got It</button>
        </div>
      </div>
    `);
  }

  private enterGarage(): void {
    this.closeModal();
    if (this.mode !== 'garage') {
      this.world.exit();
    }
    this.mode = 'garage';
    this.garageUi.classList.remove('hidden');
    this.driveUi.classList.add('hidden');
    this.touchLayer.classList.add('hidden');

    (document.getElementById('vehicle-name') as HTMLInputElement).value = this.activeBlueprint.name;
    this.garage.enter(this.activeBlueprint);
    this.renderCategoryTabs();
    this.renderColorPalette();
    this.renderPartsStrip();
    this.onGarageStateChanged();
    this.updateInstallButton();
  }

  private launchMode(targetMode: Exclude<GameMode, 'garage'>, wave = 1): void {
    this.closeModal();
    this.persistCurrentBuild();

    const stats = calculateVehicleStats(this.activeBlueprint.bricks);
    if (stats.brickCount < 2) {
      this.showModal(`
        <div class="panel modal-card finish-card interactive">
          <div class="finish-badge">Add More Bricks!</div>
          <div class="finish-sub">Place a chassis and wheels before rolling out onto the track.</div>
          <button class="btn btn-primary" data-close-modal>Back to Garage</button>
        </div>
      `);
      return;
    }

    if (this.mode === 'garage') {
      this.garage.exit();
    } else {
      this.world.exit();
    }

    this.mode = targetMode;
    this.finishModalShown = false;
    this.garageUi.classList.add('hidden');
    this.driveUi.classList.remove('hidden');
    this.updateTouchVisibility();

    this.world.minimapCanvas = document.getElementById('minimap-canvas') as HTMLCanvasElement;
    this.world.enter(targetMode, this.activeBlueprint, wave);
    sound.playUiTick();
  }

  private updateTouchVisibility(): void {
    const shouldShow =
      this.mode !== 'garage' &&
      (this.showTouchControls === 'on' || (this.showTouchControls === 'auto' && this.isTouchDevice));
    this.touchLayer.classList.toggle('hidden', !shouldShow);
  }

  private persistCurrentBuild(): void {
    if (this.mode === 'garage') {
      this.activeBlueprint = {
        ...this.activeBlueprint,
        bricks: this.garage.getBricks(),
      };
    }
    saveActiveVehicle(this.activeBlueprint);
  }

  private updateCoachBanner(): void {
    const coachEl = document.getElementById('garage-coach')!;
    if (this.coachDismissed) {
      coachEl.classList.add('hidden');
      return;
    }
    coachEl.classList.remove('hidden');
    const textEl = document.getElementById('coach-text')!;
    const partName = PARTS_MAP[this.garage.activePartId]?.shortName || 'Brick';

    if (this.garage.activeTool === 'move') {
      const sel = this.garage.getSelectedBrick();
      const selName = sel ? PARTS_MAP[sel.partId]?.shortName || 'Brick' : null;
      textEl.innerHTML = selName
        ? `<b>Move [${selName}]:</b> Use <b>◄ ▲ ▼ ► ⬆ ⬇</b> arrows, <b>↻ Turn</b>, or tap another brick`
        : `<b>Move Mode:</b> Tap any brick on your car to select &amp; move it`;
    } else if (this.garage.activeTool === 'paint') {
      textEl.innerHTML = `<b>Paint Mode:</b> Tap any brick on the car to recolor it`;
    } else if (this.garage.activeTool === 'erase') {
      textEl.innerHTML = `<b>Erase Mode:</b> Tap any brick on the car to remove it`;
    } else if (this.garage.placedCountSession === 0) {
      textEl.innerHTML = `<b>Build:</b> Position <b>${partName}</b> with <b>◄▲▼►⬆⬇</b> then tap <b>✓ Snap</b> (or tap car)`;
    } else {
      textEl.innerHTML = `<b>${partName}</b> ready • Tap car or <b>✓ Snap</b> • Tap <b>✋ Move</b> to adjust placed bricks`;
    }
  }

  private onGarageStateChanged(): void {
    if (this.mode !== 'garage') return;
    this.persistCurrentBuild();

    const stats = calculateVehicleStats(this.activeBlueprint.bricks);
    document.getElementById('brick-counter')!.textContent = `${stats.brickCount} / ${stats.maxBricks}`;
    (document.getElementById('btn-undo') as HTMLButtonElement).disabled = !this.garage.canUndo();
    (document.getElementById('btn-redo') as HTMLButtonElement).disabled = !this.garage.canRedo();

    // Tool active states & Nudge Strip visibility
    const isPlace = this.garage.activeTool === 'place';
    const isMove = this.garage.activeTool === 'move';
    document.getElementById('tool-snap')!.classList.toggle('hidden', !isPlace);
    document.getElementById('tool-place')!.classList.toggle('btn-active', isPlace);
    document.getElementById('tool-move')!.classList.toggle('btn-active', isMove);
    document.getElementById('tool-paint')!.classList.toggle('btn-active', this.garage.activeTool === 'paint');
    document.getElementById('tool-erase')!.classList.toggle('btn-active', this.garage.activeTool === 'erase');

    const nudgeStrip = document.getElementById('nudge-strip')!;
    const showNudge = isPlace || (isMove && Boolean(this.garage.selectedBrickUid));
    nudgeStrip.classList.toggle('hidden', !showNudge);
    document.getElementById('nudge-label')!.textContent = isMove ? 'Move Brick' : 'Aim Brick';
    document.getElementById('nudge-delete')!.classList.toggle('hidden', !isMove);

    const mirrorBtn = document.getElementById('tool-mirror')!;
    mirrorBtn.textContent = this.garage.mirrorX ? '⇄ Mirror ON' : '⇄ Mirror';
    mirrorBtn.classList.toggle('btn-active', this.garage.mirrorX);

    this.updateCoachBanner();

    // Render Live Stats Card
    const statsCard = document.getElementById('stats-card')!;
    const rows = [
      { label: 'Top Speed', val: stats.topSpeed, color: '#38bdf8' },
      { label: 'Acceleration', val: stats.acceleration, color: '#f4be17' },
      { label: 'Handling', val: stats.handling, color: '#4ade80' },
      { label: 'Armor HP', val: stats.armor, color: '#fb923c' },
      { label: 'Ram Power', val: stats.ramPower, color: '#f87171' },
    ];
    statsCard.innerHTML = `
      <div class="stats-header">
        <span>${this.escapeHtml(this.activeBlueprint.name)}</span>
        <span>${stats.mass} kg</span>
      </div>
      ${rows
        .map(
          (r) => `
        <div class="stat-row">
          <div class="stat-label"><span>${r.label}</span><span>${r.val}</span></div>
          <div class="stat-track"><div class="stat-fill" style="width:${r.val}%;background:${r.color}"></div></div>
        </div>
      `
        )
        .join('')}
      ${
        stats.wheelCount < 2
          ? `<div class="stat-warning">Tip: Add wheels from the <b>Wheels</b> tab for full speed &amp; grip!</div>`
          : ''
      }
    `;

    this.renderPartsStrip();
    this.renderColorPalette();
  }

  private renderCategoryTabs(): void {
    const container = document.getElementById('category-tabs')!;
    container.innerHTML = CATEGORIES.map(
      (cat) => `
      <button class="cat-tab ${cat.id === this.activeCategory ? 'active' : ''}" data-cat="${cat.id}">
        ${cat.label}
      </button>
    `
    ).join('');

    container.querySelectorAll<HTMLButtonElement>('[data-cat]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.activeCategory = btn.dataset.cat as BrickCategory;
        this.renderCategoryTabs();
        this.renderPartsStrip();
        sound.playUiTick();
      });
    });
  }

  private renderColorPalette(): void {
    const container = document.getElementById('color-palette')!;
    container.innerHTML = COLORS.map(
      (c) => `
      <button
        class="color-swatch ${c.hex.toLowerCase() === this.garage.activeColor.toLowerCase() ? 'active' : ''}"
        style="background:${c.hex};${c.translucent ? 'opacity:0.78;border-style:dashed;' : ''}"
        title="${c.name}"
        data-hex="${c.hex}"
      ></button>
    `
    ).join('');

    container.querySelectorAll<HTMLButtonElement>('[data-hex]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.garage.setColor(btn.dataset.hex!);
      });
    });
  }

  private renderPartsStrip(): void {
    const container = document.getElementById('parts-strip')!;
    const filtered = PARTS.filter((p) => p.category === this.activeCategory);

    container.innerHTML = filtered
      .map((p) => {
        let badge = '';
        if (p.isThruster) badge = `<span class="part-badge">+BOOST</span>`;
        else if (p.ramBonus >= 10) badge = `<span class="part-badge ram">+RAM</span>`;
        else if (p.armorBonus >= 10) badge = `<span class="part-badge ram">+ARMOR</span>`;
        else if (p.gripBonus >= 4) badge = `<span class="part-badge grip">+GRIP</span>`;

        const active = p.id === this.garage.activePartId && this.garage.activeTool === 'place';
        const svg = getPartIconSvg(p.id, this.garage.activeColor);
        return `
          <button class="part-card ${active ? 'active' : ''}" data-part="${p.id}">
            <div class="part-thumb">${svg}${badge}</div>
            <div class="part-card-name">${p.shortName}</div>
            <div class="part-card-size">${p.w}×${p.d}</div>
          </button>
        `;
      })
      .join('');

    container.querySelectorAll<HTMLButtonElement>('[data-part]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.garage.setPart(btn.dataset.part as typeof this.garage.activePartId);
      });
    });
  }

  private openBlueprintsModal(): void {
    sound.playUiTick();
    this.savedVehicles = loadSavedVehicles();

    const savedHtml =
      this.savedVehicles.length > 0
        ? this.savedVehicles
            .map(
              (sv) => `
          <div class="bp-item">
            <div class="bp-item-title">${this.escapeHtml(sv.name)}</div>
            <div class="bp-item-desc">${sv.bricks.length} bricks • Saved custom build</div>
            <div class="bp-item-actions">
              <button class="btn btn-primary" data-load-saved="${sv.id}">Load</button>
              <button class="btn btn-danger" data-del-saved="${sv.id}">Delete</button>
            </div>
          </div>
        `
            )
            .join('')
        : `<div style="font-size:12px;color:#9aa7b8">No saved custom builds yet. Tap <b>Save Current Vehicle</b> above!</div>`;

    this.showModal(`
      <div class="panel modal-card interactive">
        <div class="modal-header">
          <h2 class="modal-title">Starter Cars &amp; Saved Builds</h2>
          <button class="btn btn-icon" data-close-modal>✕</button>
        </div>

        <div class="setting-row">
          <div class="setting-info" style="flex:1">
            <strong>Vehicle Name</strong>
            <input id="modal-vehicle-name" class="vehicle-name-input" style="width:100%;margin-top:4px" type="text" maxlength="24" value="${this.escapeHtml(this.activeBlueprint.name)}" />
          </div>
          <button id="btn-save-slot" class="btn btn-primary">💾 Save</button>
        </div>

        <div style="font-size:12px;font-weight:700;text-transform:uppercase;color:#9aa7b8;letter-spacing:0.06em">
          Starter Vehicles
        </div>
        <div class="blueprint-grid">
          ${STARTER_BLUEPRINTS.map(
            (bp) => `
            <div class="bp-item">
              <div class="bp-item-title">${bp.name}</div>
              <div class="bp-item-desc">${bp.tagline} (${bp.bricks.length} bricks)</div>
              <div class="bp-item-actions">
                <button class="btn btn-cyan" data-load-starter="${bp.id}">Load into Garage</button>
              </div>
            </div>
          `
          ).join('')}
        </div>

        <div style="font-size:12px;font-weight:700;text-transform:uppercase;color:#9aa7b8;letter-spacing:0.06em">
          Your Saved Builds
        </div>
        <div class="blueprint-grid">${savedHtml}</div>
      </div>
    `);

    const modalNameInput = document.getElementById('modal-vehicle-name') as HTMLInputElement | null;
    modalNameInput?.addEventListener('input', () => {
      this.activeBlueprint.name = modalNameInput.value.trim() || 'Custom Build';
      (document.getElementById('vehicle-name') as HTMLInputElement).value = this.activeBlueprint.name;
      this.persistCurrentBuild();
    });

    document.getElementById('btn-save-slot')?.addEventListener('click', () => {
      this.persistCurrentBuild();
      const toSave: VehicleBlueprint = {
        ...cloneBlueprint(this.activeBlueprint),
        id: makeUid('custom'),
      };
      this.savedVehicles = saveCustomVehicle(toSave);
      sound.playBrickSnap();
      this.openBlueprintsModal();
    });

    this.modalHost.querySelectorAll<HTMLButtonElement>('[data-load-starter]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const found = STARTER_BLUEPRINTS.find((s) => s.id === btn.dataset.loadStarter);
        if (found) {
          this.activeBlueprint = cloneBlueprint(found);
          (document.getElementById('vehicle-name') as HTMLInputElement).value = this.activeBlueprint.name;
          this.garage.loadBricks(this.activeBlueprint.bricks, true);
          this.garage.recenterCamera();
          this.garage.showAutoPreview();
          this.closeModal();
        }
      });
    });

    this.modalHost.querySelectorAll<HTMLButtonElement>('[data-load-saved]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const found = this.savedVehicles.find((s) => s.id === btn.dataset.loadSaved);
        if (found) {
          this.activeBlueprint = cloneBlueprint(found);
          (document.getElementById('vehicle-name') as HTMLInputElement).value = this.activeBlueprint.name;
          this.garage.loadBricks(this.activeBlueprint.bricks, true);
          this.garage.recenterCamera();
          this.garage.showAutoPreview();
          this.closeModal();
        }
      });
    });

    this.modalHost.querySelectorAll<HTMLButtonElement>('[data-del-saved]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.savedVehicles = deleteSavedVehicle(btn.dataset.delSaved!);
        this.openBlueprintsModal();
      });
    });
  }

  private openSettingsModal(): void {
    sound.playUiTick();
    if (this.mode !== 'garage') this.world.setPaused(true);

    const q = this.engine.getQuality();
    const muted = sound.isMuted();

    this.showModal(
      `
      <div class="panel modal-card interactive">
        <div class="modal-header">
          <h2 class="modal-title">Settings &amp; How to Build</h2>
          <button class="btn btn-icon" data-close-modal>✕</button>
        </div>

        <div class="setting-row">
          <div class="setting-info">
            <strong>Quick Garage Guide</strong>
            <span>1) Pick a brick &amp; color at the bottom. 2) Tap anywhere on the car to snap it on (or tap <b>✓ Snap</b>). 3) Drag with 1 finger to rotate, pinch to zoom. 4) Press <b>▶ PLAY</b> to Race or play Destruction Derby!</span>
          </div>
        </div>

        ${
          !this.isInstalledStandalone
            ? `<div class="setting-row">
                <div class="setting-info">
                  <strong>Install Local Offline App</strong>
                  <span>Run full-screen directly on your phone or PC</span>
                </div>
                <button id="btn-modal-install" class="btn btn-cyan">⬇ Install App</button>
              </div>`
            : ''
        }

        <div class="setting-row">
          <div class="setting-info">
            <strong>Hardware GPU Graphics</strong>
            <span>GPU: ${this.escapeHtml(this.engine.getGpuName())}</span>
          </div>
          <div style="display:flex;gap:5px">
            <button class="btn ${q === 'ultra' ? 'btn-active' : ''}" data-q="ultra">Ultra</button>
            <button class="btn ${q === 'high' ? 'btn-active' : ''}" data-q="high">High</button>
            <button class="btn ${q === 'balanced' ? 'btn-active' : ''}" data-q="balanced">Balanced</button>
          </div>
        </div>

        <div class="setting-row">
          <div class="setting-info">
            <strong>Sound Effects &amp; Engine</strong>
            <span>100% offline procedural Web Audio</span>
          </div>
          <button id="btn-toggle-audio" class="btn ${muted ? '' : 'btn-active'}">
            ${muted ? '🔇 Muted' : '🔊 On'}
          </button>
        </div>

        <div class="setting-row">
          <div class="setting-info">
            <strong>Driving Touch Controls</strong>
            <span>Auto-detects phones &amp; tablets</span>
          </div>
          <div style="display:flex;gap:5px">
            <button class="btn ${this.showTouchControls === 'auto' ? 'btn-active' : ''}" data-tc="auto">Auto</button>
            <button class="btn ${this.showTouchControls === 'on' ? 'btn-active' : ''}" data-tc="on">On</button>
            <button class="btn ${this.showTouchControls === 'off' ? 'btn-active' : ''}" data-tc="off">Off</button>
          </div>
        </div>

        <div style="display:flex;justify-content:flex-end">
          <button class="btn btn-primary" data-close-modal>Resume</button>
        </div>
      </div>
    `,
      () => {
        if (this.mode !== 'garage') this.world.setPaused(false);
      }
    );

    document.getElementById('btn-modal-install')?.addEventListener('click', () => this.handleInstallClick());

    this.modalHost.querySelectorAll<HTMLButtonElement>('[data-q]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const nextQ = btn.dataset.q as GraphicsQuality;
        this.engine.setQuality(nextQ);
        this.openSettingsModal();
      });
    });

    document.getElementById('btn-toggle-audio')?.addEventListener('click', () => {
      sound.toggleMute();
      this.openSettingsModal();
    });

    this.modalHost.querySelectorAll<HTMLButtonElement>('[data-tc]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.showTouchControls = btn.dataset.tc as 'auto' | 'on' | 'off';
        try {
          localStorage.setItem('brickforge_touch', this.showTouchControls);
        } catch {
          // ignore
        }
        this.updateTouchVisibility();
        this.openSettingsModal();
      });
    });
  }

  private showFinishModal(hud: HudState): void {
    const isNextWave = hud.mode === 'derby' && hud.won;
    this.showModal(`
      <div class="panel modal-card finish-card interactive">
        <div class="finish-badge ${hud.won ? '' : 'lost'}">${this.escapeHtml(hud.finishMessage)}</div>
        <div class="finish-sub">${this.escapeHtml(hud.finishSubtext)}</div>
        <div class="finish-actions">
          ${
            isNextWave
              ? `<button id="btn-next-wave" class="btn btn-danger">🔥 Launch Wave ${hud.wave + 1}</button>`
              : `<button id="btn-retry-mode" class="btn btn-primary">↻ Play Again</button>`
          }
          <button id="btn-back-garage" class="btn btn-cyan">🔧 Upgrade in Garage</button>
        </div>
      </div>
    `);

    document.getElementById('btn-next-wave')?.addEventListener('click', () => {
      this.launchMode('derby', hud.wave + 1);
    });
    document.getElementById('btn-retry-mode')?.addEventListener('click', () => {
      if (this.mode !== 'garage') this.launchMode(this.mode, 1);
    });
    document.getElementById('btn-back-garage')?.addEventListener('click', () => {
      this.enterGarage();
    });
  }

  private showModal(innerHtml: string, onClose?: () => void): void {
    this.modalHost.innerHTML = `<div class="modal-backdrop">${innerHtml}</div>`;
    const close = () => {
      this.closeModal();
      onClose?.();
    };
    this.modalHost.querySelectorAll('[data-close-modal]').forEach((el) => {
      el.addEventListener('click', close);
    });
  }

  private closeModal(): void {
    this.modalHost.innerHTML = '';
  }

  private updateDriveHud(hud: HudState): void {
    const primaryBox = document.getElementById('hud-primary-box')!;
    if (hud.mode === 'race') {
      const ord = ['1ST', '2ND', '3RD', '4TH', '5TH', '6TH'][Math.max(0, Math.min(5, hud.position - 1))];
      primaryBox.innerHTML = `
        <div class="hud-metric">
          <span class="hud-metric-label">Position</span>
          <span class="hud-metric-value gold">${ord} <small style="font-size:14px;color:#9aa7b8">/ ${hud.totalRacers}</small></span>
        </div>
        <div class="hud-metric">
          <span class="hud-metric-label">Lap</span>
          <span class="hud-metric-value">${hud.lap}/${hud.totalLaps}</span>
        </div>
        <div class="hud-metric">
          <span class="hud-metric-label">Next Gate</span>
          <span class="hud-metric-value cyan">${hud.waypointDist}m</span>
        </div>
      `;
    } else if (hud.mode === 'derby') {
      primaryBox.innerHTML = `
        <div class="hud-metric">
          <span class="hud-metric-label">Wave ${hud.wave}</span>
          <span class="hud-metric-value gold">${hud.aliveCount} Left</span>
        </div>
        <div class="hud-metric">
          <span class="hud-metric-label">KOs</span>
          <span class="hud-metric-value cyan">${hud.kos}</span>
        </div>
        <div class="hud-metric">
          <span class="hud-metric-label">Score</span>
          <span class="hud-metric-value">${hud.score.toLocaleString()}</span>
        </div>
      `;
    } else {
      primaryBox.innerHTML = `
        <div class="hud-metric">
          <span class="hud-metric-label">Mode</span>
          <span class="hud-metric-value cyan">Stunt Park</span>
        </div>
        <div class="hud-metric">
          <span class="hud-metric-label">Build</span>
          <span class="hud-metric-value">${this.escapeHtml(this.activeBlueprint.name)}</span>
        </div>
      `;
    }

    document.getElementById('hud-speed')!.textContent = String(hud.speedKmh);
    document.getElementById('hud-boost-val')!.textContent = `${hud.boost}%`;
    document.getElementById('hud-boost-bar')!.style.width = `${hud.boost}%`;

    const hpPct = hud.maxHp > 0 ? Math.round((hud.hp / hud.maxHp) * 100) : 0;
    const hpBar = document.getElementById('hud-hp-bar')!;
    hpBar.style.width = `${hpPct}%`;
    hpBar.classList.toggle('low', hpPct < 35);
    document.getElementById('hud-bricks-val')!.textContent = `${hud.bricksRemaining}/${hud.bricksTotal} Bricks`;

    const cdEl = document.getElementById('countdown-num')!;
    if (hud.countdown > 0) {
      cdEl.textContent = String(hud.countdown);
      cdEl.classList.remove('hidden');
    } else {
      cdEl.classList.add('hidden');
    }

    const bannerEl = document.getElementById('event-banner')!;
    if (hud.eventBanner) {
      bannerEl.textContent = hud.eventBanner;
      bannerEl.classList.remove('hidden');
    } else {
      bannerEl.classList.add('hidden');
    }

    document.getElementById('fps-pill')!.textContent = `${hud.fps} FPS • ${this.engine.getQuality().toUpperCase()} GPU`;

    if (hud.finished && !this.finishModalShown) {
      this.finishModalShown = true;
      this.showFinishModal(hud);
    }
  }

  private escapeHtml(str: string): string {
    return str.replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]!));
  }

  private loop = (now: number): void => {
    const dt = Math.min(0.05, Math.max(0.001, (now - this.lastTime) / 1000));
    this.lastTime = now;

    this.fpsAccum += dt;
    this.fpsFrames++;
    if (this.fpsAccum >= 0.5) {
      this.currentFps = Math.round(this.fpsFrames / this.fpsAccum);
      this.fpsAccum = 0;
      this.fpsFrames = 0;
    }

    if (this.mode === 'garage') {
      this.garage.update(dt);
    } else {
      const hud = this.world.update(dt, this.currentFps);
      this.updateDriveHud(hud);
    }

    this.engine.render();
    requestAnimationFrame(this.loop);
  };
}

new BrickForgeApp();
