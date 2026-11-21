const COMPACT_SUFFIXES = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];

export function formatMoneyCompact(val: number): string {
  if (!Number.isFinite(val)) return '$0';
  const sign = val < 0 ? '-' : '';
  const abs = Math.abs(val);
  if (abs < 1000) return `${sign}$${Math.floor(abs).toLocaleString()}`;

  const tier = Math.floor(Math.log10(abs) / 3);
  if (tier < COMPACT_SUFFIXES.length) {
    const scale = Math.pow(10, tier * 3);
    const scaled = abs / scale;
    const decimals = tier === 1 && scaled >= 100 ? 1 : 2;
    return `${sign}$${scaled.toFixed(decimals)}${COMPACT_SUFFIXES[tier]}`;
  }
  return `${sign}$${abs.toExponential(2).replace('+', '')}`;
}

export function formatIncomeRateCompact(val: number): string {
  if (!Number.isFinite(val) || val <= 0) return '+$0/s';
  if (val < 100) {
    const rounded = Math.round(val * 10) / 10;
    return Number.isInteger(rounded) ? `+$${rounded}/s` : `+$${rounded.toFixed(1)}/s`;
  }
  if (val < 1000) {
    return `+$${Math.round(val).toLocaleString()}/s`;
  }
  return `+${formatMoneyCompact(val)}/s`;
}
