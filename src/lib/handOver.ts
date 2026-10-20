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
