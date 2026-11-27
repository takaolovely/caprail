/// <reference types="vite/client" />

interface CapRailLogoProps {
  size?: number;
  className?: string;
}

export function CapRailLogo({ size = 32, className = "" }: CapRailLogoProps) {
  return (
    <img
      src={`${import.meta.env.BASE_URL}logo.png`}
      alt="CapRail"
      width={size}
      height={size}
      draggable={false}
      style={{ width: size, height: size }}
      className={`shrink-0 select-none object-contain ${className}`}
    />
  );
}