export const ROWS = "rows";
export const GAPS = "gaps";
export const META = "meta";
export const TERMS = "terms";

export function awaitRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function readBytes(tx: IDBTransaction): Promise<number> {
  const current = await awaitRequest<{ value: number } | undefined>(
    tx.objectStore(META).get("bytes"),
  );
  return current?.value ?? 0;
}

export async function addBytes(
  tx: IDBTransaction,
  delta: number,
): Promise<void> {
  const value = (await readBytes(tx)) + delta;
  await awaitRequest(tx.objectStore(META).put({ name: "bytes", value }));
}
