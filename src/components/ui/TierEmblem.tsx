import React, { useId } from 'react';

export type TierFamily =
  | 'Bronze'
  | 'Silver'
  | 'Gold'
  | 'Platinum'
  | 'Diamond'
  | 'Master'
  | 'Grandmaster'
  | 'Terra Challenger';

export type TierDivision = 1 | 2 | 3 | 4 | 5;

interface TierPalette {
  light: string;
  mid: string;
  dark: string;
  accent: string;
  bg: string;
}

const TIER_PALETTES: Record<TierFamily, TierPalette> = {
  Bronze: {
    light: '#f3b982',
    mid: '#cd7f32',
    dark: '#6e380d',
    accent: '#e3a66d',
    bg: '#191008',
  },
  Silver: {
    light: '#f8fafc',
    mid: '#94a3b8',
    dark: '#475569',
    accent: '#cbd5e1',
    bg: '#0e1522',
  },
  Gold: {
    light: '#fef08a',
    mid: '#f59e0b',
    dark: '#92400e',
    accent: '#fbbf24',
    bg: '#1a1406',
  },
  Platinum: {
    light: '#ccfbf1',
    mid: '#14b8a6',
    dark: '#0f524c',
    accent: '#2dd4bf',
    bg: '#071a1a',
  },
  Diamond: {
    light: '#e0f2fe',
    mid: '#0ea5e9',
    dark: '#075985',
    accent: '#38bdf8',
    bg: '#071628',
  },
  Master: {
    light: '#f3e8ff',
    mid: '#a855f7',
    dark: '#581c87',
    accent: '#c084fc',
    bg: '#160b26',
  },
  Grandmaster: {
    light: '#ffe4e6',
    mid: '#f43f5e',
    dark: '#881337',
    accent: '#fb7185',
    bg: '#220912',
  },
  'Terra Challenger': {
    light: '#fef9c3',
    mid: '#eab308',
    dark: '#854d0e',
    accent: '#facc15',
    bg: '#171407',
  },
};

export function resolveTierFamily(tierOrLabel?: string): TierFamily {
  const s = (tierOrLabel || '').trim();
  if (s.startsWith('Terra Challenger')) return 'Terra Challenger';
  if (s.startsWith('Grandmaster')) return 'Grandmaster';
  if (s.startsWith('Master')) return 'Master';
  if (s.startsWith('Diamond')) return 'Diamond';
  if (s.startsWith('Platinum')) return 'Platinum';
  if (s.startsWith('Gold')) return 'Gold';
  if (s.startsWith('Silver')) return 'Silver';
  return 'Bronze';
}

export function resolveTierDivision(tierOrLabel?: string): TierDivision {
  const s = (tierOrLabel || '').trim();
  const match = s.match(/\b(I|II|III|IV|V)$/);
  if (!match) return 3;
  switch (match[1]) {
    case 'I':
      return 1;
    case 'II':
      return 2;
    case 'III':
      return 3;
    case 'IV':
      return 4;
    case 'V':
      return 5;
    default:
      return 3;
  }
}

function starPoints(cx: number, cy: number, outerR: number, innerR: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 === 0 ? outerR : innerR;
    pts.push(`${(cx + Math.cos(angle) * r).toFixed(2)},${(cy + Math.sin(angle) * r).toFixed(2)}`);
  }
  return pts.join(' ');
}

interface TierEmblemProps {
  tierOrLabel: string;
  color?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  muted?: boolean;
  className?: string;
}

const CONTAINER_SIZE: Record<NonNullable<TierEmblemProps['size']>, string> = {
  xs: 'w-4 h-4 rounded',
  sm: 'w-7 h-7 rounded-lg',
  md: 'w-11 h-11 rounded-xl',
  lg: 'w-14 h-14 rounded-2xl',
  xl: 'w-16 h-16 rounded-2xl',
};

const SVG_SIZE: Record<NonNullable<TierEmblemProps['size']>, string> = {
  xs: 'w-3.5 h-3.5',
  sm: 'w-5.5 h-5.5',
  md: 'w-8.5 h-8.5',
  lg: 'w-11 h-11',
  xl: 'w-12 h-12',
};

