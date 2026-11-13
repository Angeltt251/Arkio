export function Logo({ size = 34, withText = true }: { size?: number; withText?: boolean }) {
  return (
    <span className="logo">
      <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
        <defs>
          <linearGradient id="arkio-logo" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#447794" />
            <stop offset="1" stopColor="#123249" />
          </linearGradient>
        </defs>
        <path d="M32 6 6 58h14l12-25 12 25h14z" fill="url(#arkio-logo)" />
        <path d="M24 46h16l-3.5-7h-9z" fill="#123249" opacity=".55" />
      </svg>
      {withText && <span className="logo__text">Arkio</span>}
    </span>
  );
}
