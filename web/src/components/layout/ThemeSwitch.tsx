'use client';

import { useId } from 'react';

import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useThemePreference } from '@/hooks/useThemePreference';

/** Header control for light/dark; until the user picks, the app follows the computer. */
export function ThemeSwitch() {
  const switchId = useId();
  const { isDark, choosePreference } = useThemePreference();

  return (
    <div className="flex min-h-11 items-center gap-2">
      <Label
        htmlFor={switchId}
        className="cursor-pointer text-sm font-semibold text-brand-foreground"
      >
        Dark mode
      </Label>
      <Switch
        id={switchId}
        checked={isDark}
        onCheckedChange={(checked) =>
          choosePreference(checked ? 'dark' : 'light')
        }
        className="border-2 data-[size=default]:h-6 data-[size=default]:w-11 border-brand-foreground shadow-none focus-visible:border-brand-foreground focus-visible:ring-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-foreground data-[state=checked]:bg-brand-foreground data-[state=unchecked]:bg-transparent dark:data-[state=unchecked]:bg-transparent"
        thumbClassName="bg-brand-foreground data-[state=checked]:translate-x-[22px] data-[state=checked]:bg-brand data-[state=unchecked]:translate-x-[2px] dark:data-[state=checked]:bg-brand dark:data-[state=unchecked]:bg-brand-foreground"
      />
    </div>
  );
}
