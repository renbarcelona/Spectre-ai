import { Link } from "wouter";
import { EmptyState } from "@/components/kit";

export default function NotFound() {
  return (
    <div className="flex min-h-[70vh] items-center justify-center p-6">
      <div className="panel max-w-md">
        <EmptyState title="404 · Route outside scope" body="This path is not part of the SPECTRE workspace.">
          <Link href="/" className="mt-2 font-mono text-xs text-primary" data-testid="link-home">Return to command overview</Link>
        </EmptyState>
      </div>
    </div>
  );
}
