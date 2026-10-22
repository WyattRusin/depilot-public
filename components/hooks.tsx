'use client';
import { useEffect, useState } from 'react';

export function useDesktop() {
  const [desktop, setDesktop] = useState(false);
  useEffect(() => {
    const m = window.matchMedia('(min-width: 900px) and (hover: hover) and (pointer: fine)');
    const update = () => setDesktop(m.matches);
    update();
    m.addEventListener('change', update);
    return () => m.removeEventListener('change', update);
  }, []);
  return desktop;
}

export function useTouchDevice() {
  const [touch, setTouch] = useState(false);
  useEffect(() => {
    const ua = navigator.userAgent;
    setTouch(/Android|iPhone|iPad|iPod|Mobile/i.test(ua)
      || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
      || window.matchMedia('(pointer: coarse)').matches);
  }, []);
  return touch;
}
