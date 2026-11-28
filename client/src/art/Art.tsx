// Original vector artwork for Chipfall: faction emblems, pilot frames, item icons, dungeon marks.
import { FACTIONS, ITEMS, rarityColor, type DungeonId, type FactionId, type RoleId } from '../../../shared/content';

export function FactionEmblem({ faction, size = 40 }: { faction: FactionId; size?: number }) {
  const f = FACTIONS[faction];
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-label={f.name} role="img">
      {faction === 'aurex' && (
        <g>
          {Array.from({ length: 12 }).map((_, i) => (
            <rect key={i} x="30.5" y="2" width="3" height="11" rx="1.5" fill={f.color} opacity={i % 2 ? 0.55 : 1} transform={`rotate(${i * 30} 32 32)`} />
          ))}
          <polygon points="32,14 47.6,23 47.6,41 32,50 16.4,41 16.4,23" fill={f.dark} stroke={f.color} strokeWidth="3" />
          <circle cx="32" cy="32" r="7" fill={f.color} />
        </g>
      )}
      {faction === 'vessari' && (
        <g>
          <polygon points="32,3 40,26 32,34 24,26" fill={f.color} />
          <polygon points="57,47 37,40 33,30 44,33" fill={f.color} opacity="0.8" />
          <polygon points="7,47 20,33 31,30 27,40" fill={f.color} opacity="0.65" />
          <circle cx="32" cy="38" r="15" fill="none" stroke={f.accent} strokeWidth="2.5" />
          <ellipse cx="32" cy="38" rx="9" ry="5" fill={f.dark} stroke={f.color} strokeWidth="2" />
          <circle cx="32" cy="38" r="2.6" fill={f.accent} />
        </g>
      )}
      {faction === 'kreth' && (
        <g>
          {Array.from({ length: 8 }).map((_, i) => (
            <rect key={i} x="27" y="4" width="10" height="12" fill={f.color} transform={`rotate(${i * 45} 32 32)`} />
          ))}
          <circle cx="32" cy="32" r="19" fill={f.dark} stroke={f.color} strokeWidth="3" />
          <path d="M20 26 L32 36 L44 26 L44 33 L32 43 L20 33 Z" fill={f.color} />
          <rect x="29" y="18" width="6" height="8" fill={f.accent} />
        </g>
      )}
    </svg>
  );
}

/** Pilot frame: a stylised helmet, shaped by role and painted in faction colours. */
export function PilotPortrait({ faction, role, size = 72 }: { faction: FactionId; role: RoleId; size?: number }) {
  const f = FACTIONS[faction];
  return (
    <svg width={size} height={size} viewBox="0 0 80 80" role="img" aria-label={`${f.short} ${role}`}>
      <defs>
        <linearGradient id={`pp-${faction}-${role}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={f.accent} />
          <stop offset="1" stopColor={f.color} />
        </linearGradient>
      </defs>
      <path d="M8 0 H72 L80 8 V72 L72 80 H8 L0 72 V8 Z" fill={f.dark} />
      <path d="M10 70 Q40 52 70 70 V80 H10 Z" fill={f.color} opacity="0.35" />
      {role === 'assault' && (
        <g>
          <path d="M40 8 L44 22 L36 22 Z" fill={f.accent} />
          <path d="M22 30 Q40 14 58 30 L60 52 Q40 64 20 52 Z" fill={`url(#pp-${faction}-${role})`} />
          <path d="M24 38 L56 38 L52 44 L28 44 Z" fill="#0E1424" />
          <rect x="30" y="40" width="20" height="2" fill={f.accent} />
        </g>
      )}
      {role === 'guardian' && (
        <g>
          <path d="M16 28 Q40 10 64 28 L62 56 Q40 68 18 56 Z" fill={`url(#pp-${faction}-${role})`} />
          <path d="M28 34 H52 V46 L40 52 L28 46 Z" fill="#0E1424" />
          <rect x="31" y="38" width="7" height="3" fill={f.accent} />
          <rect x="42" y="38" width="7" height="3" fill={f.accent} />
          <rect x="12" y="34" width="6" height="16" rx="2" fill={f.color} />
          <rect x="62" y="34" width="6" height="16" rx="2" fill={f.color} />
        </g>
      )}
      {role === 'engineer' && (
        <g>
          <line x1="56" y1="22" x2="66" y2="8" stroke={f.accent} strokeWidth="2.5" />
          <circle cx="66" cy="8" r="3.5" fill={f.accent} />
          <circle cx="40" cy="38" r="21" fill={`url(#pp-${faction}-${role})`} />
          <circle cx="40" cy="39" r="11" fill="#0E1424" />
          <circle cx="40" cy="39" r="5.5" fill="none" stroke={f.accent} strokeWidth="2.5" />
          <circle cx="40" cy="39" r="2" fill={f.accent} />
        </g>
      )}
    </svg>
  );
}

