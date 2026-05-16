import { useCallback, useEffect, useState } from "react";
import { useDocument } from "~/lib/DocumentContext";
import type {
  DocumentVersionSummary,
  DocumentVersionsResponse,
} from "~/shared/document-versions";

interface VersionsPanelProps {
  reloadPage?: () => void;
  confirmRestore?: (version: DocumentVersionSummary) => boolean;
}

function formatReason(reason: DocumentVersionSummary["reason"]): string {
  return reason.charAt(0).toUpperCase() + reason.slice(1);
}

function formatVersionTime(createdAt: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(createdAt));
}

const defaultReloadPage = () => {
  window.location.reload();
};

const defaultConfirmRestore = (version: DocumentVersionSummary) =>
  window.confirm(`Restore the ${formatReason(version.reason).toLowerCase()} version?`);

export default function VersionsPanel({
  reloadPage = defaultReloadPage,
  confirmRestore = defaultConfirmRestore,
}: VersionsPanelProps) {
  const { docId } = useDocument();
  const [versions, setVersions] = useState<DocumentVersionSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  const versionsUrl = `/agents/document-agent/${encodeURIComponent(docId)}/versions`;

  const loadVersions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(versionsUrl);
      if (!res.ok) throw new Error("Failed to load versions");
      const body = (await res.json()) as DocumentVersionsResponse;
      setVersions(body.versions);
    } catch {
      setError("Could not load versions");
    } finally {
      setLoading(false);
    }
  }, [versionsUrl]);

  useEffect(() => {
    void loadVersions();
  }, [loadVersions]);

  const handleRestore = async (version: DocumentVersionSummary) => {
    if (!confirmRestore(version)) return;

    setRestoringId(version.id);
    setError(null);
    try {
      const res = await fetch(
        `${versionsUrl}/${encodeURIComponent(version.id)}/restore`,
        { method: "POST" },
      );
      if (!res.ok) throw new Error("Failed to restore version");
      reloadPage();
    } catch {
      setError("Could not restore version");
      setRestoringId(null);
    }
  };

  const handleSaveVersion = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(versionsUrl, { method: "POST" });
      if (!res.ok) throw new Error("Failed to save version");
      await loadVersions();
    } catch {
      setError("Could not save version");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="border-t border-border">
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-sm uppercase tracking-wider text-muted">
          Versions ({versions.length})
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => void handleSaveVersion()}
            disabled={saving || loading}
            className="cursor-pointer border border-border px-2 py-0.5 text-sm text-muted transition-colors hover:bg-border disabled:cursor-default disabled:opacity-50"
            aria-label="Save version"
          >
            {saving ? "Saving" : "Save version"}
          </button>
          <button
            type="button"
            onClick={loadVersions}
            disabled={loading}
            className="cursor-pointer px-2 py-0.5 text-sm text-muted transition-colors hover:bg-border disabled:cursor-default disabled:opacity-50"
            aria-label="Refresh versions"
          >
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="border-t border-border px-3 py-2 text-sm text-coral">
          {error}
        </div>
      )}

      {!loading && versions.length === 0 && (
        <div className="border-t border-border px-3 py-6 text-center text-muted">
          No versions yet
        </div>
      )}

      {versions.map((version) => (
        <div key={version.id} className="border-t border-border px-3 py-2">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-medium">{formatReason(version.reason)}</div>
              <div className="truncate font-mono text-xs text-muted">
                {formatVersionTime(version.createdAt)}
              </div>
              <div className="truncate text-xs text-muted">
                {version.createdBy ?? "Unknown editor"}
              </div>
            </div>
            <button
              type="button"
              onClick={() => void handleRestore(version)}
              disabled={restoringId === version.id}
              className="shrink-0 cursor-pointer border border-border px-2 py-1 text-xs uppercase tracking-wider text-muted transition-colors hover:bg-border disabled:cursor-default disabled:opacity-50"
              aria-label={`Restore ${version.reason} version`}
            >
              Restore
            </button>
          </div>
        </div>
      ))}
    </section>
  );
}
