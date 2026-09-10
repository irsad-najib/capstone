/**
 * TopBar — sticky page header.
 * Automatically offsets to the right of the desktop sidebar.
 */
interface TopBarProps {
  left?: React.ReactNode;
  right?: React.ReactNode;
}

export default function TopBar({ left, right }: TopBarProps) {
  return (
    <header className="fixed top-0 left-0 lg:left-64 right-0 z-40 h-16 flex items-center justify-between px-4 md:px-12 bg-surface/90 backdrop-blur-xl border-b border-outline-variant">
      <div className="flex items-center gap-4">{left}</div>
      {right && <div className="flex items-center gap-3">{right}</div>}
    </header>
  );
}
