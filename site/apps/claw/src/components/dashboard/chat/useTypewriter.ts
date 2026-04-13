import { useEffect, useRef, useState } from "react";

/**
 * Typewriter reveal for streaming AI responses.
 * - Dynamic speed: short messages ~180 chars/sec, long messages cap at ~3.3s total
 * - Messages under 20 chars skip animation entirely (avoids single-frame flicker)
 * - Snaps to word boundaries for smoother reading
 */
export function useTypewriter(fullText: string, isActive: boolean): string {
  const [displayedLength, setDisplayedLength] = useState(0);
  const rafRef = useRef(0);
  const targetRef = useRef(0);
  const currentRef = useRef(0);
  const textRef = useRef(fullText);

  textRef.current = fullText;
  targetRef.current = fullText.length;

  useEffect(() => {
    if (!isActive) {
      setDisplayedLength(fullText.length);
      currentRef.current = fullText.length;
    }
  }, [isActive, fullText.length]);

  useEffect(() => {
    if (!isActive) return;

    function tick() {
      const target = targetRef.current;
      const text = textRef.current;
      if (currentRef.current < target) {
        if (target < 20) {
          currentRef.current = target;
          setDisplayedLength(target);
          rafRef.current = requestAnimationFrame(tick);
          return;
        }
        const charsPerFrame = Math.max(3, Math.ceil(target / 200));
        let next = Math.min(currentRef.current + charsPerFrame, target);
        if (next < target && text[next] !== " " && text[next] !== "\n") {
          const nextSpace = text.indexOf(" ", next);
          const nextNewline = text.indexOf("\n", next);
          const boundary = Math.min(
            nextSpace === -1 ? target : nextSpace,
            nextNewline === -1 ? target : nextNewline,
          );
          if (boundary - next < 8) next = boundary;
        }
        currentRef.current = next;
        setDisplayedLength(next);
      }
      rafRef.current = requestAnimationFrame(tick);
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [isActive]);

  if (!isActive) return fullText;
  return fullText.slice(0, displayedLength);
}
