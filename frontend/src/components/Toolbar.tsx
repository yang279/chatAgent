import React from 'react';

export function Toolbar({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
}) {
  return (
    <header className="glass flex items-center justify-between border-b border-mac-line px-6 py-3">
      <div>
        <h1 className="text-lg font-bold text-mac-text">{title}</h1>
        {subtitle && <p className="text-xs text-mac-subtext">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-2">{children}</div>
    </header>
  );
}
