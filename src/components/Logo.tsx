type LogoProps = {
  size?: number
  className?: string
  ariaLabel?: string
}

export default function Logo({ size = 20, className, ariaLabel = 'LangQueue logo' }: LogoProps) {
  return (
    <svg
      aria-label={ariaLabel}
      className={className}
      height={size}
      role="img"
      viewBox="0 0 128 128"
      width={size}
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect fill="#f6f7f5" height="120" width="120" x="4" y="4" />
      <path d="M4 4h120v120H4zM10 10v108h108V10z" fill="#7a8e94" fillRule="evenodd" />
      <path d="M44 34h15v49h29v15H44z" fill="#4f6c75" />
    </svg>
  )
}
