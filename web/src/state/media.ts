import { useEffect, useState } from 'react';

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false));
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const on = () => setMatches(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return matches;
}

export const PHONE_QUERY = '(max-width: 599px)';

const isTextField = (el: Element | null) =>
  !!el && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && !['checkbox', 'radio', 'range', 'button', 'submit', 'file'].includes((el as HTMLInputElement).type)));

/**
 * Marks <html data-keyboard="open"> while a text field is focused on a touch device (or the visual
 * viewport shrinks), so fixed bars can step aside for the on-screen keyboard.
 */
export function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const coarse = window.matchMedia?.('(pointer: coarse)').matches;
    if (!coarse) return;
    const vv = window.visualViewport;
    const update = () => {
      const focused = isTextField(document.activeElement);
      const shrunk = vv ? vv.height < window.innerHeight * 0.75 : false;
      setOpen(focused || shrunk);
    };
    const later = () => setTimeout(update, 50);
    document.addEventListener('focusin', update);
    document.addEventListener('focusout', later);
    // A focused field that unmounts (e.g. on navigation) never fires focusout, so re-check then too.
    window.addEventListener('hashchange', later);
    document.addEventListener('pointerdown', later, { passive: true });
    vv?.addEventListener('resize', update);
    return () => {
      document.removeEventListener('focusin', update);
      document.removeEventListener('focusout', later);
      window.removeEventListener('hashchange', later);
      document.removeEventListener('pointerdown', later);
      vv?.removeEventListener('resize', update);
    };
  }, []);
  useEffect(() => {
    document.documentElement.dataset.keyboard = open ? 'open' : 'closed';
  }, [open]);
  return open;
}
