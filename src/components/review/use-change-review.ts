"use client";

import { useEffect, useState } from "react";
import type { BatchResult, Proposal } from "@/client/types";
import {
  applyProposal,
  loadProposal,
  lookupOperation,
} from "@/client/commands";
import { ApiError } from "@/client/api";
import {
  clearApplyAttempt,
  readApplyAttempt,
  saveApplyAttempt,
  type ApplyAttempt,
} from "./apply-recovery";

function selectionKey(workspaceId: string, changeSetId: string) {
  return `mosaic-review-selection:${workspaceId}:${changeSetId}`;
}

function readSelection(workspaceId: string, changeSetId: string) {
  if (typeof sessionStorage === "undefined") return [];
  try {
    const parsed = JSON.parse(
      sessionStorage.getItem(selectionKey(workspaceId, changeSetId)) ?? "[]",
    );
    return Array.isArray(parsed)
      ? parsed.filter((key): key is string => typeof key === "string")
      : [];
  } catch {
    return [];
  }
}

export function useChangeReview(
  workspaceId: string,
  changeSetId: string,
  onApplied: () => Promise<void>,
) {
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [draft, setDraft] = useState<Proposal | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<BatchResult | null>(null);
  const [attempt, setAttempt] = useState<ApplyAttempt | null>(null);
  const [rejected, setRejected] = useState(false);

  async function reload() {
    const loaded = await loadProposal(workspaceId, changeSetId);
    setDraft(loaded);
    if (loaded.state === "applied") {
      clearApplyAttempt(workspaceId, changeSetId);
      setAttempt(null);
    }
  }

  useEffect(() => {
    let active = true;
    loadProposal(workspaceId, changeSetId)
      .then((draft) => {
        if (!active) return;
        setDraft(draft);
        if (draft.state !== "draft") {
          try {
            sessionStorage.removeItem(selectionKey(workspaceId, changeSetId));
          } catch {
            // Optional selection persistence must not block a server-confirmed receipt.
          }
          clearApplyAttempt(workspaceId, changeSetId);
          setAttempt(null);
          return;
        }
        const original = readApplyAttempt(workspaceId, changeSetId);
        if (original) {
          setAttempt(original);
          setSelected(original.selectedKeys);
          return;
        }
        const keys = new Set(draft.items.map((item) => item.key));
        setSelected(
          readSelection(workspaceId, changeSetId).filter((key) =>
            keys.has(key),
          ),
        );
      })
      .catch((error) => {
        if (active) setError(error.message);
      });
    return () => {
      active = false;
    };
  }, [workspaceId, changeSetId, loadAttempt]);

  useEffect(() => {
    if (!draft || draft.state !== "draft") return;
    try {
      sessionStorage.setItem(
        selectionKey(workspaceId, changeSetId),
        JSON.stringify(selected),
      );
    } catch {
      // Selection is optional; saving the exact apply intent remains mandatory.
    }
  }, [draft, selected, workspaceId, changeSetId]);

  function confirmCommit(committed: BatchResult) {
    setResult(committed);
    setRejected(false);
    setDraft((current) =>
      current ? { ...current, state: "applied" } : current,
    );
    clearApplyAttempt(workspaceId, changeSetId);
    setAttempt(null);
  }

  async function refreshCommitted() {
    try {
      await reload();
      await onApplied();
      setError("");
    } catch {
      setError(
        "Changes committed. The latest view could not be loaded; refresh the saved result without applying again.",
      );
    }
  }

  async function retryRefresh() {
    setBusy(true);
    try {
      await refreshCommitted();
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (!draft || draft.state !== "draft" || result) return;
    setBusy(true);
    setError("");
    try {
      const original = attempt ?? {
        changeSetId,
        expectedRevision: draft.revision,
        selectedKeys: selected,
        operationKey: crypto.randomUUID(),
      };
      saveApplyAttempt(workspaceId, original);
      setAttempt(original);
      const { operationKey, ...body } = original;
      const result = await applyProposal(workspaceId, body, operationKey);
      confirmCommit(result);
      await refreshCommitted();
    } catch (error) {
      setRejected(
        error instanceof ApiError &&
          ["CONFLICT", "INVALID_INPUT"].includes(error.code),
      );
      setError(
        error instanceof Error
          ? error.message
          : "Apply could not be confirmed. Keep this operation key for recovery.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function recover() {
    if (!attempt) return;
    setBusy(true);
    setError("");
    try {
      const result = await lookupOperation(
        workspaceId,
        "apply",
        attempt.operationKey,
      );
      confirmCommit(result);
      await refreshCommitted();
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "No result found. Retry the same operation.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function retryLoad() {
    setError("");
    setLoadAttempt((attempt) => attempt + 1);
  }

  async function discardApplyAttemptAndReload() {
    setBusy(true);
    setError("");
    try {
      // A rejected request can be replaced only after its old intent is removed.
      if (!clearApplyAttempt(workspaceId, changeSetId))
        throw new Error(
          "Browser recovery storage could not be cleared. Keep the original operation for recovery.",
        );
      setAttempt(null);
      setRejected(false);
      setSelected([]);
      await reload();
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Could not reload the proposal.",
      );
    } finally {
      setBusy(false);
    }
  }

  return {
    draft,
    selected,
    setSelected,
    error,
    busy,
    result,
    attempt,
    rejected,
    attempted: attempt !== null,
    apply,
    recover,
    retryLoad,
    retryRefresh,
    discardApplyAttemptAndReload,
    reload,
  };
}
