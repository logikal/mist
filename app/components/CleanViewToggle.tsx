import { useDocument } from "~/lib/DocumentContext";

export default function CleanViewToggle() {
  const { cleanView, toggleCleanView } = useDocument();

  return (
    <label className="flex cursor-pointer items-center gap-2 px-4 py-3">
      <input
        type="checkbox"
        checked={!cleanView}
        onChange={toggleCleanView}
        className="h-4 w-4 accent-coral"
      />
      <span className="text-sm text-muted">Show editing markup</span>
    </label>
  );
}
