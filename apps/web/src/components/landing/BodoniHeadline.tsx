/**
 * Display headline for the landing hero (issue #33), split into its own module
 * so the Bodoni Moda face is only requested by visitors who render the landing.
 *
 * @module components/landing/BodoniHeadline
 */
export default function BodoniHeadline() {
  return (
    <h1
      className="text-4xl leading-tight font-medium sm:text-5xl"
      style={{ fontFamily: "var(--font-display-serif, Bodoni Moda), Georgia, serif" }}
    >
      Your agents, your machine.
    </h1>
  );
}
