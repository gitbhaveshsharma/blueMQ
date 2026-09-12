import { useEffect } from "react";
import { ExternalLink, X } from "lucide-react";
import { Link } from "react-router-dom";
import AudienceEditor from "./AudienceEditor";

/**
 * Right-side sheet wrapper around AudienceEditor. The dedicated page at
 * /audiences/:audienceId renders the same editor for full-screen work.
 */
export default function AudienceManager({
  isOpen,
  audience,
  onClose,
  onSaved,
  onSelect,
}) {
  useEffect(() => {
    if (!isOpen) return undefined;
    function handleKey(event) {
      if (event.key === "Escape") onClose?.();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40">
      <div className="flex h-full w-full max-w-2xl flex-col bg-white shadow-2xl">
        <header className="flex items-start justify-between border-b px-6 py-4">
          <div className="min-w-0">
            <h3 className="text-lg font-bold text-gray-900">
              {audience?.id ? "Manage audience" : "Create audience"}
            </h3>
            <p className="mt-0.5 truncate text-xs text-gray-500">
              {audience?.id
                ? `ID ${audience.id}`
                : "Create the audience, then add or import members."}
            </p>
          </div>
          <div className="flex items-center gap-1">
            {audience?.id && (
              <Link
                to={`/audiences/${audience.id}`}
                onClick={onClose}
                className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
                title="Open full page"
              >
                <ExternalLink size={12} /> Full page
              </Link>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-2 text-gray-400 hover:bg-gray-100"
            >
              <X size={18} />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-6">
          <AudienceEditor
            key={audience?.id || "new"}
            audience={audience}
            onSaved={onSaved}
            onSelect={onSelect}
          />
        </div>
      </div>
    </div>
  );
}
