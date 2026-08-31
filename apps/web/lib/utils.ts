import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * The class merger every shadcn/ui component expects.
 *
 * `clsx` flattens conditionals; `twMerge` then resolves Tailwind conflicts by
 * last-one-wins (`px-2 px-4` -> `px-4`), which is what lets a caller override a
 * component's own padding through its `className` prop.
 *
 * Only for Tailwind class strings — the existing hand-written classes
 * (`.card`, `.btn`, …) are not Tailwind and twMerge will leave them alone.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
