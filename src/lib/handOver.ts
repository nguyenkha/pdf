/**
 * Passes files to another tool's page through the service worker's memory
 * (as the share target does) and opens it. Nothing is written to storage.
 * Returns false when no service worker controls the page.
 */
// Read before the application removes hand-over parameters from its URL.
const incomingToken = new URLSearchParams(location.hash.slice(1)).get("transfer");

export async function handOver(files: File[], path: string): Promise<boolean> {
  const worker = navigator.serviceWorker?.controller;
  if (!worker) return false;
  const channel = new MessageChannel();
  const received = new Promise<string | false>((resolve) => {
    const timer = setTimeout(() => { channel.port1.close(); resolve(false); }, 3000);
    channel.port1.onmessage = ({ data }) => {
      clearTimeout(timer);
      channel.port1.close();
      resolve(typeof data === "string" ? data : false);
    };
  });
  worker.postMessage({ type: "hand-over", files, path }, [channel.port2]);
  const token = await received;
  if (!token) return false;
  location.href = `${path}?shared=1#transfer=${encodeURIComponent(token)}`;
  return true;
}
export const canHandOver = () => Boolean(navigator.serviceWorker?.controller);

// Asks the service worker for files handed over by the share target; it
// holds them in memory and forgets them once given.
export async function takeSharedFiles(): Promise<File[]> {
  if (!incomingToken) return [];
  try {
    const registration = await navigator.serviceWorker.ready;
    const worker = navigator.serviceWorker.controller ?? registration.active;
    if (!worker) return [];
    const channel = new MessageChannel();
    const reply = new Promise<File[]>((resolve) => {
      const timer = setTimeout(() => { channel.port1.close(); resolve([]); }, 5000);
      channel.port1.onmessage = (event) => {
        clearTimeout(timer);
        channel.port1.close();
        resolve(event.data ?? []);
      };
    });
    worker.postMessage({ type: "take-shared", token: incomingToken }, [channel.port2]);
    return await reply;
  } catch {
    return [];
  }
}
