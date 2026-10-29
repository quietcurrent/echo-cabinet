import test from 'node:test';
import assert from 'node:assert/strict';
import { chunkDocuments, cosineSimilarity, rankPassages } from './search-core.mjs';

test('chunks cover the complete original with exact, deterministic overlapping offsets', () => {
  const text = 'The attic door creaked. A blue lamp lit the forgotten journal.\nNothing was missing.';
  const documents = [{ id: 'journal', title: 'Attic journal', text }];
  const chunks = chunkDocuments(documents, { maxChars: 25, overlapChars: 7 });
  assert.deepEqual(chunks, chunkDocuments(documents, { maxChars: 25, overlapChars: 7 }));
  assert.deepEqual(chunks.map(({ offset }) => offset), [0, 18, 36, 54, 72]);
  let reconstructed = chunks[0].text;
  chunks.forEach((chunk, index) => {
    assert.equal(chunk.id, `journal:${chunk.offset}`);
    assert.equal(chunk.documentId, 'journal');
    assert.equal(chunk.title, 'Attic journal');
    assert.equal(chunk.text, text.slice(chunk.offset, chunk.offset + 25));
    assert.ok(chunk.text.length <= 25);
    if (index > 0) {
      assert.equal(chunks[index - 1].text.slice(-7), chunk.text.slice(0, 7));
      reconstructed += chunk.text.slice(7);
    }
  });
  assert.equal(reconstructed, text);
});

test('empty documents are skipped; short documents and default identities are preserved', () => {
  assert.deepEqual(chunkDocuments([{ text: '  ' }, { text: 'Boo!' }]), [
    { id: 'document-2:0', documentId: 'document-2', title: 'document-2', text: 'Boo!', offset: 0 },
  ]);
  assert.deepEqual(chunkDocuments([]), []);
  assert.deepEqual(chunkDocuments([{ id: 'x', text: 'abcdef' }], { maxChars: 3, overlapChars: 0 })
    .map(({ text, offset }) => ({ text, offset })), [{ text: 'abc', offset: 0 }, { text: 'def', offset: 3 }]);
});

test('invalid chunk options and ambiguous document identities are rejected', () => {
  assert.throws(() => chunkDocuments('not documents'), TypeError);
  assert.throws(() => chunkDocuments([{ text: 42 }]), TypeError);
  assert.throws(() => chunkDocuments([{ id: '', text: 'x' }]), TypeError);
  assert.throws(() => chunkDocuments([{ id: 'same', text: 'x' }, { id: 'same', text: 'y' }]), RangeError);
  assert.throws(() => chunkDocuments([], { maxChars: 0 }), RangeError);
  assert.throws(() => chunkDocuments([], { maxChars: 10, overlapChars: 10 }), RangeError);
  assert.throws(() => chunkDocuments([], { maxChars: 10, overlapChars: -1 }), RangeError);
});

test('cosine supports typed arrays, zero vectors, opposite directions and extreme finite values', () => {
  assert.ok(Math.abs(cosineSimilarity(new Float32Array([1, 2, 3]), [2, 4, 6]) - 1) < 1e-12);
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
  assert.equal(cosineSimilarity([0, 0], [1, 2]), 0);
  assert.equal(cosineSimilarity([1, 0], [-1, 0]), -1);
  assert.ok(Math.abs(cosineSimilarity([1e308, 1e308], [1e308, 1e308]) - 1) < 1e-12);
  assert.ok(Math.abs(cosineSimilarity([1e-300, 1e-300], [1e-300, 1e-300]) - 1) < 1e-12);
});

test('invalid vectors cannot silently produce plausible search scores', () => {
  assert.throws(() => cosineSimilarity([1, 2], [1]), RangeError);
  assert.throws(() => cosineSimilarity([], []), RangeError);
  assert.throws(() => cosineSimilarity([NaN], [1]), TypeError);
  assert.throws(() => cosineSimilarity([Infinity], [1]), TypeError);
  assert.throws(() => cosineSimilarity(['1'], [1]), TypeError);
  assert.throws(() => cosineSimilarity(new DataView(new ArrayBuffer(4)), [1]), TypeError);
  assert.throws(() => cosineSimilarity([0, 0], [NaN, 1]), TypeError);
});

test('semantic coordinates rank the relevant passage, without sharing literal query words', () => {
  // Synthetic coordinates stand for three concepts: lost object, weather, and food.
  // This tests ranking mathematics, not a claim about the external model's accuracy.
  const passages = [
    { id: 'storm', text: 'Thunder rattled the roof.' },
    { id: 'key', text: 'Look beneath the loose floorboard.' },
    { id: 'dinner', text: 'The soup is simmering.' },
    { id: 'map', text: 'A pencilled clue points to the attic.' },
  ];
  const embeddings = [[0, 1, 0], [1, 0, 0], [0, 0, 1], [0.8, 0.2, 0]];
  const results = rankPassages(new Float32Array([1, 0, 0]), passages, embeddings);
  assert.deepEqual(results.map(({ passage }) => passage.id), ['key', 'map', 'storm']);
  assert.equal(results[0].passage, passages[1]);
  assert.equal(results[0].score, 1);
  assert.ok(results[1].score > 0.9 && results[1].score < 1);
  assert.deepEqual(rankPassages([1, 0, 0], passages, embeddings, { minScore: 0.95, limit: 1 })
    .map(({ passage }) => passage.id), ['key']);
});

test('rank limits, thresholds and ties behave predictably', () => {
  const passages = ['first', 'second', 'opposite'];
  const embeddings = [[1, 0], [2, 0], [-1, 0]];
  assert.deepEqual(rankPassages([1, 0], passages, embeddings).map(({ passage }) => passage), passages);
  assert.equal(rankPassages([1, 0], passages, embeddings)[2].score, -1);
  assert.deepEqual(rankPassages([1, 0], passages, embeddings, { minScore: 0 }).map(({ passage }) => passage), ['first', 'second']);
  assert.deepEqual(rankPassages([1, 0], passages, embeddings, { limit: 0 }), []);
  assert.deepEqual(rankPassages([1], [], []), []);
});

test('rank rejects misaligned vectors and invalid search controls', () => {
  assert.throws(() => rankPassages([1], ['a'], []), RangeError);
  assert.throws(() => rankPassages([1], ['a'], [[1, 2]]), RangeError);
  assert.throws(() => rankPassages([1], ['a'], [[NaN]]), TypeError);
  assert.throws(() => rankPassages([1], [], [], { limit: -1 }), RangeError);
  assert.throws(() => rankPassages([1], [], [], { limit: 1.5 }), RangeError);
  assert.throws(() => rankPassages([1], [], [], { minScore: Infinity }), RangeError);
  assert.throws(() => rankPassages([1], [], [], { minScore: 2 }), RangeError);
});
