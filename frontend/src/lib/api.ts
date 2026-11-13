export const API_URL = ((import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:8000').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Llama a la API de FastAPI enviando el token de Supabase. */
export async function apiFetch<T>(path: string, token: string | null, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const response = await fetch(`${API_URL}${path}`, { ...init, headers });
  if (!response.ok) {
    let detail = response.statusText;
    try {
      const body = await response.json();
      detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail);
    } catch {
      /* respuesta sin JSON */
    }
    throw new ApiError(response.status, detail);
  }
  return (response.status === 204 ? undefined : await response.json()) as T;
}
