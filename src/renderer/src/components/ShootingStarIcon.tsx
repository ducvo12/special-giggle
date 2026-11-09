interface ShootingStarIconProps {
  className?: string
  size?: number
}

export default function ShootingStarIcon({ className, size = 16 }: ShootingStarIconProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {/* Upward motion streaks (trailing behind falling star) */}
      <path d="M10 10 L2 2" strokeWidth="2" />
      <path d="M14 7 L7 0.5" strokeWidth="1.3" opacity="0.6" />
      <path d="M7 14 L0.5 7" strokeWidth="1.3" opacity="0.6" />

      {/* Clean hollow 4-pointed celestial star */}
      <path
        d="M 15 5.5 Q 15 15 22.5 15 Q 15 15 15 22.5 Q 15 15 7.5 15 Q 15 15 15 5.5 Z"
        strokeWidth="1.9"
        fill="none"
      />
    </svg>
  )
}
