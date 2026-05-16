import { useRef, useState, useCallback } from "react";
import { getAgentByName } from "agents";
import { useNavigate } from "react-router";
import type { Route } from "./+types/home";
import { APP_NAME, generateDocumentId } from "~/shared/constants";
import {
  forwardMistIdentityHeaders,
  getOwnerFromHeaders,
  hasOwnerIdentity,
  type DocumentOwner,
} from "~/shared/document-metadata";
import {
  DOCUMENT_INDEX_AGENT_NAME,
  type DocumentIndexEntry,
  type DocumentIndexListResponse,
} from "~/shared/document-index";
import { getPublicOrigin } from "~/shared/public-origin";
import { getCloudflare } from "~/lib/cloudflare.server";
import { deserializeThreads } from "~/lib/thread-serialization";
import ThemeSelector from "~/components/ThemeSelector";
import demoDocument from "./demo.md?raw";

export function formatDocumentTime(updatedAt: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(updatedAt));
}

async function loadOwnedDocuments(
  request: Request,
  context: Route.LoaderArgs["context"],
  owner: DocumentOwner,
): Promise<DocumentIndexEntry[]> {
  if (!hasOwnerIdentity(owner)) return [];

  try {
    const { env } = getCloudflare(context);
    const stub = await getAgentByName(
      env.DocumentIndexAgent,
      DOCUMENT_INDEX_AGENT_NAME,
    );
    const headers = new Headers();
    forwardMistIdentityHeaders(headers, request.headers);
    const res = await stub.fetch(
      new Request("https://index/documents", { headers }),
    );
    if (!res.ok) return [];

    const body = (await res.json()) as DocumentIndexListResponse;
    return body.documents;
  } catch {
    return [];
  }
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const owner = getOwnerFromHeaders(request.headers);
  return {
    origin: getPublicOrigin(request),
    owner,
    documents: await loadOwnedDocuments(request, context, owner),
  };
}

export function meta(_args: Route.MetaArgs) {
  return [
    { title: "mist" },
    { name: "description", content: "Collaborative markdown editor" },
  ];
}

type HomeProps = Route.ComponentProps & {
  confirmDelete?: (document: DocumentIndexEntry) => boolean;
};

const defaultConfirmDelete = (document: DocumentIndexEntry) =>
  window.confirm(`Delete ${document.id}?`);

