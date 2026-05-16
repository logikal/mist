import { useState, type FormEvent } from "react";
import { data, Link } from "react-router";
import type { Route } from "./+types/docs.$id";
import { getAgentByName } from "agents";
import { isValidDocumentId } from "~/shared/constants";
import type { DocumentMetadata } from "~/shared/document-metadata";
import { getCloudflare } from "~/lib/cloudflare.server";
import { useYjsEditor } from "~/lib/useYjsEditor";
import { DocumentProvider, useDocument } from "~/lib/DocumentContext";
import Editor from "~/components/Editor";
import Preview from "~/components/Preview";
import PreviewToggle from "~/components/PreviewToggle";
import ConnectionStatus from "~/components/ConnectionStatus";
import ShareButton from "~/components/ShareButton";
import ModeToggle from "~/components/ModeToggle";
import CleanViewToggle from "~/components/CleanViewToggle";
import SuggestionActions from "~/components/SuggestionActions";
import CommentInput from "~/components/CommentInput";
import ThreadList from "~/components/ThreadList";
import ThemeSelector from "~/components/ThemeSelector";
import MobilePanel from "~/components/MobilePanel";
import OnboardingBanner from "~/components/OnboardingBanner";
import VersionsPanel from "~/components/VersionsPanel";

export function meta(_args: Route.MetaArgs) {
  return [{ title: "mist" }];
}

export async function loader({ params, context }: Route.LoaderArgs) {
  const id = params.id;
  if (!isValidDocumentId(id)) {
    throw data(null, { status: 404 });
  }

  const { env } = getCloudflare(context);
  const stub = await getAgentByName(env.DocumentAgent, id);
  const res = await stub.fetch(new Request("https://do/"));
  const { exists, createdAt, metadata } = (await res.json()) as {
    exists: boolean;
    createdAt: number | null;
    metadata: DocumentMetadata | null;
  };

  if (!exists) {
    throw data(null, { status: 404 });
  }

  return { id, createdAt, metadata };
}

export function formatExpirationTime(expiresAt: number, now = Date.now()): string {
  const remainingMs = expiresAt - now;
  if (remainingMs <= 0) return "soon";
  const hours = Math.floor(remainingMs / (60 * 60 * 1000));
  if (hours >= 1) return `${hours}h`;
  const minutes = Math.ceil(remainingMs / (60 * 1000));
  return `${minutes}m`;
}

type UpdateDocumentMetadataResponse = {
  ok: true;
  metadata: DocumentMetadata;
};

export function DocumentTitle({
  id,
  metadata,
}: {
  id: string;
  metadata: DocumentMetadata | null;
}) {
  const initialName = metadata?.name ?? "";
  const [savedName, setSavedName] = useState(initialName);
  const [draftName, setDraftName] = useState(initialName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const normalizedDraft = draftName.trim();
  const isDirty = normalizedDraft !== savedName;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isDirty || saving) return;

    setSaving(true);
    setError(null);
    try {
      const res = await fetch(
        `/agents/document-agent/${encodeURIComponent(id)}/metadata`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: normalizedDraft }),
        },
      );
      if (!res.ok) throw new Error("Name save failed");

      const body = (await res.json()) as UpdateDocumentMetadataResponse;
      const nextName = body.metadata.name ?? "";
      setSavedName(nextName);
      setDraftName(nextName);
    } catch {
      setError("Could not save name");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      className="flex min-w-0 items-center gap-2"
      onSubmit={(event) => void handleSubmit(event)}
    >
      <div className="min-w-0">
        <label className="sr-only" htmlFor="document-name">
          Document name
        </label>
        <input
          id="document-name"
          aria-label="Document name"
          value={draftName}
          onChange={(event) => setDraftName(event.target.value)}
          placeholder="Name this doc"
          className="block w-72 max-w-[42vw] min-w-0 bg-transparent p-0 text-sm font-medium text-ink outline-none placeholder:text-muted focus:underline disabled:opacity-50"
          disabled={saving}
        />
        <div className="truncate font-mono text-xs text-muted">{id}</div>
      </div>
      {isDirty && (
        <button
          type="submit"
          disabled={saving}
          className="cursor-pointer border border-border px-2 py-1 text-xs text-muted transition-colors hover:border-ink hover:text-ink disabled:cursor-default disabled:opacity-50"
          aria-label="Save document name"
        >
          {saving ? "Saving" : "Save"}
        </button>
      )}
      {error && (
        <span role="alert" className="whitespace-nowrap text-xs text-coral">
          {error}
        </span>
      )}
    </form>
  );
}

export default function DocumentPage({ loaderData }: Route.ComponentProps) {
  const { id, createdAt, metadata } = loaderData;
  const yjs = useYjsEditor(id);

  return (
    <DocumentProvider docId={id} createdAt={createdAt} yjs={yjs}>
      <DocumentLayout id={id} metadata={metadata} />
    </DocumentProvider>
  );
}

function DocumentLayout({
  id,
  metadata,
}: {
  id: string;
  metadata: DocumentMetadata | null;
}) {
  const {
    yjs,
    showPreview,
    handleEditorReady,
    handleCommentClick,
    commentHighlight,
    activeCommentRange,
    cleanView,
    openCommentInput,
    handleResolveAtCursor,
    handleDeleteAtCursor,
    mode,
  } = useDocument();

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-stretch overflow-x-auto scrollbar-none border-b border-border">
        <Link
          to="/"
          className="flex items-center bg-ink px-4 py-2 font-medium text-paper transition-colors hover:bg-chartreuse hover:text-[#1a1a1a]"
        >
          mist
        </Link>
        <div className="flex grow shrink-0 items-center px-4">
          <DocumentTitle id={id} metadata={metadata} />
          {metadata?.retention.mode === "ttl" && (
            <span className="ml-2 whitespace-nowrap text-muted">
              expires in {formatExpirationTime(metadata.retention.expiresAt)}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center border-l border-border px-3">
          <ConnectionStatus />
        </div>
        <div className="shrink-0 border-l border-border">
          <ShareButton />
        </div>
        <div className="flex shrink-0 items-center border-l border-border">
          <ThemeSelector />
        </div>
      </header>
      <div className="flex flex-1 overflow-hidden">
        <main className="flex-1 overflow-y-auto pb-[33vh] lg:border-r lg:border-border lg:pb-0">
          <Editor
            yjs={yjs}
            hidden={showPreview}
            onEditorReady={handleEditorReady}
            onCommentClick={handleCommentClick}
            commentHighlight={commentHighlight}
            activeCommentRange={activeCommentRange}
            cleanView={cleanView}
            onNewComment={openCommentInput}
            onResolveAtCursor={handleResolveAtCursor}
            onDeleteAtCursor={handleDeleteAtCursor}
          />
          {showPreview && <Preview />}
        </main>
        <aside className="hidden w-96 flex-col overflow-hidden lg:flex">
          <div className="flex-1 overflow-y-auto">
            <OnboardingBanner />
            <ModeToggle />
            <SuggestionActions />
            {mode === "suggest" && <CleanViewToggle />}
            <VersionsPanel />
            <CommentInput />
            <ThreadList />
          </div>
          <div className="shrink-0 border-t border-border">
            <PreviewToggle />
          </div>
        </aside>
      </div>
      <MobilePanel className="lg:hidden" />
    </div>
  );
}
