import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  description: string;
  /** Optional primary action aligned right. */
  action?: ReactNode;
}

/** Header row that starts every signed-in screen: light title, muted description. */
export function PageHeader({ title, description, action }: PageHeaderProps) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-[1.625rem] leading-tight">{title}</h1>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {action}
    </header>
  );
}
