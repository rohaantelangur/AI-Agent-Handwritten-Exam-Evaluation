import { lookup } from "node:dns/promises";
import net from "node:net";

const blockedHosts = new Set([
  "localhost",
  "metadata.google.internal"
]);

const blockedExactIps = new Set([
  "0.0.0.0",
  "127.0.0.1",
  "169.254.169.254",
  "::1"
]);

export async function assertSafeInputUrl(rawUrl: string, allowHttp: boolean): Promise<void> {
  const url = new URL(rawUrl);
  if (url.username || url.password) {
    throw new Error("URL credentials are not allowed");
  }
  if (url.protocol !== "https:" && !(allowHttp && url.protocol === "http:")) {
    throw new Error("Only HTTPS input URLs are allowed");
  }

  const hostname = url.hostname.toLowerCase();
  if (blockedHosts.has(hostname) || hostname.endsWith(".localhost")) {
    throw new Error("Localhost URLs are not allowed");
  }

  const literalVersion = net.isIP(hostname);
  if (literalVersion !== 0) {
    assertPublicIp(hostname);
    return;
  }

  const results = await lookup(hostname, { all: true, verbatim: true });
  if (results.length === 0) {
    throw new Error("URL host does not resolve");
  }
  for (const result of results) {
    assertPublicIp(result.address);
  }
}

function assertPublicIp(address: string): void {
  if (blockedExactIps.has(address)) {
    throw new Error("Private or metadata IP URLs are not allowed");
  }
  const version = net.isIP(address);
  if (version === 4 && isPrivateIpv4(address)) {
    throw new Error("Private IPv4 URLs are not allowed");
  }
  if (version === 6 && isPrivateIpv6(address)) {
    throw new Error("Private IPv6 URLs are not allowed");
  }
}

function isPrivateIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  const [a, b] = parts;
  return (
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a === 127 ||
    (a === 169 && b === 254) ||
    a === 0
  );
}

function isPrivateIpv6(address: string): boolean {
  const normalized = address.toLowerCase();
  return (
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe80:") ||
    normalized.startsWith("::ffff:127.") ||
    normalized.startsWith("::ffff:10.") ||
    normalized.startsWith("::ffff:192.168.")
  );
}
