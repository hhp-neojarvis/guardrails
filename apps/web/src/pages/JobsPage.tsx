import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router";
import { API_URL } from "../lib/api";
import type { GuardrailValidationResult } from "@guardrails/shared";

interface UploadJob {
  id: string;
  fileName: string;
  status: string;
  totalRows: number | null;
  errorMessage: string | null;
  guardrailResults: GuardrailValidationResult | null;
  createdAt: string;
}

function getStatusBadgeClass(status: string): string {
  switch (status) {
    case "processing":
      return "badge-info";
    case "awaiting_review":
      return "badge-warning";
    case "completed":
      return "badge-success";
    case "error":
      return "badge-error";
    default:
      return "";
  }
}

function getStatusLabel(status: string): string {
  switch (status) {
    case "awaiting_review":
      return "Awaiting Review";
    default:
      return status.charAt(0).toUpperCase() + status.slice(1);
  }
}

function getViolationCount(results: GuardrailValidationResult | null): number {
  if (!results) return 0;
  return results.results.reduce((sum, r) => sum + r.violations.length, 0);
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

export function JobsPage() {
  const navigate = useNavigate();
  const [jobs, setJobs] = useState<UploadJob[]>([]);
  const [loading, setLoading] = useState(true);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchJobs = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/uploads`, {
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        setJobs(data.uploads ?? []);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchJobs();

    // Poll every 10 seconds for status updates
    pollRef.current = setInterval(fetchJobs, 10000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchJobs]);

  // Stop polling when no processing jobs
  useEffect(() => {
    const hasProcessing = jobs.some((j) => j.status === "processing");
    if (!hasProcessing && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, [jobs]);

  if (loading) {
    return (
      <div>
        <div className="upload-header">
          <h1>Jobs</h1>
          <p className="upload-subtitle">Loading...</p>
        </div>
      </div>
    );
  }

  if (jobs.length === 0) {
    return (
      <div>
        <div className="upload-header">
          <h1>Jobs</h1>
          <p className="upload-subtitle">
            Upload media plans and track their processing status
          </p>
        </div>
        <div className="jobs-empty">
          <p>No uploads yet.</p>
          <button
            className="btn btn-primary"
            onClick={() => navigate("/upload")}
          >
            Upload Media Plan
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="upload-header">
        <h1>Jobs</h1>
        <p className="upload-subtitle">
          {jobs.length} upload{jobs.length !== 1 ? "s" : ""}
        </p>
      </div>

      <div className="jobs-list">
        <table className="jobs-table">
          <thead>
            <tr>
              <th>File</th>
              <th>Status</th>
              <th>Rows</th>
              <th>Violations</th>
              <th>Created</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {jobs.slice().reverse().map((job) => {
              const violations = getViolationCount(job.guardrailResults);
              return (
                <tr
                  key={job.id}
                  className="jobs-row"
                  onClick={() => navigate(`/jobs/${job.id}`)}
                >
                  <td className="jobs-filename">{job.fileName}</td>
                  <td>
                    <span className={`badge ${getStatusBadgeClass(job.status)}`}>
                      {getStatusLabel(job.status)}
                    </span>
                  </td>
                  <td>{job.totalRows ?? "—"}</td>
                  <td>
                    {violations > 0 ? (
                      <span className="jobs-violations">{violations}</span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="jobs-date">
                    {formatRelativeTime(job.createdAt)}
                  </td>
                  <td>
                    <button
                      className="btn btn-sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/jobs/${job.id}`);
                      }}
                    >
                      View
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
