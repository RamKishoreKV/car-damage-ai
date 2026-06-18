import { useEffect, useState } from "react";
import { FLEET_DASHBOARD_ENDPOINT } from "./config";
import { severityBadgeClass } from "./inspectionUtils";

function formatTimestamp(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function viewList(views) {
  if (!views?.length) return "—";
  return views.map((v) => v.replace(/_/g, " ")).join(", ");
}

export default function FleetDashboard({ onViewHistory }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(FLEET_DASHBOARD_ENDPOINT);
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.detail || "Failed to load dashboard.");
        }
        if (!cancelled) setStats(data);
      } catch (err) {
        if (!cancelled) setError(err.message || "Failed to load dashboard.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="mt-8 flex justify-center py-16">
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" />
      </div>
    );
  }

  if (error) {
    return (
      <div
        role="alert"
        className="mt-8 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
      >
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <section className="saas-card-elevated p-6">
        <h2 className="text-xl font-semibold text-slate-900">Fleet Dashboard</h2>
        <p className="mt-1 text-sm text-slate-500">
          Overview of all saved vehicle inspections across your fleet.
        </p>

        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="stat-card border-cyan-100 bg-gradient-to-br from-cyan-50/50 to-white">
            <p className="text-xs font-semibold uppercase tracking-wide text-cyan-700">
              Total Inspections
            </p>
            <p className="mt-2 text-4xl font-bold text-slate-900">
              {stats?.total_inspections ?? 0}
            </p>
          </div>
          <div className="stat-card border-red-100 bg-gradient-to-br from-red-50/50 to-white">
            <p className="text-xs font-semibold uppercase tracking-wide text-red-700">
              High Severity
            </p>
            <p className="mt-2 text-4xl font-bold text-slate-900">
              {stats?.high_severity_count ?? 0}
            </p>
          </div>
          <div className="stat-card sm:col-span-2 lg:col-span-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Fleet Health
            </p>
            <p className="mt-2 text-sm text-slate-700">
              {(stats?.high_severity_count ?? 0) > 0
                ? "Vehicles with high-severity findings require manual review."
                : "No high-severity inspections on record."}
            </p>
          </div>
        </div>
      </section>

      <section className="saas-card p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-slate-800">Recent Inspections</h3>
            <p className="mt-1 text-sm text-slate-500">
              Latest inspections saved to the fleet database.
            </p>
          </div>
          {onViewHistory && (
            <button
              type="button"
              onClick={onViewHistory}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            >
              View Full History
            </button>
          )}
        </div>

        {(stats?.recent_inspections?.length ?? 0) === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 py-12 text-center">
            <p className="text-sm text-slate-600">No inspections recorded yet.</p>
            <p className="mt-1 text-xs text-slate-400">
              Run a single or multi-view inspection to populate the fleet database.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-3">Time</th>
                  <th className="px-3 py-3">Vehicle ID</th>
                  <th className="px-3 py-3">Severity</th>
                  <th className="px-3 py-3">Damages</th>
                  <th className="px-3 py-3">Views</th>
                  <th className="px-3 py-3">Type</th>
                </tr>
              </thead>
              <tbody>
                {stats.recent_inspections.map((row) => (
                  <tr
                    key={row.inspection_id}
                    className="border-b border-slate-100 hover:bg-slate-50/80"
                  >
                    <td className="px-3 py-3 text-slate-600">
                      {formatTimestamp(row.timestamp)}
                    </td>
                    <td className="px-3 py-3 font-medium text-slate-900">
                      {row.vehicle_id}
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${severityBadgeClass(
                          row.severity,
                        )}`}
                      >
                        {row.severity}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-slate-700">{row.damage_count}</td>
                    <td className="px-3 py-3 text-slate-600">
                      {viewList(row.views_inspected)}
                    </td>
                    <td className="px-3 py-3 capitalize text-slate-600">
                      {row.inspection_type}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
