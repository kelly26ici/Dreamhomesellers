'use client';

/**
 * SimonLayoutWrapper — Desktop side-by-side split screen resizer.
 * When Simon opens in 'docked' mode on desktop (lg+), this container smoothly
 * contracts by 440px so the page reflows alongside the concierge without covering content.
 *
 * The `/simon-chat` exception is CSS-driven (see `globals.css`): that shell is
 * route-static, and reading `usePathname` in the root layout would suspend
 * every dynamic route under Cache Components.
 */

import React from 'react';
import { useSimon } from '@/context/SimonContext';

export function SimonLayoutWrapper({ children }: { children: React.ReactNode }) {
  const { viewMode } = useSimon();
  const isDocked = viewMode === 'docked';

  return (
    <div
      className={`simon-layout-wrapper min-h-full flex-1 flex flex-col transition-[margin-right] duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] ${
        isDocked ? 'lg:mr-[440px]' : 'mr-0'
      }`}
    >
      {children}
    </div>
  );
}