export default function Home({
  loaderData,
  confirmDelete = defaultConfirmDelete,
}: HomeProps) {
  const { origin, owner, documents } = loaderData;
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);
  const [ownedDocuments, setOwnedDocuments] =
    useState<DocumentIndexEntry[]>(documents);
  const [deletingDocumentId, setDeletingDocumentId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const curlCommand = `curl ${origin}/new -T file.md`;

  function handleCopy() {
    navigator.clipboard.writeText(curlCommand);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleNewDocument() {
    const { body, threads, onboarding } = deserializeThreads(demoDocument);
    const id = generateDocumentId();
    await fetch(`/agents/document-agent/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: body, threads, onboarding }),
    });
    navigate(`/docs/${id}`);
  }

  async function handleDeleteDocument(document: DocumentIndexEntry) {
    if (!confirmDelete(document)) return;

    setDeletingDocumentId(document.id);
    setDeleteError(null);
    try {
      const res = await fetch(
        `/agents/document-agent/${encodeURIComponent(document.id)}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error("Delete failed");
      setOwnedDocuments((current) =>
        current.filter((item) => item.id !== document.id),
      );
    } catch {
      setDeleteError("Could not delete document");
    } finally {
      setDeletingDocumentId(null);
    }
  }

  const handleUpload = useCallback(
    async (file: File) => {
      const text = await file.text();
      const { body, threads } = deserializeThreads(text);
      const id = generateDocumentId();

      // Create the document with initial content + threads via POST body
      await fetch(`/agents/document-agent/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: body, threads }),
      });

      navigate(`/docs/${id}`);
    },
    [navigate],
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleUpload(file);
    },
    [handleUpload],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file && file.name.endsWith(".md")) handleUpload(file);
    },
    [handleUpload],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  return (
    <>
      <div
        className="relative flex min-h-screen flex-col items-center justify-center px-4"
        onDrop={handleDrop}
        onDragOver={handleDragOver}
      >
        <div className="absolute right-3 top-3">
          <ThemeSelector />
        </div>
        <h1 className="mb-1 font-bold">{APP_NAME}</h1>
        <p className="mb-8 text-muted">
          Share and edit Markdown together, quickly
        </p>
        <div className="flex flex-col gap-3 sm:flex-row">
          <button
            onClick={handleNewDocument}
            className="cursor-pointer whitespace-nowrap border border-ink bg-ink px-6 py-2 text-paper transition-opacity hover:opacity-80"
          >
            New document
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="cursor-pointer whitespace-nowrap border border-border px-6 py-2 text-muted transition-colors hover:border-ink hover:text-ink"
          >
            Drag and drop .md file
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".md"
          onChange={handleFileChange}
          className="hidden"
        />
        <p className="mt-8 text-muted">Or from your terminal</p>
        <div className="mt-2 flex max-w-full items-center gap-1.5">
          <code className="flex min-w-0 items-center overflow-x-auto font-mono text-base">
            <span className="md-delimiter shrink-0">`</span>
            <span className="md-code whitespace-nowrap">{curlCommand}</span>
            <span className="md-delimiter shrink-0">`</span>
          </code>
          <button
            onClick={handleCopy}
            className="shrink-0 cursor-pointer p-1 text-muted hover:text-ink transition-colors"
            aria-label={copied ? "Copied" : "Copy command"}
          >
            {copied ? (
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : (
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            )}
          </button>
        </div>
        {hasOwnerIdentity(owner) && (
          <section className="mt-10 w-full max-w-2xl border-t border-border">
            <div className="flex items-baseline justify-between gap-4 py-2">
              <h2 className="text-sm font-normal uppercase tracking-wider text-muted">
                Your documents
              </h2>
              <span className="truncate text-sm text-muted">
                {owner.login ?? owner.name ?? owner.id}
              </span>
            </div>
            {deleteError && (
              <div className="border-t border-border px-3 py-2 text-sm text-coral">
                {deleteError}
              </div>
            )}
            {ownedDocuments.length === 0 ? (
              <div className="border-t border-border py-5 text-center text-muted">
                No documents yet
              </div>
            ) : (
              <div className="border-t border-border">
                {ownedDocuments.map((document) => {
                  const documentName = document.name ?? document.id;

                  return (
                    <div
                      key={document.id}
                      className="grid grid-cols-[minmax(0,1fr)_auto] items-stretch border-b border-border"
                    >
                      <a
                        href={`/docs/${document.id}`}
                        className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-baseline gap-4 py-2 pr-3 text-left transition-colors hover:text-coral"
                        aria-label={documentName}
                      >
                        <span className="min-w-0">
                          <span
                            className={
                              document.name
                                ? "block truncate text-sm font-medium"
                                : "block truncate font-mono text-sm"
                            }
                          >
                            {documentName}
                          </span>
                          {document.name && (
                            <span className="block truncate font-mono text-xs text-muted">
                              {document.id}
                            </span>
                          )}
                        </span>
                        <span className="shrink-0 font-mono text-xs text-muted">
                          {formatDocumentTime(document.updatedAt)}
                        </span>
                      </a>
                      <button
                        type="button"
                        onClick={() => void handleDeleteDocument(document)}
                        disabled={deletingDocumentId === document.id}
                        className="cursor-pointer border-l border-border px-3 text-xs uppercase tracking-wider text-muted transition-colors hover:bg-border hover:text-ink disabled:cursor-default disabled:opacity-50"
                        aria-label={`Delete ${document.id}`}
                      >
                        Delete
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}
      </div>
      <footer className="fixed bottom-0 left-0 right-0 z-10 flex items-baseline justify-between border-t border-border bg-paper px-4 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] text-base text-muted">
        <span>
          <span className="whitespace-nowrap">Work in progress.</span> Bugs and
          feedback on{" "}
          <a
            href="https://github.com/inanimate-tech/mist"
            target="_blank"
            rel="noopener noreferrer"
            className="text-ink transition-colors hover:text-coral"
          >
            GitHub
          </a>
          .
        </span>
        <span className="font-mono font-light uppercase tracking-wider text-ink">
          MIT licensed
        </span>
      </footer>
    </>
  );
}
