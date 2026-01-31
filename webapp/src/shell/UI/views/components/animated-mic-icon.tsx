import type { JSX } from "react";

interface AnimatedMicIconProps {
  isRecording: boolean;
  isConnecting?: boolean;
  size?: number;
}

export default function AnimatedMicIcon({
  isRecording,
  isConnecting = false,
  size = 24
}: AnimatedMicIconProps): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="inline-block"
    >
      {isConnecting ? (
        // Connecting state: pulsing circle to indicate waiting
        <g className="transition-all duration-300 ease-in-out">
          <circle
            cx="12"
            cy="12"
            r="10"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeDasharray="31.4 31.4"
            strokeLinecap="round"
          >
            <animateTransform
              attributeName="transform"
              type="rotate"
              from="0 12 12"
              to="360 12 12"
              dur="1s"
              repeatCount="indefinite"
            />
          </circle>
          <circle
            cx="12"
            cy="12"
            r="5"
            fill="currentColor"
          >
            <animate
              attributeName="opacity"
              values="1;0.5;1"
              dur="1s"
              repeatCount="indefinite"
            />
          </circle>
        </g>
      ) : isRecording ? (
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
        // Ready state: circle with mic icon inside, subtle animations to draw attention
        <g className="transition-all duration-300 ease-in-out">
          {/* Filter for ultra soft glow */}
          <defs>
            <filter id="softGlow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="2" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Animated glow circle behind main circle */}
          <circle
            cx="12"
            cy="12"
            r="11"
            fill="currentColor"
            filter="url(#softGlow)"
            opacity="0.4"
          >
            <animate
              attributeName="opacity"
              values="0.3;0.5;0.3"
              dur="2.5s"
              repeatCount="indefinite"
            />
          </circle>

          {/* Main circle background */}
          <circle
            cx="12"
            cy="12"
            r="11"
            fill="currentColor"
          />

          {/* Microphone icon - subtle gray, thin strokes, scaled down */}
          <g stroke="#777" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" fill="none" transform="translate(12,12) scale(0.75) translate(-12,-12)">
            <animate
              attributeName="opacity"
              values="0.8;0.5;0.8"
              dur="2.5s"
              repeatCount="indefinite"
            />
            {/* Mic body */}
            <rect x="9" y="4" width="6" height="9" rx="3" />
            {/* Mic stand arc */}
            <path d="M17 10c0 2.76-2.24 5-5 5s-5-2.24-5-5" />
            {/* Mic stand line */}
            <line x1="12" y1="15" x2="12" y2="19" />
            {/* Mic base */}
            <line x1="9" y1="19" x2="15" y2="19" />
          </g>
        </g>
      )}
    </svg>
  );
}
