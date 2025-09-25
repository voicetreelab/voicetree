import { useRef, useEffect, useState, useCallback } from 'react';

interface SoundWaveVisualizerProps {
  isActive: boolean;
  audioStream?: MediaStream;
  className?: string;
  barCount?: number;
  barColor?: string;
  fallbackAnimation?: boolean;
}

export default function SoundWaveVisualizer({
  isActive,
  audioStream,
  className = '',
  barCount = 30,
  barColor = 'rgb(37, 99, 235)', // blue-600
  fallbackAnimation = true,
}: SoundWaveVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const dataArrayRef = useRef<Uint8Array | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);

  const [hasRealAudio, setHasRealAudio] = useState(false);
  const [fallbackValues, setFallbackValues] = useState<number[]>([]);
  const [internalStream, setInternalStream] = useState<MediaStream | null>(null);

  // Initialize fallback animation values
  useEffect(() => {
    const values = Array.from({ length: barCount }, (_, i) =>
      8 + Math.sin(i * 0.5) * 12
    );
    setFallbackValues(values);
  }, [barCount]);

  // Try to get microphone access for visualization when no stream is provided
  useEffect(() => {
    if (!audioStream && isActive) {
      navigator.mediaDevices
        .getUserMedia({ audio: true, video: false })
        .then((stream) => {
          setInternalStream(stream);
        })
        .catch((error) => {
          console.warn('Could not access microphone for visualization:', error);
          setInternalStream(null);
        });
    } else {
      // Clean up internal stream if we have an external one or are inactive
      if (internalStream) {
        internalStream.getTracks().forEach(track => track.stop());
        setInternalStream(null);
      }
    }

    return () => {
      if (internalStream) {
        internalStream.getTracks().forEach(track => track.stop());
      }
    };
  }, [audioStream, isActive, internalStream]);

  // Initialize Web Audio API
  const initializeAudio = useCallback(async () => {
    const streamToUse = audioStream || internalStream;
    if (!streamToUse || !isActive) return;

    try {
      // Create audio context
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();

      // Create analyser node
      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = 256;
      analyserRef.current.smoothingTimeConstant = 0.8;

      // Create data array for frequency data
      const bufferLength = analyserRef.current.frequencyBinCount;
      dataArrayRef.current = new Uint8Array(bufferLength);

      // Create source from media stream
      sourceRef.current = audioContextRef.current.createMediaStreamSource(streamToUse);
      sourceRef.current.connect(analyserRef.current);

      setHasRealAudio(true);

      // Resume audio context if needed
      if (audioContextRef.current.state === 'suspended') {
        await audioContextRef.current.resume();
      }
    } catch (error) {
      console.warn('Failed to initialize Web Audio API:', error);
      setHasRealAudio(false);
    }
  }, [audioStream, internalStream, isActive]);

  // Cleanup audio resources
  const cleanupAudio = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    if (sourceRef.current) {
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }

    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    analyserRef.current = null;
    dataArrayRef.current = null;
    setHasRealAudio(false);
  }, []);

  // Real-time audio visualization
  const drawRealWaveform = useCallback(() => {
    const canvas = canvasRef.current;
    const analyser = analyserRef.current;
    const dataArray = dataArrayRef.current;

    if (!canvas || !analyser || !dataArray) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Get frequency data
    analyser.getByteFrequencyData(dataArray);

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Calculate bar dimensions
    const barWidth = canvas.width / barCount;
    const maxBarHeight = canvas.height;

    // Draw frequency bars
    for (let i = 0; i < barCount; i++) {
      // Map audio data to bar index (we have more data points than bars)
      const dataIndex = Math.floor((i / barCount) * dataArray.length);
      const audioValue = dataArray[dataIndex];

      // Convert audio value (0-255) to bar height
      const barHeight = (audioValue / 255) * maxBarHeight * 0.8; // Scale down slightly

      // Calculate position
      const x = i * barWidth;
      const y = (maxBarHeight - barHeight) / 2; // Center the bar vertically

      // Draw bar with rounded corners
      ctx.fillStyle = barColor;
      ctx.beginPath();
      ctx.roundRect(x + barWidth * 0.1, y, barWidth * 0.8, barHeight, 2);
      ctx.fill();
    }

    // Continue animation if active
    if (isActive) {
      animationFrameRef.current = requestAnimationFrame(drawRealWaveform);
    }
  }, [isActive, barCount, barColor]);

  // Fallback animation
  const drawFallbackWaveform = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Calculate bar dimensions
    const barWidth = canvas.width / barCount;
    const maxBarHeight = canvas.height;

    // Animate fallback values
    const time = Date.now() / 100;

    // Draw animated bars
    for (let i = 0; i < barCount; i++) {
      // Create wave-like animation
      const baseHeight = fallbackValues[i];
      const animatedHeight = baseHeight + Math.sin(time + i * 0.3) * 8;
      const barHeight = Math.max(4, animatedHeight);

      // Calculate position
      const x = i * barWidth;
      const y = (maxBarHeight - barHeight) / 2;

      // Draw bar with rounded corners and lower opacity
      ctx.fillStyle = barColor;
      ctx.globalAlpha = 0.3;
      ctx.beginPath();
      ctx.roundRect(x + barWidth * 0.1, y, barWidth * 0.8, barHeight, 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // Continue animation if active
    if (isActive) {
      animationFrameRef.current = requestAnimationFrame(drawFallbackWaveform);
    }
  }, [isActive, barCount, barColor, fallbackValues]);

  // Setup canvas and start visualization
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Set canvas size (accounting for device pixel ratio)
    const rect = canvas.getBoundingClientRect();
    const pixelRatio = window.devicePixelRatio || 1;

    canvas.width = rect.width * pixelRatio;
    canvas.height = rect.height * pixelRatio;

    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.scale(pixelRatio, pixelRatio);
    }

    if (isActive) {
      if (hasRealAudio) {
        drawRealWaveform();
      } else if (fallbackAnimation) {
        drawFallbackWaveform();
      }
    }

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [isActive, hasRealAudio, fallbackAnimation, drawRealWaveform, drawFallbackWaveform]);

  // Initialize audio when stream is available
  useEffect(() => {
    if ((audioStream || internalStream) && isActive) {
      initializeAudio();
    } else {
      cleanupAudio();
    }

    return cleanupAudio;
  }, [audioStream, internalStream, isActive, initializeAudio, cleanupAudio]);

  // Handle window resize
  useEffect(() => {
    const handleResize = () => {
      const canvas = canvasRef.current;
      if (canvas) {
        const rect = canvas.getBoundingClientRect();
        const pixelRatio = window.devicePixelRatio || 1;

        canvas.width = rect.width * pixelRatio;
        canvas.height = rect.height * pixelRatio;

        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.scale(pixelRatio, pixelRatio);
        }
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={`w-full h-full ${className}`}
      style={{
        width: '100%',
        height: '100%',
        display: isActive ? 'block' : 'none',
      }}
    />
  );
}