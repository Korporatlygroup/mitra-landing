import { notFound } from 'next/navigation';

/** Catch-all so unknown URLs render the localised not-found page inside the locale layout. */
export default function CatchAll() {
  notFound();
}
