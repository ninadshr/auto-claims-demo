import { NextResponse } from "next/server";
import { lookup } from "node:dns/promises";
import net from "node:net";
import { z } from "zod";
import { REGIONS } from "@/lib/rate-card";
import {
  PrimaryModelError,
  UpstreamError,
  assessImage,
} from "@/lib/analysis";

/**
 * POST /api/analyze — HTTP layer of the STP pipeline (plan §5): request
 * parsing (multipart upload or SSRF-guarded imageUrl JSON), image sniffing,
 * then delegation to `lib/analysis.ts`. The pipeline itself is shared with
 * POST /api/eval so live golden-set runs exercise identical code.
 */

// Node.js runtime (the default for route handlers) is required for the
// dns node import below; `cacheComponents` forbids an explicit
// `export const runtime`, so it is intentionally omitted.
export const maxDuration = 300;

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const URL_FETCH_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// Request validation
// ---------------------------------------------------------------------------

const AnalyzeOptionsSchema = z.object({
  modelTier: z.enum(["open-weight", "anthropic", "openai", "gemini"]).default("open-weight"),
  region: z.enum(REGIONS).default("US_NATIONAL"),
  acv: z.number().positive().optional(),
});

type AnalyzeOptions = z.infer<typeof AnalyzeOptionsSchema>;

// ---------------------------------------------------------------------------
// SSRF protection for imageUrl mode
// ---------------------------------------------------------------------------

/** True when the IP is globally routable (blocks loopback/private/link-local/etc.). */
function isPublicIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const octets = ip.split(".").map(Number);
    const [a, b] = octets;
    if (a === 0 || a === 10 || a === 127) return false;
    if (a === 169 && b === 254) return false; // link-local
    if (a === 172 && b >= 16 && b <= 31) return false; // private
    if (a === 192 && b === 168) return false; // private
    if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
    return true;
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower === "::" || lower === "::1") return false;
    if (lower.startsWith("fe8") || lower.startsWith("fe9") ||
        lower.startsWith("fea") || lower.startsWith("feb")) return false; // link-local
    if (lower.startsWith("fc") || lower.startsWith("fd")) return false; // ULA
    // IPv4-mapped addresses (::ffff:a.b.c.d) must be public as IPv4 too.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    if (mapped) return isPublicIp(mapped[1]);
    return true;
  }
  return false;
}

async function fetchImageUrl(
  rawUrl: string,
): Promise<{ bytes: Uint8Array; mediaType: string }> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new BadInputError("imageUrl is not a valid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new BadInputError("imageUrl must use http or https");
  }
  if (url.username || url.password) {
    throw new BadInputError("imageUrl must not contain credentials");
  }

  // Resolve DNS and require every address to be public BEFORE fetching.
  try {
    const addresses = await lookup(url.hostname, { all: true });
    if (addresses.length === 0) {
      throw new BadInputError("imageUrl hostname does not resolve");
    }
    for (const { address } of addresses) {
      if (!isPublicIp(address)) {
        throw new BadInputError(
          `imageUrl hostname resolves to a private address (${address}) — blocked`,
        );
      }
    }
  } catch (err) {
    if (err instanceof BadInputError) throw err;
    throw new BadInputError("imageUrl hostname does not resolve");
  }

  let response: Response;
  try {
    response = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(URL_FETCH_TIMEOUT_MS),
      headers: { "User-Agent": "auto-claims-demo/0.1" },
    });
  } catch {
    throw new BadInputError(`Failed to fetch imageUrl within ${URL_FETCH_TIMEOUT_MS / 1000}s`);
  }
  if (!response.ok) {
    throw new BadInputError(`imageUrl fetch returned HTTP ${response.status}`);
  }

  const mediaType = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!mediaType.startsWith("image/") || !ALLOWED_MIME.has(mediaType)) {
    throw new BadInputError(
      `imageUrl content-type '${mediaType}' is not an allowed image type (jpeg/png/webp)`,
    );
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  return { bytes, mediaType };
}

// ---------------------------------------------------------------------------
// Image ingest
// ---------------------------------------------------------------------------

class BadInputError extends Error {}

