export interface IVectorStore {
  init(): Promise<void>;
  addDocuments(docs: { text: string; metadata: any }[]): Promise<void>;
  getAllDocuments(): Promise<{ text: string; metadata: any; embedding: number[] }[]>;
  similaritySearch?(query: string, k?: number): Promise<
    { text: string; metadata: any; embedding: number[]; score?: number }[]
  >;
}
