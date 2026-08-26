import { useFsBulkOpStore } from "./fsBulkOp";
import { useTransferStore } from "./transfer";
import { useUploadQueueStore } from "./uploadQueue";
import type { Task } from "./tasks";

export type TaskCommand = "cancel" | "retry";

export interface TaskCapabilities {
  canCancel: boolean;
  canRetry: boolean;
  canPause: false;
  canResume: false;
}

/** Derive controls from the live owning store, not the facade status alone. */
export function taskCapabilities(task: Task): TaskCapabilities {
  const none: TaskCapabilities = {
    canCancel: false,
    canRetry: false,
    canPause: false,
    canResume: false,
  };
  const control = task.control;
  if (!control) return none;

  if (control.owner === "transfer") {
    const phase = useTransferStore.getState().phasesByHost[control.host];
    return { ...none, canCancel: phase?.kind === "running" || phase?.kind === "starting" };
  }
  if (control.owner === "fs-bulk") {
    const op = useFsBulkOpStore.getState().byHost[control.host];
    return { ...none, canCancel: op?.op != null && !op.cancelRequested };
  }

  const item = useUploadQueueStore.getState().items.find(
    (candidate) => candidate.id === control.itemId,
  );
  if (!item) return none;
  return {
    ...none,
    canCancel: item.status === "running" || item.status === "pending",
    canRetry: item.status === "failed",
  };
}

/** Execute a command against the feature that owns the work. Task status is
 * intentionally not touched here; taskWiring observes the owner's resulting
 * state and updates the facade after the command takes effect. */
export async function commandTask(task: Task, command: TaskCommand): Promise<boolean> {
  const control = task.control;
  if (!control) return false;

  if (command === "cancel") {
    if (control.owner === "transfer") {
      useTransferStore.getState().cancel(control.host);
      return true;
    }
    if (control.owner === "fs-bulk") {
      useFsBulkOpStore.getState().requestCancel(control.host);
      return true;
    }
    useUploadQueueStore.getState().cancelItem(control.itemId);
    return true;
  }

  if (control.owner !== "upload-queue") return false;
  const retried = useUploadQueueStore.getState().retryItem(control.itemId);
  if (retried) await useUploadQueueStore.getState().startHost(control.host);
  return retried;
}