export function ItemIcon({ templateId, size = 40 }: { templateId: string; size?: number }) {
  const t = ITEMS[templateId];
  if (!t) return null;
  const rc = rarityColor(t.rarity);
  const body = (() => {
    if (t.kind === 'weapon') {
      if (t.role === 'assault')
        return (
          <g fill={rc}>
            <rect x="8" y="27" width="34" height="8" rx="2" />
            <rect x="40" y="29" width="16" height="4" />
            <path d="M14 35 L22 35 L18 46 L11 46 Z" />
            <rect x="24" y="21" width="12" height="5" rx="1" opacity="0.7" />
          </g>
        );
      if (t.role === 'guardian')
        return (
          <g fill={rc}>
            <rect x="30" y="20" width="5" height="34" rx="2" transform="rotate(35 32 36)" />
            <path d="M16 12 L36 12 L40 20 L36 28 L16 28 L12 20 Z" transform="rotate(35 32 36)" />
          </g>
        );
      return (
        <g fill={rc}>
          <rect x="29.5" y="20" width="5" height="34" rx="2" />
          <circle cx="32" cy="15" r="8" fill="none" stroke={rc} strokeWidth="3" />
          <circle cx="32" cy="15" r="3" />
        </g>
      );
    }
    if (t.kind === 'armor')
      return (
        <g fill={rc}>
          <path d="M18 14 L26 10 Q32 16 38 10 L46 14 L52 24 L46 28 L44 52 L20 52 L18 28 L12 24 Z" />
          <path d="M26 24 H38 V38 L32 42 L26 38 Z" fill="#0E1424" opacity="0.5" />
        </g>
      );
    if (t.kind === 'ore') {
      const c = templateId === 'o_lumen' ? '#8FF0E0' : templateId === 'o_cobaltine' ? '#6E9BFF' : '#F59CFF';
      return (
        <g>
          <polygon points="32,8 42,26 36,50 26,50 20,26" fill={c} />
          <polygon points="18,24 26,34 22,52 12,48 10,32" fill={c} opacity="0.7" />
          <polygon points="46,22 54,32 52,50 40,52 42,30" fill={c} opacity="0.55" />
          <polygon points="32,8 36,26 32,50 28,26" fill="#fff" opacity="0.25" />
        </g>
      );
    }
    if (templateId === 'm_circuit')
      return (
        <g fill="none" stroke={rc} strokeWidth="3">
          <rect x="18" y="18" width="28" height="28" rx="3" />
          <path d="M24 18 V10 M32 18 V10 M40 18 V10 M24 46 V54 M32 46 V54 M40 46 V54" />
          <rect x="26" y="26" width="12" height="12" fill={rc} />
        </g>
      );
    if (templateId === 'm_forge_core')
      return (
        <g>
          <circle cx="32" cy="32" r="18" fill="#3A1A08" stroke={rc} strokeWidth="3" />
          <circle cx="32" cy="32" r="9" fill="#FF9A3C" />
          <circle cx="32" cy="32" r="4" fill="#FFE2A0" />
        </g>
      );
    return (
      <g fill={rc}>
        <path d="M14 40 L24 22 L34 30 L44 16 L52 34 L42 46 L22 48 Z" />
        <circle cx="30" cy="38" r="3" fill="#0E1424" />
      </g>
    );
  })();
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label={t.name}>
      <path d="M6 0 H58 L64 6 V58 L58 64 H6 L0 58 V6 Z" fill="#101727" stroke={rc} strokeOpacity="0.55" strokeWidth="2" />
      {body}
    </svg>
  );
}

