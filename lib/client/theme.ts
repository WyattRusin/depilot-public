'use client';
import type { Theme } from './api';

const KEY = 'depilot-theme';

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem(KEY, theme); } catch {  }
  const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelectorAll('meta[name="theme-color"]').forEach(m => m.setAttribute('content', dark ? '#121211' : '#FAFAF8'));
}

export const THEME_BOOT = `try{var t=localStorage.getItem('${KEY}');if(t==='dark'||t==='system'||t==='light')document.documentElement.dataset.theme=t;}catch(e){}`;
