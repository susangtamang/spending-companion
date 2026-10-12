export class ApiError extends Error {
  constructor(readonly status: number, message: string) { super(message); this.name = "ApiError"; }
}
export interface TokenSource { getToken(): Promise<string | null> }
export class SpendingApi {
  constructor(private readonly baseUrl: string, private readonly tokens: TokenSource) {}
  get<T>(path: string): Promise<T> { return this.request(path); }
  async getText(path: string): Promise<string> { const response = await this.fetch(path); return response.text(); }
  post<T>(path: string, body?: unknown, idempotencyKey = mutationKey()): Promise<T> { return this.request(path, { method: "POST", headers: { "Idempotency-Key": idempotencyKey }, body: body === undefined ? undefined : JSON.stringify(body) }); }
  patch<T>(path: string, body: unknown, idempotencyKey = mutationKey()): Promise<T> { return this.request(path, { method: "PATCH", headers: { "Idempotency-Key": idempotencyKey }, body: JSON.stringify(body) }); }
  delete<T>(path: string, body?: unknown, idempotencyKey = mutationKey()): Promise<T> { return this.request(path, { method: "DELETE", headers: { "Idempotency-Key": idempotencyKey }, body: body === undefined ? undefined : JSON.stringify(body) }); }
  postForm<T>(path: string, body: FormData, idempotencyKey = mutationKey()): Promise<T> { return this.request(path, { method: "POST", headers: { "Idempotency-Key": idempotencyKey }, body }); }
  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await this.fetch(path, init);
    return response.status === 204 ? undefined as T : response.json() as Promise<T>;
  }
  private async fetch(path: string, init: RequestInit = {}): Promise<Response> {
    const token = await this.tokens.getToken();
    if (!token) throw new ApiError(401, "Sign in is required.");
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json");
    headers.set("Authorization", `Bearer ${token}`);
    if (!(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
    const response = await fetch(`${this.baseUrl}${path}`, { ...init, headers });
    if (!response.ok) { const error = await response.json().catch(() => ({})) as { message?: string }; throw new ApiError(response.status, error.message ?? "Request failed."); }
    return response;
  }
}

function mutationKey(): string { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`; }
