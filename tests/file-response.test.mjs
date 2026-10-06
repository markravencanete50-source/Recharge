import assert from "node:assert/strict";
import test from "node:test";
import { privateFileHeaders } from "../lib/file-response.ts";

test("client HTML cannot execute scripts or use the application origin", () => {
  const headers = new Headers(privateFileHeaders("Text/HTML; charset=utf-8", "estimate.html"));
  assert.match(headers.get("content-disposition"), /^inline;/);
  assert.match(headers.get("content-security-policy"), /(?:^|;)\s*sandbox\s*;/);
  assert.doesNotMatch(headers.get("content-security-policy"), /allow-scripts|allow-same-origin|allow-forms/);
  assert.equal(headers.get("x-content-type-options"), "nosniff");
  assert.equal(headers.get("cache-control"), "private, no-store");
});

test("active and unknown file formats download without MIME sniffing", () => {
  for (const mime of ["image/svg+xml", "application/xhtml+xml", "application/xml", "application/octet-stream", "image/custom"]) {
    const headers = new Headers(privateFileHeaders(mime, "evidence.svg"));
    assert.match(headers.get("content-disposition"), /^attachment;/);
    assert.equal(headers.get("x-content-type-options"), "nosniff");
  }
});

test("safe photos and videos still preview and forced downloads remain downloads", () => {
  for (const mime of ["image/jpeg", "image/png", "video/mp4"]) {
    assert.match(privateFileHeaders(mime, "evidence")["content-disposition"], /^inline;/);
    assert.match(privateFileHeaders(mime, "evidence", true)["content-disposition"], /^attachment;/);
  }
});

test("malformed MIME and filenames cannot inject response headers", () => {
  const headers = new Headers(privateFileHeaders("text/html\r\nX-Injected: yes", 'quote"\r\nX-Injected: yes\\£.html'));
  assert.equal(headers.get("content-type"), "application/octet-stream");
  assert.equal(headers.get("x-injected"), null);
  assert.doesNotMatch(headers.get("content-disposition"), /[\r\n]/);
  assert.match(headers.get("content-disposition"), /filename\*=UTF-8''/);
});
