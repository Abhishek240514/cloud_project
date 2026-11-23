// Snapshots are chunked below API Gateway's 32 KB frame limit, and may interleave.
export function snapshotAssembler() {
  const partial = new Map();
  return (message) => {
    if (message.type !== "snapshot") return null;
    const { snapshotId, index, count, data } = message;
    if (
      !Number.isInteger(count) ||
      count < 1 ||
      count > 100 ||
      !Number.isInteger(index) ||
      index < 0 ||
      index >= count ||
      typeof data !== "string"
    )
      return null;
    const now = Date.now();
    for (const [id, entry] of partial)
      if (now - entry.at > 30000) partial.delete(id);
    if (!partial.has(snapshotId)) {
      if (partial.size >= 30) partial.delete(partial.keys().next().value);
      partial.set(snapshotId, { parts: [], count, at: now });
    }
    const entry = partial.get(snapshotId);
    if (entry.count !== count) return null;
    entry.parts[index] = data;
    if (entry.parts.filter((x) => x !== undefined).length !== count)
      return null;
    partial.delete(snapshotId);
    try {
      return JSON.parse(entry.parts.join(""));
    } catch {
      return null;
    }
  };
}
