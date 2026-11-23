interface BrandIconProps {
  size?: number;
  className?: string;
}

/**
 * Official Circle USDC emblem: #2775CA blue disc with centered white `$`
 * and symmetric white curved parentheses.
 */
export function UsdcLogo({ size = 18, className = "" }: BrandIconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 32 32"
      width={size}
      height={size}
      fill="none"
      aria-hidden="true"
      className={`shrink-0 ${className}`}
    >
      <circle cx="16" cy="16" r="16" fill="#2775CA" />
      <path
        d="M12.2 7.6C8.7 8.9 6.4 12.2 6.4 16c0 3.8 2.3 7.1 5.8 8.4"
        stroke="#FFFFFF"
        strokeWidth="2.1"
        strokeLinecap="round"
      />
      <path
        d="M19.8 7.6C23.3 8.9 25.6 12.2 25.6 16c0 3.8-2.3 7.1-5.8 8.4"
        stroke="#FFFFFF"
        strokeWidth="2.1"
        strokeLinecap="round"
      />
      <path
        d="M16 7.4v17.2"
        stroke="#FFFFFF"
        strokeWidth="1.95"
        strokeLinecap="round"
      />
      <path
        d="M19.2 12.3c0-1.5-1.35-2.6-3.2-2.6-1.8 0-3.15 1.05-3.15 2.45 0 1.5 1.25 2.1 3.2 2.55 2 .45 3.35 1.15 3.35 2.75 0 1.6-1.45 2.75-3.45 2.75-1.95 0-3.35-1.05-3.5-2.65"
        stroke="#FFFFFF"
        strokeWidth="2.05"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Official Celo token emblem: signature Celo yellow (#FCFF52) badge
 * with bold black (#000000) geometric square C mark open on the right.
 */
export function CeloLogo({ size = 18, className = "" }: BrandIconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 32 32"
      width={size}
      height={size}
      fill="none"
      aria-hidden="true"
      className={`shrink-0 ${className}`}
    >
      <rect width="32" height="32" rx="16" fill="#FCFF52" />
      <path
        d="M8.5 8.5H23.5V14H19.4V12.4H12.6V19.6H19.4V18H23.5V23.5H8.5V8.5Z"
        fill="#000000"
      />
    </svg>
  );
}

/**
 * Official Uniswap emblem: crisp Uniswap pink (#FF007A) unicorn silhouette.
 */
export function UniswapLogo({ size = 18, className = "" }: BrandIconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 32 32"
      width={size}
      height={size}
      fill="none"
      aria-hidden="true"
      className={`shrink-0 ${className}`}
    >
      {/* Horn */}
      <path
        d="M5.2 3.8L14.3 9.7L11.8 12.1L5.2 3.8Z"
        fill="#FF007A"
      />
      {/* Head, ear, snout & flowing mane silhouette */}
      <path
        d="M15.8 6.4C16.8 7.5 17.5 8.9 17.7 10.2C20.5 10.8 23.2 12.4 25.1 15.1C26.7 17.4 27.3 20.4 26.6 23.5C26.2 25.1 25.3 26.5 24.1 27.7C24.5 25.7 24.3 23.8 23.4 22.3C22.7 24.2 21.5 26 19.7 27.5C20.2 25.4 20.1 23.5 19.2 21.8C17.8 22.8 16.5 24.4 15.8 27.5H13.5C13.7 24.2 14.4 21.4 15.7 19.3C14.1 19.7 12.6 20.2 11.4 20.6C9.9 21.1 8.5 20.4 8.1 19.1C7.8 18.1 8.3 17.1 9.2 16.4L12.1 13.7C11.8 12.6 12.1 11.3 13 10.4L14.4 9.1C14.7 8 15.1 7.1 15.8 6.4Z"
        fill="#FF007A"
      />
      {/* Subtle mane motion lines */}
      <path
        d="M19.8 13.4C22.1 14.3 23.7 16.2 24.3 18.8"
        stroke="#FFFFFF"
        strokeWidth="1.2"
        strokeLinecap="round"
        opacity="0.7"
      />
      {/* Eye detail */}
      <circle cx="13.5" cy="14.6" r="0.95" fill="#FFFFFF" />
    </svg>
  );
}
