interface AnimatedMicIconProps {
  isRecording: boolean;
  size?: number;
}

export default function AnimatedMicIcon({
  isRecording,
  size = 24
}: AnimatedMicIconProps): import("/Users/bobbobby/repos/VoiceTree/frontend/webapp/node_modules/@types/react/jsx-runtime").JSX.Element {
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
          x="5"
          y="5"
          width="14"
          height="14"
          fill="currentColor"
          rx="5"
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
          r="11"
          fill="currentColor"
          className="transition-all duration-300 ease-in-out"
        />
      )}
    </svg>
  );
}
