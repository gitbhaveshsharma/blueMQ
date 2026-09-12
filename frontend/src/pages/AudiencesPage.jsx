import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ExternalLink,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Users,
} from "lucide-react";
import toast from "react-hot-toast";
import AudienceManager from "../components/audience/AudienceManager";
import { api } from "../services/api";

export default function AudiencesPage() {
  const navigate = useNavigate();
  const [audiences, setAudiences] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState(undefined);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.getAudiences();
      setAudiences(response.data || []);
    } catch (error) {
      toast.error(`Failed to load audiences: ${error.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return query
      ? audiences.filter((audience) =>
          `${audience.name} ${audience.description || ""}`
            .toLowerCase()
            .includes(query),
        )
      : audiences;
  }, [audiences, search]);

  async function remove(audience) {
    if (!window.confirm(`Delete "${audience.name}" and all its members?`)) return;
    try {
      await api.deleteAudience(audience.id);
      toast.success("Audience deleted");
      load();
    } catch (error) {
      toast.error(error.message);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold text-gray-900">
            <Users size={22} className="text-indigo-500" />
            Audiences
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            Build reusable recipient groups for broadcast notifications.
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={load} className="rounded-lg border p-2 text-gray-400 hover:bg-gray-50" title="Refresh">
            <RefreshCw size={16} />
          </button>
          <button type="button" onClick={() => setEditing(null)} className="rounded-xl border px-3 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50" title="Create in side sheet">
            Quick create
          </button>
          <button type="button" onClick={() => navigate("/audiences/new")} className="flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white">
            <Plus size={16} /> New audience
          </button>
        </div>
      </div>

      <div className="relative max-w-sm">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search audiences…" className="w-full rounded-xl border border-gray-200 bg-white py-2.5 pl-9 pr-4 text-sm shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100" />
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><RefreshCw className="animate-spin text-indigo-500" /></div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-gray-200 py-20 text-center">
          <Users size={46} className="mx-auto mb-3 text-gray-300" />
          <h3 className="font-semibold text-gray-700">
            {search ? "No matching audiences" : "No audiences yet"}
          </h3>
          {!search && (
            <button type="button" onClick={() => navigate("/audiences/new")} className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white">
              Create audience
            </button>
          )}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((audience) => (
            <article key={audience.id} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm transition-all hover:border-indigo-200 hover:shadow-md">
              <button
                type="button"
                onClick={() => navigate(`/audiences/${audience.id}`)}
                className="mb-3 flex w-full items-center gap-3 text-left"
                title="Open audience page"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-100 text-indigo-600"><Users size={18} /></div>
                <div className="min-w-0 flex-1">
                  <h3 className="truncate font-semibold text-gray-900">{audience.name}</h3>
                  <p className="text-xs text-gray-400">{audience.member_count} members</p>
                </div>
              </button>
              {audience.description && <p className="mb-4 line-clamp-2 text-sm text-gray-500">{audience.description}</p>}
              <div className="flex justify-end gap-1">
                <button type="button" onClick={() => navigate(`/audiences/${audience.id}`)} className="rounded-lg p-2 text-gray-400 hover:bg-indigo-50 hover:text-indigo-600" title="Open full page"><ExternalLink size={14} /></button>
                <button type="button" onClick={() => setEditing(audience)} className="rounded-lg p-2 text-gray-400 hover:bg-indigo-50 hover:text-indigo-600" title="Quick edit in side sheet"><Pencil size={14} /></button>
                <button type="button" onClick={() => remove(audience)} className="rounded-lg p-2 text-gray-400 hover:bg-red-50 hover:text-red-500" title="Delete audience"><Trash2 size={14} /></button>
              </div>
            </article>
          ))}
        </div>
      )}

      <AudienceManager
        isOpen={editing !== undefined}
        audience={editing || null}
        onClose={() => setEditing(undefined)}
        onSaved={load}
      />
    </div>
  );
}
