import { useCallback, useEffect, useState } from "react";
import {
  FLEET_INSPECTIONS_ENDPOINT,
  fleetInspectionDetailUrl,
  fleetInspectionPdfUrl,
} from "./config";
import { capitalize, formatVehiclePart, severityBadgeClass } from "./inspectionUtils";

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

export default function InspectionHistory({ initialVehicleId = "" }) {
  const [vehicleSearch, setVehicleSearch] = useState(initialVehicleId);
  const [query, setQuery] = useState(initialVehicleId);
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const loadHistory = useCallback(async (vehicleId = "") => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: "50", offset: "0" });
      if (vehicleId.trim()) params.set("vehicle_id", vehicleId.trim());

      const res = await fetch(`${FLEET_INSPECTIONS_ENDPOINT}?${params}`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || "Failed to load inspection history.");
      }
      setItems(data.items || []);
      setTotal(data.total ?? 0);
    } catch (err) {
      setError(err.message || "Failed to load inspection history.");
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setVehicleSearch(initialVehicleId);
    setQuery(initialVehicleId);
  }, [initialVehicleId]);

  useEffect(() => {
    loadHistory(query);
  }, [loadHistory, query]);

  const handleSearch = (event) => {
    event.preventDefault();
    setQuery(vehicleSearch);
    setSelected(null);
  };

  const handleSelect = async (inspectionId) => {
    setDetailLoading(true);
    setError(null);
    try {
      const res = await fetch(fleetInspectionDetailUrl(inspectionId));
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || "Failed to load inspection detail.");
      }
      setSelected(data);
    } catch (err) {
      setError(err.message || "Failed to load inspection detail.");
    } finally {
      setDetailLoading(false);
    }
  };

  return (
    <div className="space-y-8">
      <section className="saas-card-elevated p-6">
        <h2 className="text-xl font-semibold text-slate-900">Inspection History</h2>
        <p className="mt-1 text-sm text-slate-500">
          Search and review all saved fleet inspections. Export any report as PDF.
        </p>

        <form onSubmit={handleSearch} className="mt-5 flex flex-col gap-3 sm:flex-row">
          <input
            type="text"
            value={vehicleSearch}
            onChange={(e) => setVehicleSearch(e.target.value)}
            placeholder="Search by vehicle ID (e.g. FLEET-1042)"
            className="flex-1 rounded-xl border border-slate-300 px-4 py-2.5 text-sm text-slate-800 shadow-sm focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/20"
          />
          <button type="submit" className="btn-primary">
            Search
          </button>
          <button
            type="button"
            onClick={() => {
              setVehicleSearch("");
              setQuery("");
              setSelected(null);
            }}
            className="btn-secondary"
          >
            Clear
          </button>
        </form>

        {error && (
          <div
            role="alert"
            className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            {error}
          </div>
        )}

        <p className="mt-4 text-sm text-slate-500">
          {total} inspection{total !== 1 ? "s" : ""} found
          {query ? ` for "${query}"` : ""}
        </p>

        {loading ? (
          <div className="flex justify-center py-12">
            <span className="h-8 w-8 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" />
          </div>
        ) : items.length === 0 ? (
          <div className="mt-4 rounded-xl border border-dashed border-slate-200 bg-slate-50 py-12 text-center">
            <p className="text-sm text-slate-600">No inspections match your search.</p>
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-3">Time</th>
                  <th className="px-3 py-3">Vehicle ID</th>
                  <th className="px-3 py-3">Severity</th>
                  <th className="px-3 py-3">Damages</th>
                  <th className="px-3 py-3">Views</th>
                  <th className="px-3 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => (
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
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => handleSelect(row.inspection_id)}
                          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        >
                          Details
                        </button>
                        <a
                          href={fleetInspectionPdfUrl(row.inspection_id)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="rounded-lg border border-brand-200 bg-brand-50 px-3 py-1.5 text-xs font-medium text-brand-700 hover:bg-brand-100"
                        >
                          PDF
                        </a>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {(selected || detailLoading) && (
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="text-lg font-semibold text-slate-800">Inspection Detail</h3>
          {detailLoading ? (
            <div className="flex justify-center py-8">
              <span className="h-6 w-6 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" />
            </div>
          ) : selected ? (
            <div className="mt-4 space-y-4">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-xl bg-slate-50 p-4">
                  <p className="text-xs font-semibold uppercase text-slate-500">Vehicle ID</p>
                  <p className="mt-1 font-semibold text-slate-900">{selected.vehicle_id}</p>
                </div>
                <div className="rounded-xl bg-slate-50 p-4">
                  <p className="text-xs font-semibold uppercase text-slate-500">Severity</p>
                  <p className="mt-1">
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${severityBadgeClass(
                        selected.severity,
                      )}`}
                    >
                      {selected.severity}
                    </span>
                  </p>
                </div>
                <div className="rounded-xl bg-slate-50 p-4">
                  <p className="text-xs font-semibold uppercase text-slate-500">Timestamp</p>
                  <p className="mt-1 text-sm text-slate-800">
                    {formatTimestamp(selected.timestamp)}
                  </p>
                </div>
                <div className="rounded-xl bg-slate-50 p-4">
                  <p className="text-xs font-semibold uppercase text-slate-500">Views</p>
                  <p className="mt-1 text-sm text-slate-800">
                    {viewList(selected.views_inspected)}
                  </p>
                </div>
              </div>

              <div className="flex gap-3">
                <a
                  href={fleetInspectionPdfUrl(selected.inspection_id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
                >
                  Download PDF Report
                </a>
              </div>

              {(selected.damages?.length ?? 0) > 0 && (
                <div className="space-y-3">
                  <h4 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                    Damages ({selected.damages.length})
                  </h4>
                  {selected.damages.map((item, index) => (
                    <article
                      key={`${item.damage_type}-${index}`}
                      className="rounded-xl border border-slate-200 bg-slate-50 p-4"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-semibold text-slate-900">
                          {capitalize(item.damage_type)}
                        </p>
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${severityBadgeClass(
                            item.severity,
                          )}`}
                        >
                          {item.severity}
                        </span>
                      </div>
                      <p className="mt-2 text-sm text-slate-600">
                        View: {viewList([item.view])}
                        {item.vehicle_part &&
                          ` · Part: ${formatVehiclePart(item.vehicle_part)}`}
                        {item.confidence != null &&
                          ` · Confidence: ${(item.confidence * 100).toFixed(1)}%`}
                        {item.part_confidence != null &&
                          ` · Part confidence: ${(item.part_confidence * 100).toFixed(1)}%`}
                      </p>
                    </article>
                  ))}
                </div>
              )}
            </div>
          ) : null}
        </section>
      )}
    </div>
  );
}
