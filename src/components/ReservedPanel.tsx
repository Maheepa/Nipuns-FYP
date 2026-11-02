import type { ReactNode } from 'react';

interface Props {
  title?: string;
  /** Content to show later; when omitted the panel stays an empty placeholder. */
  children?: ReactNode;
}

/** Empty panel kept for future use (bottom-left quadrant). */
export function ReservedPanel({ title = 'Reserved', children }: Props) {
  return (
    <section className="card reserved">
      <div className="card-head">{title}</div>
      <div className="card-body">{children ?? <span>Reserved for later use</span>}</div>
    </section>
  );
}
