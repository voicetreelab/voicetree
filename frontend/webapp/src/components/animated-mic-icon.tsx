interface AnimatedMicIconProps {
  isRecording: boolean;
  size?: number;
}

export default function AnimatedMicIcon({
  isRecording,
  size = 24
}: AnimatedMicIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="inline-block"
    >
      {isRecording ? (
        // Recording state: smaller red square (iPhone-style)
        <rect
          x="7"
          y="7"
          width="10"
          height="10"
          fill="currentColor"
          rx="2"
          className="transition-all duration-300 ease-in-out"
        >
          <animate
            attributeName="opacity"
            values="1;0.6;1"
            dur="1.5s"
            repeatCount="indefinite"
          />
        </rect>
      ) : (
        // Ready state: full red circle (iPhone-style) - static
        <circle
          cx="12"
          cy="12"
          r="9"
          fill="currentColor"
          className="transition-all duration-300 ease-in-out"
        />
      )}
    </svg>
  );
}
