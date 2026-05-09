export type ToastVariant = 'info' | 'success' | 'error';

export interface ToastItem {
  id: string;
  variant: ToastVariant;
  message: string;
  /** Auto-dismiss delay in ms; 0 to disable. Default 4000. */
  durationMs: number;
}

type Listener = (items: ToastItem[]) => void;

let items: ToastItem[] = [];
const listeners = new Set<Listener>();

function emit(): void {
  for (const l of listeners) l(items);
}

export function subscribeToasts(listener: Listener): () => void {
  listeners.add(listener);
  listener(items);
  return () => {
    listeners.delete(listener);
  };
}

function pushToast(variant: ToastVariant, message: string, durationMs = 4000): string {
  const id =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : String(Math.random()).slice(2);
  const next: ToastItem = { id, variant, message, durationMs };
  items = [...items, next];
  emit();
  if (durationMs > 0) {
    setTimeout(() => dismissToast(id), durationMs);
  }
  return id;
}

export function dismissToast(id: string): void {
  const before = items.length;
  items = items.filter((t) => t.id !== id);
  if (items.length !== before) emit();
}

export const toast = {
  info: (message: string, durationMs?: number) => pushToast('info', message, durationMs),
  success: (message: string, durationMs?: number) => pushToast('success', message, durationMs),
  error: (message: string, durationMs?: number) => pushToast('error', message, durationMs),
};
