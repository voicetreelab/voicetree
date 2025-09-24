import type { Token } from "@soniox/speech-to-text-web";
import { useEffect, useRef } from "react";

export default function useAutoScroll(tokens: Token[]) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (tokens.length) {
      ref.current?.scrollTo({
        top: ref.current.scrollHeight,
        behavior: "smooth",
      });
    }
  }, [tokens]);

  return ref;
}
