import { request } from "node:https";
import { request as httpRequest } from "node:http";
import { resolve4 } from "node:dns/promises";
import { isIP } from "node:net";
import { isPublicIPv4 } from "./live-discovery";

export class GatewayError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function validateGatewayUrl(value: string) {
  let u: URL;
  try { u = new URL(value); } catch { throw new GatewayError(400,"Enter a valid HTTPS base URL."); }
  if (u.protocol !== "https:" || (u.port && u.port !== "443") || u.username || u.password || u.search || u.hash ||
    /[%\\\s]/.test(value) || value.length > 500 || u.hostname.endsWith(".") || u.hostname === "localhost" ||
    (isIP(u.hostname) !== 0 && !isPublicIPv4(u.hostname))) {
    throw new GatewayError(400,"Use a public HTTPS URL on port 443, without credentials, query parameters, fragments or encoded paths.");
  }
  return u.toString().replace(/\/$/, "");
}
async function publicAddress(host: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const addresses = isIP(host) === 4 ? [host] : await Promise.race([
      resolve4(host),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new GatewayError(502,"DNS lookup timed out.")), 5000); }),
    ]);
    if (!addresses.length || addresses.some(ip => !isPublicIPv4(ip))) throw new GatewayError(400,"Endpoint must resolve exclusively to public IPv4 addresses. Private/internal endpoints are blocked.");
    return addresses[0];
  } finally { if(timer) clearTimeout(timer); }
}
export async function gatewayJson(url: string, init: { method?: string; headers?: Record<string,string>; body?: unknown; trustedManaged?: boolean; maxBytes?: number } = {}): Promise<any> {
  const u = new URL(url);
  // Query strings below are constructed only by fixed adapters. Validate the origin/path independently.
  if (!init.trustedManaged) validateGatewayUrl(`${u.origin}${u.pathname}`);
  else if (!["http:", "https:"].includes(u.protocol) || u.username || u.password) throw new GatewayError(500,"Invalid managed integration configuration.");
  const address = init.trustedManaged ? undefined : await publicAddress(u.hostname);
  const maxBytes = init.maxBytes ?? 1_000_000;
  const body = init.body === undefined ? undefined : JSON.stringify(init.body);
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (err?: Error, result?: unknown) => { if (done) return; done = true; clearTimeout(deadline); err ? reject(err) : resolve(result); };
    const deadline = setTimeout(() => { req.destroy(); finish(new GatewayError(504,"Provider request timed out.")); }, 60_000);
    const req = (u.protocol === "http:" ? httpRequest : request)(u, {
      method: init.method ?? (body ? "POST" : "GET"),
      headers: { Accept:"application/json", "User-Agent":"SPECTRE-API-Gateway/1.0", ...(body ? {"Content-Type":"application/json","Content-Length":String(Buffer.byteLength(body))} : {}), ...init.headers },
      // Pin DNS resolution to the checked public address to prevent DNS rebinding. TLS still verifies hostname.
      ...(address ? { lookup: ((_host: string, _opts: unknown, cb: (err: Error|null, ip: string, family: number) => void) => cb(null,address,4)) as any, family:4 } : {}),
    }, res => {
      if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        finish(new GatewayError(502,`Provider returned HTTP ${res.statusCode ?? "unknown"}. Redirects are not followed. Check credentials, endpoint, model and account quota.`));
        return;
      }
      let bytes = 0;
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if(bytes > maxBytes) { req.destroy(); finish(new GatewayError(502,"Provider response exceeded the gateway size limit.")); }
        else chunks.push(chunk);
      });
      res.on("end", () => {
        try { finish(undefined,JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
        catch { finish(new GatewayError(502,"Provider did not return valid JSON. Check the API endpoint.")); }
      });
      res.on("error", () => finish(new GatewayError(502,"Provider response was interrupted.")));
    });
    req.on("error", () => finish(new GatewayError(502,"Could not reach the provider securely. Check its public DNS, certificate and endpoint.")));
    if(body) req.write(body);
    req.end();
  });
}
