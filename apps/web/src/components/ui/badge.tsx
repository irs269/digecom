import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/** Badge de statut : 4 couleurs de la charte (vert, orange, bleu, rouge). */
const badgeVariants = cva(
  'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold leading-5',
  {
    variants: {
      tone: {
        green: 'bg-status-green-bg text-status-green-fg',
        orange: 'bg-status-orange-bg text-status-orange-fg',
        blue: 'bg-status-blue-bg text-status-blue-fg',
        red: 'bg-status-red-bg text-status-red-fg',
      },
    },
    defaultVariants: { tone: 'blue' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