export const TierEmblem: React.FC<TierEmblemProps> = ({
  tierOrLabel,
  color,
  size = 'md',
  muted = false,
  className = '',
}) => {
  const rawId = useId();
  const uid = rawId.replace(/[^a-zA-Z0-9_-]/g, '');
  const family = resolveTierFamily(tierOrLabel);
  const div = resolveTierDivision(tierOrLabel);
  const pal = TIER_PALETTES[family];
  const borderAccent = color || pal.accent;

  const gradMain = `tier-m-${uid}`;
  const gradTrim = `tier-t-${uid}`;

  // Bronze: 1..4 bars stacked cleanly; V adds top senior chevron cap
  const bronzeBarPositions: Record<TierDivision, number[]> = {
    1: [28],
    2: [21, 35],
    3: [15.5, 28, 40.5],
    4: [12, 23, 34, 45],
    5: [21, 31, 41, 51],
  };

  // Silver: 1..3 chevrons; IV adds 1 bottom rocker; V adds double rocker + center star
  const silverChevrons: Record<TierDivision, number[]> = {
    1: [34],
    2: [28, 39],
    3: [23, 33, 43],
    4: [20, 29.5, 39],
    5: [18, 27, 36],
  };

  // Gold: 1..3 officer diamonds; IV adds bottom shoulder bar; V adds double bar + top pip trim
  const goldDiamonds: Record<TierDivision, Array<[number, number]>> = {
    1: [[32, 32]],
    2: [
      [21, 32],
      [43, 32],
    ],
    3: [
      [32, 19],
      [20, 39],
      [44, 39],
    ],
    4: [
      [32, 16],
      [20, 34],
      [44, 34],
    ],
    5: [
      [32, 15],
      [19, 32],
      [45, 32],
    ],
  };

  // Platinum: 1..3 field-grade rosettes inside evolving laurel wreath; IV adds command band; V adds upper crest arc
  const platRosettes: Record<TierDivision, number[]> = {
    1: [32],
    2: [24, 40],
    3: [18, 31.5, 45],
    4: [17, 29.5, 42],
    5: [17, 29, 41],
  };

  return (
    <div
      className={`relative shrink-0 overflow-hidden border flex items-center justify-center select-none ${CONTAINER_SIZE[size]} ${
        muted ? 'opacity-70' : ''
      } ${className}`}
      style={{
        backgroundColor: pal.bg,
        borderColor: muted ? 'rgba(255,255,255,0.14)' : `${borderAccent}66`,
      }}
      title={tierOrLabel}
      aria-label={`${tierOrLabel} 티어 계급 마크`}
    >
      <svg
        viewBox="0 0 64 64"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={SVG_SIZE[size]}
        aria-hidden="true"
      >
        <defs>
          <linearGradient id={gradMain} x1="12" y1="8" x2="52" y2="56" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor={pal.light} />
            <stop offset="55%" stopColor={pal.mid} />
            <stop offset="100%" stopColor={pal.dark} />
          </linearGradient>
          <linearGradient id={gradTrim} x1="32" y1="6" x2="32" y2="58" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#fef9c3" />
            <stop offset="50%" stopColor="#f59e0b" />
            <stop offset="100%" stopColor="#92400e" />
          </linearGradient>
        </defs>

        {/* 1. BRONZE (I~V): 병사 수평 막대 (1단 -> 2단 -> 3단 -> 4단 -> 4단+상단 셰브론) */}
        {family === 'Bronze' && (
          <>
            {div === 5 && (
              <path
                d="M15 17L32 8L49 17L45.5 20.5L32 13.5L18.5 20.5L15 17Z"
                fill={`url(#${gradMain})`}
                stroke={pal.dark}
                strokeWidth="1.2"
                strokeLinejoin="round"
              />
            )}
            {bronzeBarPositions[div].map((y, idx) => (
              <rect
                key={idx}
                x="13"
                y={y}
                width="38"
                height={div >= 4 ? '6.8' : '8'}
                rx="2"
                fill={`url(#${gradMain})`}
                stroke={pal.dark}
                strokeWidth="1.4"
              />
            ))}
          </>
        )}

        {/* 2. SILVER (I~V): 부사관 갈매기(1~3단) -> +로커 -> +이중로커 & 중앙 별 */}
        {family === 'Silver' && (
          <>
            {silverChevrons[div].map((y, idx) => (
              <path
                key={idx}
                d={`M13 ${y}L32 ${y - 13}L51 ${y}L46.5 ${y + 4.5}L32 ${y - 6.5}L17.5 ${y + 4.5}L13 ${y}Z`}
                fill={`url(#${gradMain})`}
                stroke={pal.dark}
                strokeWidth="1.2"
                strokeLinejoin="round"
              />
            ))}
            {div >= 4 && (
              <path
                d="M14 46.5C24 52 40 52 50 46.5"
                stroke={pal.light}
                strokeWidth="3.6"
                strokeLinecap="round"
              />
            )}
            {div === 5 && (
              <>
                <path
                  d="M18 53C26 57 38 57 46 53"
                  stroke={pal.mid}
                  strokeWidth="2.8"
                  strokeLinecap="round"
                />
                <polygon
                  points={starPoints(32, 43.5, 4.8, 2)}
                  fill="#ffffff"
                  stroke={pal.dark}
                  strokeWidth="0.9"
                />
              </>
            )}
          </>
        )}

        {/* 3. GOLD (I~V): 위관 마름모(1~3개) -> +견장 바 -> +이중 바 & 상단 장식 */}
        {family === 'Gold' && (
          <>
            {div === 5 && (
              <path
                d="M23 9L32 5L41 9"
                stroke={pal.light}
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}
            {goldDiamonds[div].map(([cx, cy], idx) => (
              <path
                key={idx}
                d={`M${cx} ${cy - 10}L${cx + 8.5} ${cy}L${cx} ${cy + 10}L${cx - 8.5} ${cy}Z`}
                fill={`url(#${gradMain})`}
                stroke={pal.dark}
                strokeWidth="1.3"
                strokeLinejoin="round"
              />
            ))}
            {div >= 4 && (
              <rect
                x="13"
                y="47.5"
                width="38"
                height="4.2"
                rx="2"
                fill={pal.light}
                stroke={pal.dark}
                strokeWidth="1"
              />
            )}
            {div === 5 && (
              <rect
                x="18"
                y="54"
                width="28"
                height="3.2"
                rx="1.6"
                fill={pal.mid}
              />
            )}
          </>
        )}

        {/* 4. PLATINUM (I~V): 영관 월계관 + 성화(1~3개) -> +지휘 밴드 -> +상단 아크 */}
        {family === 'Platinum' && (
          <>
            <path
              d={
                div >= 3
                  ? 'M13 20C10 34 15 47 28 53M51 20C54 34 49 47 36 53'
                  : 'M15 28C13 38 18 47 28 52M49 28C51 38 46 47 36 52'
              }
              stroke={`url(#${gradMain})`}
              strokeWidth={div >= 4 ? '4.5' : '3.8'}
              strokeLinecap="round"
            />
            {div >= 2 && (
              <path
                d="M15 34L9 33M18 43L12 45M49 34L55 33M46 43L52 45"
                stroke={pal.light}
                strokeWidth="2.2"
                strokeLinecap="round"
              />
            )}
            {div >= 4 && (
              <path
                d="M16 25L10 22M48 25L54 22"
                stroke={pal.light}
                strokeWidth="2.2"
                strokeLinecap="round"
              />
            )}
            {div === 5 && (
              <path
                d="M21 11C27 7 37 7 43 11"
                stroke={pal.light}
                strokeWidth="2.6"
                strokeLinecap="round"
              />
            )}
            {platRosettes[div].map((cy, idx) => (
              <g key={idx}>
                <polygon
                  points={starPoints(32, cy, div >= 3 ? 7.6 : 9, div >= 3 ? 3.6 : 4.2)}
                  fill={`url(#${gradMain})`}
                  stroke={pal.dark}
                  strokeWidth="1.1"
                />
                <circle cx="32" cy={cy} r="2.1" fill="#042f2e" />
              </g>
            ))}
            {div >= 4 && (
              <rect x="20" y="53.5" width="24" height="3.6" rx="1.8" fill={pal.light} />
            )}
          </>
        )}

        {/* 5. DIAMOND (I~V): 장성 별 계급장 (1성 -> 2성 -> 3성 -> 3성+이중바 -> 3성+월계날개) */}
        {family === 'Diamond' && (
          <>
            {div === 5 && (
              <path
                d="M11 26C9 37 14 46 22 50M53 26C55 37 50 46 42 50"
                stroke={pal.light}
                strokeWidth="3"
                strokeLinecap="round"
              />
            )}
            <rect
              x="10"
              y={div >= 4 ? '45.5' : '47'}
              width="44"
              height="5"
              rx="2.5"
              fill={`url(#${gradMain})`}
            />
            {div >= 4 && (
              <rect x="16" y="53" width="32" height="3.2" rx="1.6" fill={pal.light} />
            )}

            {div === 1 && (
              <polygon
                points={starPoints(32, 27, 14, 5.8)}
                fill={`url(#${gradMain})`}
                stroke={pal.dark}
                strokeWidth="1.3"
              />
            )}
            {div === 2 && (
              <>
                <polygon
                  points={starPoints(20, 28, 11.5, 4.8)}
                  fill={`url(#${gradMain})`}
                  stroke={pal.dark}
                  strokeWidth="1.2"
                />
                <polygon
                  points={starPoints(44, 28, 11.5, 4.8)}
                  fill={`url(#${gradMain})`}
                  stroke={pal.dark}
                  strokeWidth="1.2"
                />
              </>
            )}
            {div >= 3 && (
              <>
                <polygon
                  points={starPoints(32, 16.5, 9.6, 4)}
                  fill={`url(#${gradMain})`}
                  stroke={pal.dark}
                  strokeWidth="1.1"
                />
                <polygon
                  points={starPoints(17.5, 33, 9.6, 4)}
                  fill={`url(#${gradMain})`}
                  stroke={pal.dark}
                  strokeWidth="1.1"
                />
                <polygon
                  points={starPoints(46.5, 33, 9.6, 4)}
                  fill={`url(#${gradMain})`}
                  stroke={pal.dark}
                  strokeWidth="1.1"
                />
              </>
            )}
          </>
        )}

        {/* 6. MASTER (I~V): 4성 대장 (4성 -> +코어 젬 -> +교차 지휘봉 -> +하단 월계 -> +상하 금테 아크) */}
        {family === 'Master' && (
          <>
            {div >= 3 && (
              <path
                d="M14 50L50 14M50 50L14 14"
                stroke={`url(#${gradTrim})`}
                strokeWidth={div >= 5 ? '4' : '3.2'}
                strokeLinecap="round"
                strokeOpacity="0.8"
              />
            )}
            {div >= 4 && (
              <path
                d="M12 36C12 48 21 56 32 57C43 56 52 48 52 36"
                stroke={`url(#${gradTrim})`}
                strokeWidth="3"
                strokeLinecap="round"
              />
            )}
            {div === 5 && (
              <path
                d="M18 11C25 6.5 39 6.5 46 11"
                stroke={pal.light}
                strokeWidth="2.8"
                strokeLinecap="round"
              />
            )}
            <polygon
              points={starPoints(32, 15, 8.2, 3.5)}
              fill={`url(#${gradMain})`}
              stroke={pal.dark}
              strokeWidth="1.1"
            />
            <polygon
              points={starPoints(15.5, 32, 8.2, 3.5)}
              fill={`url(#${gradMain})`}
              stroke={pal.dark}
              strokeWidth="1.1"
            />
            <polygon
              points={starPoints(48.5, 32, 8.2, 3.5)}
              fill={`url(#${gradMain})`}
              stroke={pal.dark}
              strokeWidth="1.1"
            />
            <polygon
              points={starPoints(32, 49, 8.2, 3.5)}
              fill={`url(#${gradMain})`}
              stroke={pal.dark}
              strokeWidth="1.1"
            />
            {div >= 2 && (
              <circle
                cx="32"
                cy="32"
                r={div >= 4 ? '4.8' : '3.8'}
                fill={div >= 4 ? `url(#${gradTrim})` : pal.light}
                stroke={pal.dark}
                strokeWidth="1.3"
              />
            )}
          </>
        )}

        {/* 7. GRANDMASTER (I~V): 5성 원수 (5성 환 -> +루비 코어 -> +하단 월계 -> +5각 링 -> +원수 왕관) */}
        {family === 'Grandmaster' && (
          <>
            {div >= 3 && (
              <path
                d={
                  div >= 4
                    ? 'M10 24C7 40 16 54 32 57C48 54 57 40 54 24'
                    : 'M14 40C18 50 25 55 32 56C39 55 46 50 50 40'
                }
                stroke={`url(#${gradTrim})`}
                strokeWidth="3.6"
                strokeLinecap="round"
              />
            )}
            {div >= 4 && (
              <circle
                cx="32"
                cy="32"
                r="17"
                stroke={pal.mid}
                strokeOpacity="0.65"
                strokeWidth="1.6"
              />
            )}
            {div === 5 && (
              <path
                d="M23 10L26 5L32 8.5L38 5L41 10"
                stroke="#fef08a"
                strokeWidth="2.3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}
            <polygon points={starPoints(32, 15, 7.2, 3.1)} fill={`url(#${gradMain})`} stroke={pal.dark} strokeWidth="0.9" />
            <polygon points={starPoints(48.5, 27, 7.2, 3.1)} fill={`url(#${gradMain})`} stroke={pal.dark} strokeWidth="0.9" />
            <polygon points={starPoints(42, 45.5, 7.2, 3.1)} fill={`url(#${gradMain})`} stroke={pal.dark} strokeWidth="0.9" />
            <polygon points={starPoints(22, 45.5, 7.2, 3.1)} fill={`url(#${gradMain})`} stroke={pal.dark} strokeWidth="0.9" />
            <polygon points={starPoints(15.5, 27, 7.2, 3.1)} fill={`url(#${gradMain})`} stroke={pal.dark} strokeWidth="0.9" />
            {div >= 2 && (
              <polygon
                points="32,24 38,31.5 32,39 26,31.5"
                fill={`url(#${gradTrim})`}
                stroke="#ffffff"
                strokeWidth="1"
              />
            )}
          </>
        )}

        {/* 8. TERRA CHALLENGER: 최고위 지구 원수 휘장 */}
        {family === 'Terra Challenger' && (
          <>
            <path
              d="M11 21C7 37 14 52 32 56C50 52 57 37 53 21"
              stroke={`url(#${gradMain})`}
              strokeWidth="4.2"
              strokeLinecap="round"
            />
            <polygon points={starPoints(20, 15, 5.2, 2.2)} fill={`url(#${gradMain})`} />
            <polygon points={starPoints(32, 11, 6.8, 2.9)} fill="#ffffff" stroke={pal.mid} strokeWidth="1" />
            <polygon points={starPoints(44, 15, 5.2, 2.2)} fill={`url(#${gradMain})`} />
            <circle cx="32" cy="35" r="13" fill="#0369a1" stroke={`url(#${gradMain})`} strokeWidth="2.8" />
            <ellipse cx="32" cy="35" rx="5.5" ry="13" stroke="#bae6fd" strokeWidth="1.6" />
            <path d="M19 35H45M22 29H42M22 41H42" stroke="#bae6fd" strokeOpacity="0.85" strokeWidth="1.4" />
          </>
        )}
      </svg>
    </div>
  );
};
