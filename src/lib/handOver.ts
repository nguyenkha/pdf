/**
 * Passes files to another tool's page through the service worker's memory
 * (as the share target does) and opens it. Nothing is written to storage.
 * Returns false when no service worker controls the page.
 */
export async function handOver(files: File[], path: string): Promise<boolean> {
  const worker = navigator.serviceWorker?.controller;
  if (!worker) return false;
  const channel = new MessageChannel();
  const received = new Promise<boolean>((resolve) => {
    channel.port1.onmessage = () => resolve(true);
    setTimeout(() => resolve(false), 3000);
  });
  worker.postMessage({ type: "hand-over", files }, [channel.port2]);
  if (!(await received)) return false;
  location.href = `${path}?shared=1`;
  return true;
}
export const canHandOver = () => Boolean(navigator.serviceWorker?.controller);

// Asks the service worker for files handed over by the share target; it
// holds them in memory and forgets them once given.
export async function takeSharedFiles(): Promise<File[]> {
  try {
    const registration = await navigator.serviceWorker.ready;
    const worker = navigator.serviceWorker.controller ?? registration.active;
    if (!worker) return [];
    const channel = new MessageChannel();
    const reply = new Promise<File[]>((resolve) => {
      channel.port1.onmessage = (event) => resolve(event.data ?? []);
      setTimeout(() => resolve([]), 5000);
    });
    worker.postMessage({ type: "take-shared" }, [channel.port2]);
    return await reply;
  } catch {
    return [];
  }
}
