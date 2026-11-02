/** Life ring with a small quadcopter above it. */
export function Logo({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      {/* life ring */}
      <circle cx="24" cy="29" r="13" fill="none" stroke="#ff6b1a" strokeWidth="7" />
      <circle
        cx="24"
        cy="29"
        r="13"
        fill="none"
        stroke="#fff"
        strokeWidth="7"
        strokeDasharray="10.2 10.2"
        strokeDashoffset="5.1"
      />
      <circle cx="24" cy="29" r="16.5" fill="none" stroke="rgba(0,0,0,0.25)" strokeWidth="0.8" />
      {/* drone */}
      <g stroke="#3fd0bc" strokeWidth="1.8" fill="none" strokeLinecap="round">
        <line x1="14" y1="5" x2="34" y2="5" />
        <line x1="24" y1="5" x2="24" y2="11" />
        <ellipse cx="13" cy="4" rx="5" ry="1.4" />
        <ellipse cx="35" cy="4" rx="5" ry="1.4" />
      </g>
      <rect x="20" y="6.5" width="8" height="4" rx="1.5" fill="#3fd0bc" />
    </svg>
  );
}
