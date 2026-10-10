'use client';
import Link from 'next/link';
import ThemeToggle from './ThemeToggle';
import LanguageSwitcher from './LanguageSwitcher';
import { useLp } from '@/i18n/link';

export default function Header({ children }: { children?: React.ReactNode }) {
  const lp = useLp();
  return (
    <header className="app-header">
      <Link className="app-header__logo" href={lp('/')}>📅 GrabAday</Link>
      <div className="app-header__actions">
        {children}
        <LanguageSwitcher />
        <ThemeToggle />
      </div>
    </header>
  );
}
