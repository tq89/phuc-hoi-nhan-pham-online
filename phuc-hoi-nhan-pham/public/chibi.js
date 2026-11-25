// Chibi phạm nhân vẽ bằng SVG: màu tóc/áo sinh từ tên → mỗi người một vẻ, không cần ảnh có bản quyền.
const SKIN = ['#ffd9b8', '#f6c59f', '#eab48a', '#d99a6c', '#c58457'];
const HAIR_STYLES = 5;

function hsl(h, s, l) { return `hsl(${h} ${s}% ${l}%)`; }

export function chibiSVG({ hue = 200, seed = 0, mood = 'sad', hasAvatar = false, size = 'sm' }) {
  const skin = SKIN[seed % SKIN.length];
  const hair = hsl((hue + 40) % 360, 70, 28 + (seed % 3) * 8);
  const suit = hsl(hue, 85, 55);
  const suitDark = hsl(hue, 70, 22);
  const style = seed % HAIR_STYLES;
  const hairPath = [
    'M22 34 Q20 10 46 8 Q72 10 70 34 Q64 20 46 20 Q30 20 22 34Z',
    'M20 36 Q18 6 46 6 Q76 6 72 36 L66 26 L58 32 L50 22 L42 32 L34 22 L26 30Z',
    'M21 38 Q16 4 48 6 Q78 10 71 40 Q70 24 60 18 Q40 26 21 38Z',
    'M24 30 Q24 8 46 8 Q68 8 68 30 Q58 14 46 16 Q34 14 24 30Z M40 6 Q46 -4 54 6Z',
    'M18 44 Q14 6 46 6 Q78 6 74 44 Q72 30 68 24 Q46 30 24 24 Q20 30 18 44Z',
  ][style];
  const mouth = mood === 'happy'
    ? '<path d="M38 46 Q46 54 54 46" stroke="#5a2a1a" stroke-width="3" fill="none" stroke-linecap="round"/>'
    : mood === 'shock'
      ? '<ellipse cx="46" cy="48" rx="4" ry="5" fill="#5a2a1a"/>'
      : '<path d="M38 50 Q46 43 54 50" stroke="#5a2a1a" stroke-width="3" fill="none" stroke-linecap="round"/>';
  const face = hasAvatar
    ? ''
    : `<circle cx="46" cy="36" r="24" fill="${skin}"/>
       <path d="${hairPath}" fill="${hair}"/>
       <g class="eyes"><ellipse cx="37" cy="38" rx="3.4" ry="4.2" fill="#1b1030"/><ellipse cx="55" cy="38" rx="3.4" ry="4.2" fill="#1b1030"/>
       <circle cx="38.2" cy="36.6" r="1.2" fill="#fff"/><circle cx="56.2" cy="36.6" r="1.2" fill="#fff"/></g>
       <ellipse cx="31" cy="45" rx="4" ry="2.4" fill="#ff7a9a" opacity=".55"/><ellipse cx="61" cy="45" rx="4" ry="2.4" fill="#ff7a9a" opacity=".55"/>
       ${mouth}
       ${mood === 'sad' ? '<path d="M58 42 q2 6 0 8 q-2 -2 0 -8z" fill="#7fd3ff"/>' : ''}`;
  return `<svg viewBox="0 0 92 100" xmlns="http://www.w3.org/2000/svg" class="chibi ${size}">
    <defs><pattern id="st${seed}" width="8" height="8" patternUnits="userSpaceOnUse"><rect width="8" height="4" fill="${suit}"/><rect y="4" width="8" height="4" fill="${suitDark}"/></pattern></defs>
    <ellipse cx="46" cy="96" rx="26" ry="4" fill="rgba(0,0,0,.45)"/>
    <path d="M24 92 Q22 66 46 62 Q70 66 68 92Z" fill="url(#st${seed})" stroke="${suitDark}" stroke-width="1.5"/>
    <rect x="34" y="70" width="24" height="9" rx="2" fill="#0b0f22" opacity=".85"/>
    <text x="46" y="77.5" font-size="7" text-anchor="middle" fill="#ffd400" font-family="monospace">${String(1000 + (seed % 9000)).slice(-4)}</text>
    <g class="cuffs"><rect x="16" y="80" width="10" height="6" rx="2" fill="#b9c6e4"/><rect x="66" y="80" width="10" height="6" rx="2" fill="#b9c6e4"/></g>
    <g class="hammer"><rect x="70" y="56" width="4" height="26" rx="2" fill="#8b5a2b" transform="rotate(20 72 69)"/><rect x="64" y="50" width="18" height="9" rx="2" fill="#9aa6bf" transform="rotate(20 72 69)"/></g>
    ${face}
  </svg>`;
}
