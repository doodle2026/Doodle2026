import Link from 'next/link';
import ThemeToggle from './ThemeToggle';

export default function Header({ children }: { children?: React.ReactNode }) {
  return (
    <header className="app-header">
      <Link className="app-header__logo" href="/">📅 GrabAday</Link>
      <div className="app-header__actions">
        {children}
        <ThemeToggle />
      </div>
    </header>
  );
}
