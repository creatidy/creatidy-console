import { useEffect, useLayoutEffect, useRef } from "react";

// Protected links leave the DOM while their read is pending. Remember only
// focus identity, not live controls, and abandon it if the user moves focus.
export function useNavigationFocus(settled: boolean) {
  const scope = useRef<HTMLElement>(null);
  const fallback = useRef<HTMLHeadingElement>(null);
  const previous = useRef<string | undefined>(undefined);
  const discard = () => {
    previous.current = undefined;
  };
  const remember = () => {
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && scope.current?.contains(focused))
      previous.current = focused.dataset.navigationFocus;
  };
  useEffect(() => {
    document.addEventListener("focusin", discard);
    return () => document.removeEventListener("focusin", discard);
  }, []);
  useLayoutEffect(() => {
    if (!settled || !previous.current || document.visibilityState !== "visible")
      return;
    const key = previous.current;
    discard();
    if (document.activeElement !== document.body) return;
    const target = Array.from(
      scope.current?.querySelectorAll<HTMLElement>("[data-navigation-focus]") ??
        [],
    ).find((element) => element.dataset.navigationFocus === key);
    (target ?? fallback.current)?.focus({ preventScroll: true });
  }, [settled]);
  return { scope, fallback, remember, discard };
}
