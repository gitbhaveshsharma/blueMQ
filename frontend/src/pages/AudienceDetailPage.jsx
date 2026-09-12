import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, RefreshCw, Send, Trash2, Users } from "lucide-react";
import toast from "react-hot-toast";
import AudienceEditor from "../components/audience/AudienceEditor";
import { api } from "../services/api";

export default function AudienceDetailPage() {
  const { audienceId } = useParams();
  const navigate = useNavigate();
  const isNew = audienceId === "new";
  const [audience, setAudience] = useState(null);
  const [loading, setLoading] = useState(!isNew);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (isNew) return;
    setLoading(true);
    try {
      const response = await api.getAudience(audienceId);
      setAudience(response.data);
      setError("");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [audienceId, isNew]);

  useEffect(() => {
    load();
  }, [load]);

  async function remove() {
    if (!window.confirm(`Delete "${audience.name}" and all its members?`))
      return;
    try {
      await api.deleteAudience(audience.id);
      toast.success("Audience deleted");
      navigate("/audiences");
    } catch (err) {
      toast.error(err.message);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <button
            type="button"
            onClick={() => navigate("/audiences")}
            className="mb-2 flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-700"
          >
            <ArrowLeft size={13} /> All audiences
          </button>
          <h2 className="flex items-center gap-2 text-xl font-bold text-gray-900">
            <Users size={22} className="text-indigo-500" />
            {isNew ? "New audience" : audience?.name || "Audience"}
          </h2>
          {!isNew && audience && (
            <p className="mt-1 text-sm text-gray-500">
              {audience.member_count} member
              {audience.member_count === 1 ? "" : "s"} · ID {audience.id}
            </p>
          )}
        </div>
        {!isNew && audience && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={load}
              className="rounded-lg border p-2 text-gray-400 hover:bg-gray-50"
              title="Refresh"
            >
              <RefreshCw size={16} />
            </button>
            <button
              type="button"
              onClick={() => navigate("/send")}
              className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
            >
              <Send size={14} /> Broadcast
            </button>
            <button
              type="button"
              onClick={remove}
              className="rounded-lg border p-2 text-gray-400 hover:bg-red-50 hover:text-red-500"
              title="Delete audience"
            >
              <Trash2 size={16} />
            </button>
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        {loading ? (
          <div className="flex justify-center py-16">
            <RefreshCw className="animate-spin text-indigo-500" />
          </div>
        ) : error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            <p>{error}</p>
            <button
              type="button"
              onClick={load}
              className="mt-2 text-xs font-medium underline"
            >
              Try again
            </button>
          </div>
        ) : (
          <AudienceEditor
            key={audience?.id || "new"}
            audience={audience}
            onSaved={(saved) => {
              setAudience(saved);
              if (isNew && saved?.id) {
                navigate(`/audiences/${saved.id}`, { replace: true });
              }
            }}
          />
        )}
      </div>
    </div>
  );
}
