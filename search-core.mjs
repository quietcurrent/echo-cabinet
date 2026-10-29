// Echo Cabinet — MIT License. All search operations stay in the caller's process.

/** Split { id?, title?, text } documents without losing characters.
 * Offsets and maxChars use JavaScript string indices (UTF-16 code units).
 */
export function chunkDocuments(documents, { maxChars = 700, overlapChars = 120 } = {}) {
  if (!Array.isArray(documents)) throw new TypeError('documents must be an array');
  if (!Number.isInteger(maxChars) || maxChars < 1) {
    throw new RangeError('maxChars must be a positive integer');
  }
  if (!Number.isInteger(overlapChars) || overlapChars < 0 || overlapChars >= maxChars) {
    throw new RangeError('overlapChars must be an integer from 0 to maxChars - 1');
  }

  const chunks = [];
  const ids = new Set();
  documents.forEach((document, index) => {
    if (!document || typeof document !== 'object' || typeof document.text !== 'string') {
      throw new TypeError(`document ${index + 1} must have a text string`);
    }
    const documentId = document.id ?? `document-${index + 1}`;
    if (typeof documentId !== 'string' || !documentId.trim()) {
      throw new TypeError(`document ${index + 1} id must be a nonempty string`);
    }
    if (ids.has(documentId)) throw new RangeError(`duplicate document id: ${documentId}`);
    ids.add(documentId);
    if (document.title !== undefined && typeof document.title !== 'string') {
      throw new TypeError(`document ${index + 1} title must be a string`);
    }
    const title = document.title?.trim() || documentId;
    if (!document.text.trim()) return;

    for (let offset = 0; offset < document.text.length; offset += maxChars - overlapChars) {
      const text = document.text.slice(offset, offset + maxChars);
      chunks.push({ id: `${documentId}:${offset}`, documentId, title, text, offset });
      if (offset + maxChars >= document.text.length) break;
    }
  });
  return chunks;
}

function validateVector(vector, label) {
  if (!Array.isArray(vector) && !(ArrayBuffer.isView(vector) && !(vector instanceof DataView))) {
    throw new TypeError(`${label} must be an array or typed array`);
  }
  if (vector.length === 0) throw new RangeError(`${label} must not be empty`);
  let scale = 0;
  for (const value of vector) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new TypeError(`${label} must contain only finite numbers`);
    }
    scale = Math.max(scale, Math.abs(value));
  }
  return scale;
}

/** Cosine similarity in [-1, 1], not a confidence or probability.
 * A zero vector has similarity 0. Scaling avoids overflow for large values.
 */
export function cosineSimilarity(a, b) {
  const scaleA = validateVector(a, 'first vector');
  const scaleB = validateVector(b, 'second vector');
  if (a.length !== b.length) throw new RangeError('embedding dimensions must match');
  if (scaleA === 0 || scaleB === 0) return 0;
  let dot = 0;
  let squareA = 0;
  let squareB = 0;
  for (let index = 0; index < a.length; index += 1) {
    const x = a[index] / scaleA;
    const y = b[index] / scaleB;
    dot += x * y;
    squareA += x * x;
    squareB += y * y;
  }
  return Math.max(-1, Math.min(1, dot / (Math.sqrt(squareA) * Math.sqrt(squareB))));
}

/** Rank aligned passage/embedding arrays. Equal scores preserve input order. */
export function rankPassages(queryEmbedding, passages, embeddings, { limit = 3, minScore = -1 } = {}) {
  validateVector(queryEmbedding, 'query embedding');
  if (!Array.isArray(passages) || !Array.isArray(embeddings)) {
    throw new TypeError('passages and embeddings must be arrays');
  }
  if (passages.length !== embeddings.length) {
    throw new RangeError('each passage must have exactly one embedding');
  }
  if (!Number.isInteger(limit) || limit < 0) throw new RangeError('limit must be a nonnegative integer');
  if (typeof minScore !== 'number' || !Number.isFinite(minScore) || minScore < -1 || minScore > 1) {
    throw new RangeError('minScore must be a finite number from -1 to 1');
  }

  return passages
    .map((passage, index) => ({ passage, score: cosineSimilarity(queryEmbedding, embeddings[index]), index }))
    .filter(({ score }) => score >= minScore)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map(({ passage, score }) => ({ passage, score }));
}
