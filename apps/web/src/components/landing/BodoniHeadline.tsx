/**
 * Display headline for the landing hero (issue #33), split into its own module
 * so the Bodoni Moda face is only requested by visitors who render the landing.
 *
 * `font-serif` maps to the M3 token stack `--font-serif` (Bodoni Moda first —
 * see index.css @theme), not the Georgia fallback an inline style would risk.
 *
 * @module components/landing/BodoniHeadline
 */
export default function BodoniHeadline() {
  return (
    <h1 className="font-serif text-4xl leading-tight font-medium sm:text-5xl">
      Your agents, your machine.
    </h1>
  );
}
