import { useEffect, useLayoutEffect, useRef } from "react";

// Protected links leave the DOM while their read is pending. Remember only
// focus identity, not live controls, and abandon it if the user moves focus.
export function useNavigationFocus(
  settled: boolean,
  attribute = "data-navigation-focus",
) {
  const scope = useRef<HTMLElement>(null);
  const fallback = useRef<HTMLHeadingElement>(null);
  const previous = useRef<string | undefined>(undefined);
  const discard = () => {
    previous.current = undefined;
  };
  const remember = () => {
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && scope.current?.contains(focused))
      previous.current = focused.getAttribute(attribute) ?? undefined;
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
      scope.current?.querySelectorAll<HTMLElement>(`[${attribute}]`) ?? [],
    ).find(
      (element) =>
        element.getAttribute(attribute) === key &&
        !element.matches(
          ":disabled, [aria-disabled=true], [data-focus-fallback-only]",
        ) &&
        !element.closest("[hidden]"),
    );
    (target ?? fallback.current)?.focus();
  }, [settled, attribute]);
  return { scope, fallback, remember, discard };
}