/** Sniff magic bytes so a renamed .txt payload cannot masquerade as an image. */
function sniffImageMime(bytes: Uint8Array): string | null {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  const ascii = String.fromCharCode(...bytes.slice(0, 12));
  if (ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WEBP") return "image/webp";
  return null;
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(request: Request): Promise<NextResponse> {
  const requestId = `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  try {
    // --- Parse request (multipart upload or JSON imageUrl mode) ------------
    const contentType = request.headers.get("content-type") ?? "";
    let bytes: Uint8Array;
    let mediaType: string;
    let options: AnalyzeOptions;

    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("image") ?? form.get("file");
      if (!(file instanceof File)) {
        throw new BadInputError("multipart request must include an 'image' file field");
      }
      if (file.size > MAX_IMAGE_BYTES) {
        throw new BadInputError(`Image exceeds the 10 MB limit (${(file.size / 1024 / 1024).toFixed(1)} MB)`);
      }
      bytes = new Uint8Array(await file.arrayBuffer());
      // Magic bytes are authoritative; a declared type that *contradicts* the
      // sniffed type is rejected, while a generic declaration (curl's default
      // application/octet-stream) is accepted when the bytes are a real image.
      const sniffed = sniffImageMime(bytes);
      if (!sniffed) {
        throw new BadInputError("Uploaded file is not a JPEG, PNG, or WebP image");
      }
      if (!ALLOWED_MIME.has(sniffed)) {
        throw new BadInputError(`Unsupported image type '${sniffed}'`);
      }
      const declared = file.type;
      if (ALLOWED_MIME.has(declared) && declared !== sniffed) {
        throw new BadInputError("Image content does not match its declared type");
      }
      mediaType = sniffed;
      options = parseOptions({
        modelTier: form.get("modelTier"),
        region: form.get("region"),
        acv: form.get("acv"),
      });
    } else if (contentType.includes("application/json")) {
      const body = (await request.json().catch(() => null)) as
        | { imageUrl?: unknown; modelTier?: unknown; region?: unknown; acv?: unknown }
        | null;
      if (!body || typeof body.imageUrl !== "string" || !body.imageUrl) {
        throw new BadInputError("JSON body must include an 'imageUrl' string");
      }
      const fetched = await fetchImageUrl(body.imageUrl);
      if (fetched.bytes.byteLength > MAX_IMAGE_BYTES) {
        throw new BadInputError("imageUrl image exceeds the 10 MB limit");
      }
      const sniffed = sniffImageMime(fetched.bytes);
      if (!sniffed || sniffed !== fetched.mediaType) {
        throw new BadInputError("imageUrl content does not match its content-type");
      }
      bytes = fetched.bytes;
      mediaType = fetched.mediaType;
      options = parseOptions({
        modelTier: body.modelTier,
        region: body.region,
        acv: body.acv,
      });
    } else {
      throw new BadInputError("Content-Type must be multipart/form-data or application/json");
    }

    // --- Full STP pipeline (shared with /api/eval) --------------------------
    const result = await assessImage({
      bytes,
      mediaType,
      modelTier: options.modelTier,
      region: options.region,
      acvUsd: options.acv,
      requestId,
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof BadInputError) {
      return NextResponse.json(
        { error: err.message, request_id: requestId },
        { status: 400 },
      );
    }
    if (err instanceof UpstreamError) {
      return NextResponse.json(
        { error: err.message, request_id: requestId },
        { status: 503 },
      );
    }
    if (err instanceof PrimaryModelError) {
      return NextResponse.json(
        {
          error: "Primary vision model call failed",
          detail: err.primaryError,
          verifier_error: err.verifierError,
          request_id: requestId,
        },
        { status: 502 },
      );
    }
    console.error("analyze route failure:", err);
    return NextResponse.json(
      {
        error: "Internal analysis failure",
        detail: err instanceof Error ? err.message : String(err),
        request_id: requestId,
      },
      { status: 500 },
    );
  }
}

/** Parse loose (string or native) option values from multipart or JSON. */
function parseOptions(raw: {
  modelTier: unknown;
  region: unknown;
  acv: unknown;
}): AnalyzeOptions {
  const coerced = {
    modelTier: typeof raw.modelTier === "string" ? raw.modelTier : raw.modelTier ?? undefined,
    region: typeof raw.region === "string" ? raw.region : raw.region ?? undefined,
    acv:
      typeof raw.acv === "string"
        ? Number(raw.acv)
        : raw.acv ?? undefined,
  };
  const parsed = AnalyzeOptionsSchema.safeParse(coerced);
  if (!parsed.success) {
    throw new BadInputError(`Invalid options: ${parsed.error.message}`);
  }
  return parsed.data;
}
