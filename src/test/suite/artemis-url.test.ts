import * as assert from "assert";

import { resolveAllowedArtemisUrl } from "../../shared/artemis-url";

suite("resolveAllowedArtemisUrl", () => {
  const configured = "https://artemis.cit.tum.de";

  test("accepts a candidate with the same origin as the configured base URL", () => {
    assert.strictEqual(
      resolveAllowedArtemisUrl("https://artemis.cit.tum.de", configured),
      "https://artemis.cit.tum.de",
    );
    assert.strictEqual(
      resolveAllowedArtemisUrl("https://artemis.cit.tum.de/api", configured),
      "https://artemis.cit.tum.de/api",
    );
  });

  test("rejects a different host", () => {
    assert.strictEqual(resolveAllowedArtemisUrl("https://evil.example.com", configured), undefined);
  });

  test("rejects a scheme downgrade and a different port", () => {
    assert.strictEqual(resolveAllowedArtemisUrl("http://artemis.cit.tum.de", configured), undefined);
    assert.strictEqual(
      resolveAllowedArtemisUrl("https://artemis.cit.tum.de:8443", configured),
      undefined,
    );
  });

  test("rejects non-http(s) and malformed candidates", () => {
    assert.strictEqual(
      resolveAllowedArtemisUrl("javascript:alert(1)", configured),
      undefined,
    );
    assert.strictEqual(resolveAllowedArtemisUrl("not a url", configured), undefined);
    assert.strictEqual(resolveAllowedArtemisUrl("", configured), undefined);
    assert.strictEqual(resolveAllowedArtemisUrl(undefined, configured), undefined);
  });

  test("rejects any candidate when no configured origin is available", () => {
    assert.strictEqual(resolveAllowedArtemisUrl("https://artemis.cit.tum.de", undefined), undefined);
  });
});
