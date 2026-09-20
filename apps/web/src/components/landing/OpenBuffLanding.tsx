import { CheckIcon, CopyIcon } from "lucide-react";
import { lazy, Suspense, useState } from "react";

import { Button } from "../ui/button";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";

const BodoniHeadline = lazy(() => import("./BodoniHeadline"));

const NODE_ENGINES = "^22.16 || ^23.11 || >=24.10";
const START_COMMAND = "npx @princetheprogrammerbtw/openbuff@latest";

const FACTS: ReadonlyArray<{ readonly title: string; readonly body: string }> = [
  {
    title: "One provider, in-process",
    body: "OpenBuff drives the Freebuff agent directly through its SDK — no provider CLIs to install or keep current.",
  },
  {
    title: "Your browser, your machine",
    body: "The web UI talks to the server on your machine over pairing URLs. No relay proxies your agent traffic.",
  },
  {
    title: "Approvals stay inline",
    body: "Pick a permission mode per thread; commands stop for approval in the conversation, where you answer them.",
  },
];

function CopyCommandChip() {
  // The success announcement fires from `onCopy` only: the clipboard write is
  // async and can be denied, so announcing in the click handler would claim
  // success for a failed copy (CodeRabbit, #65).
  const [announced, setAnnounced] = useState(false);
  const { copyToClipboard, isCopied } = useCopyToClipboard({
    target: "start command",
    onCopy: () => {
      setAnnounced(true);
      window.setTimeout(() => setAnnounced(false), 2000);
    },
  });

  return (
    <div className="inline-flex items-center gap-1 rounded-[--radius-md] border border-border bg-muted/40 py-1.5 pr-1.5 pl-4 font-mono text-sm">
      <code className="text-foreground">{START_COMMAND}</code>
      <Button
        variant="ghost"
        size="sm"
        className="size-8 p-0"
        aria-label="Copy command"
        onClick={() => copyToClipboard(START_COMMAND)}
      >
        {isCopied ? <CheckIcon className="size-4" /> : <CopyIcon className="size-4" />}
      </Button>
      <span role="status" aria-live="polite" className="sr-only">
        {announced ? "Copied" : ""}
      </span>
    </div>
  );
}

/**
 * Public landing page for logged-out visitors of a local OpenBuff server
 * (issue #33).
 *
 * Pure typography and CSS on the M3 Expressive tokens the app already loads;
 * zero images, zero new fonts, one lazy chunk. Copy follows the unslop
 * checklist: every claim is verifiable in-repo.
 *
 * @module components/landing/OpenBuffLanding
 */
export function OpenBuffLanding() {
  return (
    <main className="min-h-dvh overflow-y-auto bg-background text-foreground">
      <div className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col justify-center gap-14 px-8 py-16">
        <section
          className="animate-in"
          style={{ animation: "landing-enter 700ms var(--ease-emphasized) both" }}
        >
          <Suspense fallback={<span className="text-4xl">Your agents, your machine.</span>}>
            <BodoniHeadline />
          </Suspense>
          <p className="text-muted-foreground mt-4 max-w-xl text-base leading-relaxed">
            OpenBuff is a local server and web UI that runs the Freebuff coding agent on your
            machine. Add a project, pick a permission mode, and watch every command it runs.
          </p>
        </section>

        <section className="flex flex-col items-start gap-3">
          <CopyCommandChip />
          <p className="text-muted-foreground/78 text-sm">
            Requires Node {NODE_ENGINES} and a{" "}
            <a
              href="https://github.com/10xdev4u-alt/openbuff/blob/main/docs/user/install.md"
              className="underline underline-offset-4 hover:text-foreground"
            >
              Freebuff login
            </a>{" "}
            on the server machine.
          </p>
        </section>

        <section className="grid gap-8 sm:grid-cols-3">
          {FACTS.map((fact) => (
            <div key={fact.title} className="flex flex-col gap-2">
              <h2 className="font-display text-sm font-semibold tracking-wide">{fact.title}</h2>
              <p className="text-muted-foreground text-sm leading-relaxed">{fact.body}</p>
            </div>
          ))}
        </section>

        <footer className="text-muted-foreground/60 border-t border-border pt-6 text-xs leading-relaxed">
          <p>
            Designed in Material 3 Expressive after{" "}
            <a
              href="https://github.com/rjwarrier/yata"
              className="underline underline-offset-4 hover:text-foreground"
            >
              rjwarrier/yata
            </a>
            . Type set in Inter Tight, Inter, JetBrains Mono, and Bodoni Moda (SIL OFL,
            self-hosted). Forked from{" "}
            <a
              href="https://github.com/pingdotgg/t3code"
              className="underline underline-offset-4 hover:text-foreground"
            >
              pingdotgg/t3code
            </a>{" "}
            (MIT).
          </p>
        </footer>
      </div>
      <style>{`@keyframes landing-enter { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }`}</style>
    </main>
  );
}
