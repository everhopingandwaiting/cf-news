import { describe, it, expect, vi } from "vitest";
import { searchPixabay } from "../../services/pixabay";

describe("searchPixabay 中文 query", () => {
  it("中文标题用 zh 搜索且 URL 正确", async () => {
    let captured = "";
    vi.stubGlobal("fetch", async (input: any) => {
      captured = String(input);
      return new Response(JSON.stringify({ hits: [{ largeImageURL: "https://x/1.jpg", imageWidth: 1280, imageHeight: 720, tags: "腾势, 汽车, 车" }] }), { status: 200 });
    });
    const env: any = { PIXABAY_API_KEY: "k", KV: { get: async () => null, put: async () => {} } };
    const urls = await searchPixabay(env, "腾势Z9S正式开启预售", "illustration", "zh");
    expect(urls).toBeTruthy();
    expect(Array.isArray(urls)).toBe(true);
    expect((urls as string[])[0]).toBe("https://x/1.jpg");
    console.log("REQUEST_URL:", captured);
    expect(captured).toContain("lang=zh");
    expect(decodeURIComponent(captured)).toContain("腾势");
  });
});
