// moorchehClient.ts
import fetch from "node-fetch";

const MOORCHEH_BASE = "https://api.moorcheh.ai/v1";

type MoorchehDoc = {
  id: string | number;
  text: string;
  // any other metadata fields (flat)
  [k: string]: any;
};

export class MoorchehClient {
  apiKey: string;

  constructor(apiKey: string) {
    if (!apiKey) throw new Error("Moorcheh API key required");
    this.apiKey = apiKey;
  }

  private headers() {
    return {
      "Content-Type": "application/json",
      "x-api-key": this.apiKey,
    };
  }

  // Create namespace (text or vector)
  async createNamespace(namespaceName: string, type: "text" | "vector" = "text", vector_dimension?: number) {
    const body: any = { namespace_name: namespaceName, type };
    if (type === "vector") body.vector_dimension = vector_dimension || 1536;

    const res = await fetch(`${MOORCHEH_BASE}/namespaces`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });

    if (res.status === 201) {
      return { ok: true, status: 201, data: await res.json() };
    }

    // 409 conflict => namespace exists (treat as ok)
    if (res.status === 409) {
      return { ok: true, status: 409, message: "namespace exists" };
    }

    const txt = await res.text();
    throw new Error(`Create namespace failed: ${res.status} ${txt}`);
  }

  // Upload batch of text documents into namespace
  // documents: MoorchehDoc[]
  async uploadTextDocuments(namespaceName: string, documents: MoorchehDoc[]) {
    if (!Array.isArray(documents) || documents.length === 0) {
      throw new Error("documents must be non-empty array");
    }

    // API path: /v1/namespaces/{namespace}/documents
    const url = `${MOORCHEH_BASE}/namespaces/${encodeURIComponent(namespaceName)}/documents`;
    const res = await fetch(url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ documents }),
    });

    // 202 Accepted typical
    if (res.ok) {
      const json = await res.json();
      return { ok: true, data: json };
    }

    const text = await res.text();
    throw new Error(`Upload documents failed: ${res.status} ${text}`);
  }

  // Search by text OR vector. If queryVector provided (array), send it as vector; otherwise send text.
  // options: { top_k, kiosk_mode, threshold }
  async search(namespaceNames: string[], query: string | number[], options?: { top_k?: number; kiosk_mode?: boolean; threshold?: number; }) {
    if (!Array.isArray(namespaceNames) || namespaceNames.length === 0) {
      throw new Error("namespaces required");
    }

    const body: any = {
      namespaces: namespaceNames,
      top_k: options?.top_k ?? 10,
      kiosk_mode: options?.kiosk_mode ?? false,
    };

    if (typeof query === "string") {
      body.query = query;
      if (body.kiosk_mode && typeof options?.threshold === "number") body.threshold = options!.threshold;
    } else if (Array.isArray(query)) {
      body.query = query; // vector array
    } else {
      throw new Error("query must be string or number[]");
    }

    const res = await fetch(`${MOORCHEH_BASE}/search`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });

    if (res.ok) {
      const json = await res.json();
      return { ok: true, data: json };
    }

    const text = await res.text();
    throw new Error(`Moorcheh search failed: ${res.status} ${text}`);
  }
}