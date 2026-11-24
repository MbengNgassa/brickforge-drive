import type { BrickPartId } from './types';

/**
 * Generates crisp, color-matched isometric SVG preview thumbnails for every part
 * so users immediately recognize bricks, wheels, windshields, thrusters, and spike plows
 * without having to guess from text labels.
 */
export function getPartIconSvg(partId: BrickPartId, colorHex: string): string {
  const c = colorHex;
  // Slightly lighter / darker shade helpers via opacity overlays
  if (partId === 'wheel_street' || partId === 'wheel_offroad' || partId === 'wheel_monster') {
    const r = partId === 'wheel_monster' ? 21 : partId === 'wheel_offroad' ? 19 : 17;
    const treads =
      partId !== 'wheel_street'
        ? `<g stroke="#11151d" stroke-width="3" stroke-dasharray="4 4">
             <circle cx="32" cy="26" r="${r + 1}" fill="none"/>
           </g>`
        : '';
    return `<svg viewBox="0 0 64 52" class="part-svg" aria-hidden="true">
      ${treads}
      <circle cx="32" cy="26" r="${r}" fill="#1b202a" stroke="#394354" stroke-width="2.5"/>
      <circle cx="32" cy="26" r="${Math.round(r * 0.56)}" fill="${c}"/>
      <circle cx="32" cy="26" r="${Math.round(r * 0.24)}" fill="#2a3240"/>
      <line x1="32" y1="${26 - Math.round(r * 0.5)}" x2="32" y2="${26 + Math.round(r * 0.5)}" stroke="#e2e8f0" stroke-width="2"/>
      <line x1="${32 - Math.round(r * 0.45)}" y1="${26 - Math.round(r * 0.24)}" x2="${32 + Math.round(r * 0.45)}" y2="${26 + Math.round(r * 0.24)}" stroke="#e2e8f0" stroke-width="2"/>
      <line x1="${32 + Math.round(r * 0.45)}" y1="${26 - Math.round(r * 0.24)}" x2="${32 - Math.round(r * 0.45)}" y2="${26 + Math.round(r * 0.24)}" stroke="#e2e8f0" stroke-width="2"/>
    </svg>`;
  }

  if (partId === 'thruster_jet') {
    return `<svg viewBox="0 0 64 52" class="part-svg" aria-hidden="true">
      <polygon points="4,26 22,17 22,35" fill="#38e8ff" opacity="0.88"/>
      <polygon points="10,26 22,21 22,31" fill="#ffffff"/>
      <rect x="22" y="15" width="16" height="22" rx="3" fill="#394354" stroke="#94a3b8" stroke-width="1.5"/>
      <rect x="36" y="12" width="20" height="28" rx="4" fill="${c}"/>
      <rect x="36" y="12" width="20" height="7" rx="3" fill="#ffffff" opacity="0.22"/>
    </svg>`;
  }

  if (partId === 'spike_plow') {
    return `<svg viewBox="0 0 64 52" class="part-svg" aria-hidden="true">
      <polygon points="10,38 50,38 42,16 14,16" fill="${c}"/>
      <polygon points="14,16 42,16 50,38 38,38" fill="#ffffff" opacity="0.18"/>
      <polygon points="48,22 60,25 48,29" fill="#e2e8f0"/>
      <polygon points="50,31 62,34 50,37" fill="#e2e8f0"/>
      <polygon points="44,14 56,17 44,20" fill="#e2e8f0"/>
    </svg>`;
  }

  if (partId === 'bumper_ram') {
    return `<svg viewBox="0 0 64 52" class="part-svg" aria-hidden="true">
      <rect x="8" y="20" width="48" height="16" rx="4" fill="${c}"/>
      <rect x="6" y="24" width="52" height="6" rx="2" fill="#394354" stroke="#cbd5e1" stroke-width="1.2"/>
      <rect x="16" y="15" width="7" height="5" rx="2" fill="${c}"/>
      <rect x="41" y="15" width="7" height="5" rx="2" fill="${c}"/>
    </svg>`;
  }

  if (partId === 'tank_tread') {
    return `<svg viewBox="0 0 64 52" class="part-svg" aria-hidden="true">
      <rect x="6" y="16" width="52" height="22" rx="11" fill="#1b202a" stroke="#475569" stroke-width="2.5"/>
      <circle cx="18" cy="27" r="6" fill="${c}" stroke="#cbd5e1" stroke-width="1.5"/>
      <circle cx="32" cy="27" r="6" fill="${c}" stroke="#cbd5e1" stroke-width="1.5"/>
      <circle cx="46" cy="27" r="6" fill="${c}" stroke="#cbd5e1" stroke-width="1.5"/>
    </svg>`;
  }

  if (partId === 'saw_blade') {
    return `<svg viewBox="0 0 64 52" class="part-svg" aria-hidden="true">
      <rect x="10" y="20" width="22" height="14" rx="3" fill="${c}"/>
      <circle cx="42" cy="27" r="14" fill="#cbd5e1" stroke="#475569" stroke-width="2.5" stroke-dasharray="5 3"/>
      <circle cx="42" cy="27" r="5" fill="#e03131"/>
    </svg>`;
  }

  if (partId === 'turret_blaster') {
    return `<svg viewBox="0 0 64 52" class="part-svg" aria-hidden="true">
      <rect x="12" y="20" width="26" height="18" rx="4" fill="${c}"/>
      <rect x="34" y="21" width="24" height="5" rx="2" fill="#475569"/>
      <rect x="34" y="29" width="24" height="5" rx="2" fill="#475569"/>
      <circle cx="24" cy="18" r="7" fill="${c}" stroke="rgba(255,255,255,0.2)" stroke-width="1.2"/>
    </svg>`;
  }

  if (partId === 'exhaust_pipes') {
    return `<svg viewBox="0 0 64 52" class="part-svg" aria-hidden="true">
      <rect x="18" y="26" width="28" height="16" rx="3" fill="${c}"/>
      <rect x="21" y="9" width="7" height="26" rx="3" fill="#e2e8f0" stroke="#64748b" stroke-width="1.2"/>
      <rect x="36" y="9" width="7" height="26" rx="3" fill="#e2e8f0" stroke="#64748b" stroke-width="1.2"/>
      <polygon points="24,4 21,10 28,10" fill="#fb923c"/>
      <polygon points="39,4 36,10 43,10" fill="#fb923c"/>
    </svg>`;
  }

  if (partId === 'roll_cage') {
    return `<svg viewBox="0 0 64 52" class="part-svg" aria-hidden="true">
      <path d="M12,40 L16,14 L48,14 L52,40" fill="none" stroke="${c}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
      <line x1="16" y1="26" x2="48" y2="26" stroke="#cbd5e1" stroke-width="3"/>
    </svg>`;
  }

  if (partId === 'bull_horns') {
    return `<svg viewBox="0 0 64 52" class="part-svg" aria-hidden="true">
      <rect x="18" y="26" width="28" height="12" rx="3" fill="${c}"/>
      <path d="M22,28 Q8,26 8,12 Q14,20 24,22" fill="#e2e8f0"/>
      <path d="M42,28 Q56,26 56,12 Q50,20 40,22" fill="#e2e8f0"/>
    </svg>`;
  }

  if (partId === 'armor_plate') {
    return `<svg viewBox="0 0 64 52" class="part-svg" aria-hidden="true">
      <rect x="14" y="14" width="36" height="28" rx="4" fill="${c}"/>
      <rect x="12" y="24" width="40" height="8" rx="2" fill="#394354"/>
      <circle cx="19" cy="28" r="2" fill="#cbd5e1"/>
      <circle cx="45" cy="28" r="2" fill="#cbd5e1"/>
      <rect x="20" y="9" width="9" height="5" rx="2" fill="${c}"/>
      <rect x="35" y="9" width="9" height="5" rx="2" fill="${c}"/>
    </svg>`;
  }

  if (partId === 'windshield_2x4') {
    return `<svg viewBox="0 0 64 52" class="part-svg" aria-hidden="true">
      <polygon points="10,38 54,38 42,12 18,12" fill="${c}" opacity="0.62" stroke="#e0f2fe" stroke-width="2"/>
      <line x1="24" y1="15" x2="18" y2="33" stroke="#ffffff" stroke-width="2.5" opacity="0.6"/>
      <rect x="8" y="37" width="48" height="5" rx="2" fill="#334155"/>
    </svg>`;
  }

  if (partId === 'steering_1x2') {
    return `<svg viewBox="0 0 64 52" class="part-svg" aria-hidden="true">
      <rect x="14" y="31" width="36" height="12" rx="3" fill="${c}"/>
      <line x1="32" y1="31" x2="32" y2="22" stroke="#475569" stroke-width="4"/>
      <circle cx="32" cy="18" r="10" fill="none" stroke="#f1f5f9" stroke-width="3.5"/>
      <line x1="24" y1="18" x2="40" y2="18" stroke="#f1f5f9" stroke-width="2.5"/>
    </svg>`;
  }

  if (partId === 'seat_2x2') {
    return `<svg viewBox="0 0 64 52" class="part-svg" aria-hidden="true">
      <rect x="16" y="31" width="32" height="11" rx="3" fill="${c}"/>
      <rect x="16" y="10" width="12" height="24" rx="3" fill="${c}"/>
      <rect x="16" y="10" width="12" height="24" rx="3" fill="#000000" opacity="0.14"/>
    </svg>`;
  }

  if (partId === 'spoiler_1x4') {
    return `<svg viewBox="0 0 64 52" class="part-svg" aria-hidden="true">
      <rect x="18" y="22" width="5" height="18" fill="#475569"/>
      <rect x="41" y="22" width="5" height="18" fill="#475569"/>
      <polygon points="8,14 56,14 52,23 12,23" fill="${c}"/>
      <rect x="6" y="12" width="5" height="14" rx="1.5" fill="${c}"/>
      <rect x="53" y="12" width="5" height="14" rx="1.5" fill="${c}"/>
    </svg>`;
  }

  if (partId === 'headlight_1x2' || partId === 'taillight_1x2') {
    const glow = partId === 'headlight_1x2' ? '#fef08a' : '#ff3b3b';
    return `<svg viewBox="0 0 64 52" class="part-svg" aria-hidden="true">
      <rect x="12" y="18" width="40" height="22" rx="4" fill="${c}"/>
      <rect x="17" y="23" width="12" height="11" rx="2.5" fill="${glow}"/>
      <rect x="35" y="23" width="12" height="11" rx="2.5" fill="${glow}"/>
      <rect x="18" y="13" width="9" height="5" rx="2" fill="${c}"/>
      <rect x="37" y="13" width="9" height="5" rx="2" fill="${c}"/>
    </svg>`;
  }

  if (partId === 'slope_2x2' || partId === 'slope_2x3') {
    return `<svg viewBox="0 0 64 52" class="part-svg" aria-hidden="true">
      <polygon points="10,40 54,40 54,32 28,15 10,15" fill="${c}"/>
      <polygon points="28,15 54,32 54,36 28,20" fill="#ffffff" opacity="0.22"/>
      <rect x="14" y="10" width="10" height="5" rx="2" fill="${c}"/>
    </svg>`;
  }

  if (partId === 'fender_1x4') {
    return `<svg viewBox="0 0 64 52" class="part-svg" aria-hidden="true">
      <path d="M8,40 L8,18 L56,18 L56,40 L44,40 L44,29 C44,24 20,24 20,29 L20,40 Z" fill="${c}"/>
      <rect x="14" y="13" width="9" height="5" rx="2" fill="${c}"/>
      <rect x="28" y="13" width="9" height="5" rx="2" fill="${c}"/>
      <rect x="42" y="13" width="9" height="5" rx="2" fill="${c}"/>
    </svg>`;
  }

  // Plates, Tiles, and Standard Bricks with realistic stud rows!
  const isPlate = partId.startsWith('plate_') || partId.startsWith('tile_');
  const hasStuds = !partId.startsWith('tile_');
  const bodyH = isPlate ? 13 : 24;
  const bodyY = isPlate ? 27 : 18;
  const isLong = partId.includes('4') || partId.includes('6');
  const bodyW = partId === 'brick_1x1' ? 24 : isLong ? 48 : 34;
  const bodyX = (64 - bodyW) / 2;
  const studCount = partId === 'brick_1x1' ? 1 : isLong ? 3 : 2;
  const studsSvg = hasStuds
    ? Array.from({ length: studCount }, (_, i) => {
        const sx = bodyX + ((i + 0.5) / studCount) * bodyW - 4.5;
        return `<rect x="${sx.toFixed(1)}" y="${bodyY - 5}" width="9" height="5" rx="2" fill="${c}" stroke="rgba(255,255,255,0.22)" stroke-width="0.8"/>`;
      }).join('')
    : '';

  return `<svg viewBox="0 0 64 52" class="part-svg" aria-hidden="true">
    ${studsSvg}
    <rect x="${bodyX}" y="${bodyY}" width="${bodyW}" height="${bodyH}" rx="3.5" fill="${c}" stroke="rgba(0,0,0,0.25)" stroke-width="1"/>
    <rect x="${bodyX + 2}" y="${bodyY + 2}" width="${bodyW - 4}" height="4" rx="2" fill="#ffffff" opacity="0.22"/>
  </svg>`;
}
