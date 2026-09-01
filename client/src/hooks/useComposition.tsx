import { useCallback, type CompositionEvent, type KeyboardEvent } from "react";

type UseCompositionOptions<T extends HTMLElement> = {
  onKeyDown?: (e: KeyboardEvent<T>) => void;
  onCompositionStart?: (e: CompositionEvent<T>) => void;
  onCompositionEnd?: (e: CompositionEvent<T>) => void;
};

export function useComposition<T extends HTMLElement>(opts: UseCompositionOptions<T>) {
  const onCompositionStart = useCallback(
    (e: CompositionEvent<T>) => {
      opts.onCompositionStart?.(e);
    },
    [opts.onCompositionStart],
  );

  const onCompositionEnd = useCallback(
    (e: CompositionEvent<T>) => {
      opts.onCompositionEnd?.(e);
    },
    [opts.onCompositionEnd],
  );

  const onKeyDown = useCallback(
    (e: KeyboardEvent<T>) => {
      opts.onKeyDown?.(e);
    },
    [opts.onKeyDown],
  );

  return {
    onCompositionStart,
    onCompositionEnd,
    onKeyDown,
  };
}
