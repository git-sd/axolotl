// Small illustrations for the site-type cards on the scanner's first step: each one is a
// miniature of that kind of site, drawn in the same ink-outline block style as the
// homepage journey tiles. All share a 160x90 canvas and sit on a coral tile.

const INK = "#3a0f1f";
const SHELL = "#fdeeec";
const PASS = "#7fd6a8";
const LINE = { stroke: INK, strokeWidth: 3, strokeLinejoin: "round" as const, strokeLinecap: "round" as const };

function Booking() {
  // A month grid with one date picked, and a guests pill.
  const cells = Array.from({ length: 12 }, (_, i) => i);
  return (
    <>
      <rect x="22" y="10" width="78" height="70" rx="8" fill={SHELL} {...LINE} />
      <path d="M22 26 H100" {...LINE} />
      <path d="M38 6 V14 M84 6 V14" {...LINE} />
      {cells.map((i) => {
        const x = 30 + (i % 4) * 17;
        const y = 33 + Math.floor(i / 4) * 15;
        return i === 6 ? (
          <rect key={i} x={x - 2} y={y - 2} width="14" height="12" rx="3" fill={INK} />
        ) : (
          <rect key={i} x={x} y={y} width="10" height="8" rx="2" fill={INK} opacity="0.18" />
        );
      })}
      <rect x="96" y="56" width="50" height="22" rx="11" fill={SHELL} {...LINE} />
      <circle cx="109" cy="67" r="4" fill={INK} />
      <path d="M118 67 H136" {...LINE} />
    </>
  );
}

function Shop() {
  // A product card and a cart with a count badge.
  return (
    <>
      <rect x="18" y="8" width="62" height="74" rx="8" fill={SHELL} {...LINE} />
      <rect x="26" y="16" width="46" height="30" rx="5" fill={INK} opacity="0.18" />
      <path d="M26 56 H62 M26 66 H46" {...LINE} />
      <rect x="54" y="62" width="20" height="12" rx="4" fill={INK} />
      <path d="M96 30 H104 L112 60 H138 L144 38 H107" fill="none" {...LINE} />
      <circle cx="116" cy="70" r="4.5" fill={INK} />
      <circle cx="134" cy="70" r="4.5" fill={INK} />
      <circle cx="142" cy="24" r="10" fill={PASS} {...LINE} />
      <text x="142" y="29" textAnchor="middle" fontSize="14" fontWeight="900" fill={INK}>2</text>
    </>
  );
}

function Saas() {
  // Three pricing columns, the middle one highlighted.
  return (
    <>
      {[0, 1, 2].map((i) => {
        const x = 18 + i * 44;
        const mid = i === 1;
        return (
          <g key={i}>
            <rect x={x} y={mid ? 6 : 16} width="36" height={mid ? 76 : 64} rx="7" fill={mid ? INK : SHELL} {...LINE} />
            <path d={`M${x + 8} ${mid ? 22 : 30} H${x + 22}`} stroke={mid ? SHELL : INK} strokeWidth="3" strokeLinecap="round" />
            <path d={`M${x + 8} ${mid ? 36 : 44} H${x + 28} M${x + 8} ${mid ? 46 : 54} H${x + 24}`} stroke={mid ? SHELL : INK} strokeWidth="2.5" strokeLinecap="round" opacity="0.5" />
            <rect x={x + 7} y={mid ? 62 : 64} width="22" height="9" rx="4" fill={mid ? SHELL : INK} opacity={mid ? 1 : 0.85} />
          </g>
        );
      })}
    </>
  );
}

function Docs() {
  // A docs page: sidebar, headings, text lines and a code block.
  return (
    <>
      <rect x="18" y="8" width="124" height="74" rx="8" fill={SHELL} {...LINE} />
      <path d="M48 8 V82" {...LINE} />
      <path d="M26 20 H40 M26 30 H38 M26 40 H40 M26 50 H36" stroke={INK} strokeWidth="2.5" strokeLinecap="round" opacity="0.45" />
      <path d="M58 20 H100" {...LINE} />
      <path d="M58 30 H130 M58 38 H122" stroke={INK} strokeWidth="2.5" strokeLinecap="round" opacity="0.45" />
      <rect x="58" y="48" width="74" height="26" rx="5" fill={INK} />
      <path d="M66 57 H84 M66 66 H96" stroke={PASS} strokeWidth="3" strokeLinecap="round" />
    </>
  );
}

function Lead() {
  // A short form: two labelled fields and a submit button.
  return (
    <>
      <rect x="30" y="6" width="100" height="78" rx="8" fill={SHELL} {...LINE} />
      <path d="M40 16 H62" stroke={INK} strokeWidth="2.5" strokeLinecap="round" opacity="0.5" />
      <rect x="40" y="21" width="80" height="13" rx="4" fill="none" {...LINE} />
      <path d="M40 43 H58" stroke={INK} strokeWidth="2.5" strokeLinecap="round" opacity="0.5" />
      <rect x="40" y="48" width="80" height="13" rx="4" fill="none" {...LINE} />
      <rect x="40" y="67" width="38" height="11" rx="4" fill={INK} />
      <path d="M86 72 L92 77 L104 66" fill="none" stroke={PASS} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
    </>
  );
}

function Own() {
  // A speech bubble being typed into: "describe it in your own words".
  return (
    <>
      <path d="M26 12 H134 a8 8 0 0 1 8 8 V56 a8 8 0 0 1 -8 8 H64 L48 80 V64 H26 a8 8 0 0 1 -8 -8 V20 a8 8 0 0 1 8 -8 Z" fill={SHELL} {...LINE} />
      <path d="M32 28 H118 M32 40 H102" stroke={INK} strokeWidth="3" strokeLinecap="round" opacity="0.45" />
      <path d="M32 52 H68" {...LINE} />
      <rect x="72" y="45" width="3" height="14" fill={INK} />
    </>
  );
}

const ART: Record<string, () => React.ReactElement> = {
  booking: Booking,
  shop: Shop,
  saas: Saas,
  docs: Docs,
  lead: Lead,
  own: Own,
};

export default function TypeArt({ kind }: { kind: string }) {
  const Art = ART[kind] ?? Own;
  return (
    <svg viewBox="0 0 160 90" width="100%" height="100%" aria-hidden="true" focusable="false">
      <Art />
    </svg>
  );
}
