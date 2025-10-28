import type { Token } from "@soniox/speech-to-text-web";
import { useEffect, useRef } from "react";

export default function useAutoScroll(tokens: Token[]) {
  const ref = useRef<HTMLDivElement>(null);
  const prevTokenCountRef = useRef(0);

  useEffect(() => {
    const currentTokenCount = tokens.length;

    // Only auto-scroll if we have NEW tokens (length increased)
    if (currentTokenCount > prevTokenCountRef.current) {
      ref.current?.scrollTo({
        top: ref.current.scrollHeight,
        behavior: "smooth",
      });

      // Update the previous count
      prevTokenCountRef.current = currentTokenCount;
    }
  }, [tokens.length]); // Depend on LENGTH, not the array reference

  return ref;
}
