import React, { useState, useRef, useCallback, useEffect } from 'react'

interface ContextDistanceRingProps {
    /** Current distance value (1-10) */
    value: number
    /** Called when distance changes */
    onChange: (distance: number) => void
    /** Whether the ring is visible */
    isVisible: boolean
    /** Position relative to parent */
    centerX?: number
    centerY?: number
}

const MIN_DISTANCE: number = 1
const MAX_DISTANCE: number = 10
const RING_BASE_RADIUS: number = 40 // Starting radius from center
const RING_RADIUS_PER_UNIT: number = 12 // How much the ring grows per distance unit

/**
 * Radial ring control for adjusting contextNodeMaxDistance.
 *
 * Appears when hovering over Run button, allowing users to:
 * - Scroll wheel to adjust distance (primary)
 * - Drag the ring outward/inward (secondary)
 *
 * Provides immediate visual feedback with expanding gold ring.
 */
export function ContextDistanceRing({
    value,
    onChange,
    isVisible,
    centerX = 0,
    centerY = 0,
}: ContextDistanceRingProps): React.ReactElement | null {
    const ringRef: React.RefObject<SVGSVGElement | null> = useRef<SVGSVGElement>(null)
    const [isDragging, setIsDragging] = useState(false)
    const [dragStartRadius, setDragStartRadius] = useState(0)
    const [dragStartValue, setDragStartValue] = useState(value)

    const currentRadius: number = RING_BASE_RADIUS + (value * RING_RADIUS_PER_UNIT)

    // Handle scroll wheel
    const handleWheel: (e: WheelEvent) => void = useCallback((e: WheelEvent) => {
        if (!isVisible) return
        e.preventDefault()

        const delta: number = e.deltaY > 0 ? -1 : 1
        const newValue: number = Math.max(MIN_DISTANCE, Math.min(MAX_DISTANCE, value + delta))
        if (newValue !== value) {
            onChange(newValue)
        }
    }, [isVisible, value, onChange])

    // Handle drag start
    const handleMouseDown: (e: React.MouseEvent) => void = useCallback((e: React.MouseEvent) => {
        if (!ringRef.current) return

        const rect: DOMRect = ringRef.current.getBoundingClientRect()
        const centerXPx: number = rect.left + rect.width / 2
        const centerYPx: number = rect.top + rect.height / 2
        const dx: number = e.clientX - centerXPx
        const dy: number = e.clientY - centerYPx
        const radius: number = Math.sqrt(dx * dx + dy * dy)

        setIsDragging(true)
        setDragStartRadius(radius)
        setDragStartValue(value)
        e.preventDefault()
    }, [value])

    // Handle drag
    useEffect(() => {
        if (!isDragging) return

        const handleMouseMove: (e: MouseEvent) => void = (e: MouseEvent): void => {
            if (!ringRef.current) return

            const rect: DOMRect = ringRef.current.getBoundingClientRect()
            const centerXPx: number = rect.left + rect.width / 2
            const centerYPx: number = rect.top + rect.height / 2
            const dx: number = e.clientX - centerXPx
            const dy: number = e.clientY - centerYPx
            const currentDragRadius: number = Math.sqrt(dx * dx + dy * dy)

            const radiusDelta: number = currentDragRadius - dragStartRadius
            const valueDelta: number = Math.round(radiusDelta / RING_RADIUS_PER_UNIT)
            const newValue: number = Math.max(MIN_DISTANCE, Math.min(MAX_DISTANCE, dragStartValue + valueDelta))

            if (newValue !== value) {
                onChange(newValue)
            }
        }

        const handleMouseUp: () => void = (): void => {
            setIsDragging(false)
        }

        window.addEventListener('mousemove', handleMouseMove)
        window.addEventListener('mouseup', handleMouseUp)

        return () => {
            window.removeEventListener('mousemove', handleMouseMove)
            window.removeEventListener('mouseup', handleMouseUp)
        }
    }, [isDragging, dragStartRadius, dragStartValue, value, onChange])

    // Attach wheel listener
    useEffect(() => {
        const el: SVGSVGElement | null = ringRef.current
        if (!el || !isVisible) return

        el.addEventListener('wheel', handleWheel, { passive: false })
        return () => el.removeEventListener('wheel', handleWheel)
    }, [isVisible, handleWheel])

    if (!isVisible) return null

    const svgSize: number = (MAX_DISTANCE * RING_RADIUS_PER_UNIT + RING_BASE_RADIUS) * 2 + 40
    const svgCenter: number = svgSize / 2

    // Generate tick marks for each distance level
    const ticks: number[] = Array.from({ length: MAX_DISTANCE }, (_, i) => i + 1)

    return (
        <svg
            ref={ringRef}
            width={svgSize}
            height={svgSize}
            style={{
                position: 'absolute',
                left: centerX - svgSize / 2,
                top: centerY - svgSize / 2,
                pointerEvents: 'all',
                cursor: isDragging ? 'grabbing' : 'default',
                zIndex: 1000,
            }}
        >
            <defs>
                {/* Glow filter for the active ring */}
                <filter id="goldGlow" x="-50%" y="-50%" width="200%" height="200%">
                    <feGaussianBlur stdDeviation="3" result="blur" />
                    <feMerge>
                        <feMergeNode in="blur" />
                        <feMergeNode in="SourceGraphic" />
                    </feMerge>
                </filter>

                {/* Radial gradient for the context zone fill */}
                <radialGradient id="contextZone" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stopColor="rgba(251, 191, 36, 0)" />
                    <stop offset="70%" stopColor="rgba(251, 191, 36, 0.05)" />
                    <stop offset="100%" stopColor="rgba(251, 191, 36, 0.15)" />
                </radialGradient>
            </defs>

            {/* Context zone fill */}
            <circle
                cx={svgCenter}
                cy={svgCenter}
                r={currentRadius}
                fill="url(#contextZone)"
                style={{
                    transition: isDragging ? 'none' : 'r 0.15s ease-out',
                }}
            />

            {/* Tick marks for each distance level */}
            {ticks.map((tick) => {
                const tickRadius: number = RING_BASE_RADIUS + (tick * RING_RADIUS_PER_UNIT)
                const isActive: boolean = tick <= value
                const isCurrent: boolean = tick === value

                return (
                    <g key={tick}>
                        {/* Tick circle */}
                        <circle
                            cx={svgCenter}
                            cy={svgCenter}
                            r={tickRadius}
                            fill="none"
                            stroke={isActive ? 'rgba(251, 191, 36, 0.4)' : 'rgba(255, 255, 255, 0.1)'}
                            strokeWidth={isCurrent ? 2 : 1}
                            strokeDasharray={isCurrent ? 'none' : '2 4'}
                            style={{
                                transition: isDragging ? 'none' : 'stroke 0.15s ease-out',
                            }}
                        />

                        {/* Distance number at 45° angle */}
                        <text
                            x={svgCenter + tickRadius * Math.cos(-Math.PI / 4)}
                            y={svgCenter + tickRadius * Math.sin(-Math.PI / 4)}
                            fill={isActive ? 'rgba(251, 191, 36, 0.9)' : 'rgba(255, 255, 255, 0.3)'}
                            fontSize="10"
                            fontFamily="'JetBrains Mono', 'SF Mono', 'Fira Code', monospace"
                            textAnchor="middle"
                            dominantBaseline="middle"
                            style={{
                                transition: isDragging ? 'none' : 'fill 0.15s ease-out',
                                fontWeight: isCurrent ? 600 : 400,
                            }}
                        >
                            {tick}
                        </text>
                    </g>
                )
            })}

            {/* Main active ring (draggable) */}
            <circle
                cx={svgCenter}
                cy={svgCenter}
                r={currentRadius}
                fill="none"
                stroke="rgba(251, 191, 36, 0.9)"
                strokeWidth={3}
                filter="url(#goldGlow)"
                style={{
                    cursor: 'grab',
                    transition: isDragging ? 'none' : 'r 0.15s ease-out',
                }}
                onMouseDown={handleMouseDown}
            />

            {/* Current value badge */}
            <g transform={`translate(${svgCenter + currentRadius + 16}, ${svgCenter - 8})`}>
                <rect
                    x={-12}
                    y={-8}
                    width={24}
                    height={16}
                    rx={3}
                    fill="rgba(251, 191, 36, 0.2)"
                    stroke="rgba(251, 191, 36, 0.6)"
                    strokeWidth={1}
                />
                <text
                    x={0}
                    y={1}
                    fill="rgba(251, 191, 36, 1)"
                    fontSize="11"
                    fontFamily="'JetBrains Mono', 'SF Mono', 'Fira Code', monospace"
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fontWeight={600}
                    style={{
                        transition: isDragging ? 'none' : 'all 0.15s ease-out',
                    }}
                >
                    {value}
                </text>
            </g>

            {/* Scroll hint */}
            <text
                x={svgCenter}
                y={svgCenter + currentRadius + 28}
                fill="rgba(255, 255, 255, 0.4)"
                fontSize="9"
                fontFamily="'JetBrains Mono', 'SF Mono', 'Fira Code', monospace"
                textAnchor="middle"
            >
                scroll to adjust
            </text>
        </svg>
    )
}
