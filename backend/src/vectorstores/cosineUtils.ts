// cosineUtils.ts

/**
 * Compute cosine similarity between two embeddings
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
    return 0; // Return 0 if either input is invalid
  }

  const dot = a.reduce((sum, val, i) => sum + val * b[i], 0);
  const normA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
  const normB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));

  if (normA === 0 || normB === 0) return 0; // Avoid division by zero

  return dot / (normA * normB);
}

/**
 * Local similarity search (without external vector store like Supabase)
 */
export function similaritySearchLocal(
  queryEmbedding: number[],
  docs: { text: string; metadata: any; embedding: any }[],
  k: number
) {
  const ranked = docs
    .map((d) => {
      let embedding: number[] = [];

      // Parse embedding if it comes as a stringified JSON
      if (typeof d.embedding === "string") {
        try {
          embedding = JSON.parse(d.embedding);
        } catch (err) {
          console.warn(
            "⚠️ Invalid embedding format for doc:",
            d.metadata?.title || d.text?.slice(0, 50)
          );
          embedding = [];
        }
      } else if (Array.isArray(d.embedding)) {
        embedding = d.embedding;
      } else {
        embedding = [];
      }

      // Assign zero score for empty embeddings
      const score = embedding.length ? cosineSimilarity(queryEmbedding, embedding) : 0;

      return { ...d, score };
    })
    // Sort by similarity descending
    .sort((a, b) => b.score - a.score)
    // Keep only top k results
    .slice(0, k);

  return ranked;
}