export function DungeonMark({ id, size = 56, color = '#E6ECF6' }: { id: DungeonId; size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-hidden="true">
      <path d="M8 0 H56 L64 8 V56 L56 64 H8 L0 56 V8 Z" fill="#101727" />
      {id === 'training' && (
        <g fill="none" stroke={color} strokeWidth="3">
          <circle cx="32" cy="32" r="18" />
          <circle cx="32" cy="32" r="10" />
          <circle cx="32" cy="32" r="3" fill={color} />
          <path d="M32 6 V16 M32 48 V58 M6 32 H16 M48 32 H58" />
        </g>
      )}
      {id === 'foundry' && (
        <g fill={color}>
          <path d="M14 34 H50 L46 42 H18 Z" />
          <rect x="24" y="42" width="16" height="10" />
          <path d="M26 30 Q22 22 30 14 Q30 22 36 24 Q38 18 36 12 Q46 20 40 30 Z" fill="#FF9A3C" />
        </g>
      )}
      {id === 'vault' && (
        <g fill="none" stroke={color} strokeWidth="3">
          <rect x="12" y="12" width="40" height="40" rx="3" />
          <circle cx="32" cy="32" r="11" />
          <path d="M32 21 V43 M21 32 H43" />
          <rect x="46" y="22" width="4" height="8" fill={color} />
        </g>
      )}
      {id === 'goldmine' && (
        <g>
          <path d="M14 18 Q32 6 50 18 L46 20 Q32 12 18 20 Z" fill={color} />
          <rect x="30" y="16" width="4" height="34" fill={color} transform="rotate(-30 32 32)" />
          <circle cx="42" cy="44" r="9" fill="#F2C14E" />
          <text x="42" y="48" textAnchor="middle" fontSize="11" fontWeight="700" fill="#5A4210">G</text>
        </g>
      )}
    </svg>
  );
}

export function CoinIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true" style={{ verticalAlign: '-3px' }}>
      <circle cx="10" cy="10" r="9" fill="#F2C14E" />
      <circle cx="10" cy="10" r="6" fill="none" stroke="#9A7418" strokeWidth="1.5" />
      <rect x="8.5" y="6" width="3" height="8" rx="1" fill="#9A7418" />
    </svg>
  );
}

export function NavIcon({ name }: { name: 'home' | 'bag' | 'market' | 'war' }) {
  const p = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const };
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
      {name === 'home' && <path {...p} d="M3 11 L12 4 L21 11 V20 H14 V14 H10 V20 H3 Z" />}
      {name === 'bag' && (
        <g {...p}>
          <path d="M5 8 H19 L18 21 H6 Z" />
          <path d="M9 8 V6 A3 3 0 0 1 15 6 V8" />
        </g>
      )}
      {name === 'market' && (
        <g {...p}>
          <path d="M4 9 L6 4 H18 L20 9 Z" />
          <path d="M5 9 V20 H19 V9" />
          <path d="M10 20 V14 H14 V20" />
        </g>
      )}
      {name === 'war' && (
        <g {...p}>
          <polygon points="12,3 20,7.5 20,16.5 12,21 4,16.5 4,7.5" />
          <path d="M9 12 L11 14 L15 10" />
        </g>
      )}
    </svg>
  );
}
