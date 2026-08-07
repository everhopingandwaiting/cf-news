import { describe, it, expect, vi } from "vitest";
import { extractKeywords, searchPixabay, illustrateFromStock, storeStockImageToR2 } from "../../services/pixabay";

describe("extractKeywords", () => {
  it("中文标题 → 中文关键词 + lang zh", () => {
    const r = extractKeywords("腾势Z9S正式开启预售 纯电续航可达1100km", "tech");
    expect(r.lang).toBe("zh");
    expect(r.query).toContain("腾势");
    console.log("ZH:", JSON.stringify(r));
  });
  it("带标签中文标题 → 去标签", () => {
    const r = extractKeywords("[分享创造] 没花一分钱API开发了金融指标平台", "finance");
    expect(r.lang).toBe("zh");
    expect(r.query).not.toContain("[");
    console.log("TAG:", JSON.stringify(r));
  });
  it("英文标题 → 英文关键词 + lang en", () => {
    const r = extractKeywords("Apple launches new AI chip", "tech");
    expect(r.lang).toBe("en");
    console.log("EN:", JSON.stringify(r));
  });
  it("纯符号标题 → 分类兜底", () => {
    const r = extractKeywords("!!!", "finance");
    expect(r.lang).toBe("en");
    expect(r.query).toContain("finance");
    console.log("FALLBACK:", JSON.stringify(r));
  });
  it("英文标题过滤功能词（said/stick）→ 保留实词", () => {
    const r = extractKeywords("Warsh Said to Stick With Fed Messaging", "finance");
    expect(r.lang).toBe("en");
    expect(r.query).not.toContain("said");
    expect(r.query).not.toContain("stick");
    expect(r.query).toContain("fed");
    expect(r.query).toContain("messaging");
    console.log("NOISE:", JSON.stringify(r));
  });
  it("中英混合标题（含中文）→ 走中文路径", () => {
    const r = extractKeywords("GPT 5.5 API 发布", "tech");
    expect(r.lang).toBe("zh");
    expect(r.query).toContain("发布");
    console.log("MIXED:", JSON.stringify(r));
  });
});

describe("searchPixabay 候选列表", () => {
  it("返回按 16:9 排序的候选数组并缓存 JSON", async () => {
    let captured = "";
    vi.stubGlobal("fetch", async (input: any) => {
      captured = String(input);
      return new Response(JSON.stringify({
        hits: [
          { largeImageURL: "https://x/wide.jpg", imageWidth: 1600, imageHeight: 900, tags: "apple, fruit" },
          { largeImageURL: "https://x/square.jpg", imageWidth: 800, imageHeight: 800, tags: "chip, circuit" },
          { largeImageURL: "https://x/tall.jpg", imageWidth: 600, imageHeight: 1200, tags: "apple, design" },
        ],
      }), { status: 200 });
    });
    const cache = new Map<string, string>();
    const env: any = { PIXABAY_API_KEY: "k", KV: { get: async (k: string) => cache.get(k) ?? null, put: async (k: string, v: string) => { cache.set(k, v); } } };
    const urls = await searchPixabay(env, "apple chip", "illustration", "en");
    expect(urls).toHaveLength(3);
    expect(urls?.[0]).toBe("https://x/wide.jpg");
    const stored = cache.values().next().value as string;
    expect(JSON.parse(stored)).toEqual(["https://x/wide.jpg", "https://x/square.jpg", "https://x/tall.jpg"]);
    expect(captured).toContain("per_page=6");
  });

  it("tags 相关性优先于 16:9 比例排序", async () => {
    vi.stubGlobal("fetch", async () => {
      return new Response(JSON.stringify({
        hits: [
          { largeImageURL: "https://x/finance-narrow.jpg", imageWidth: 1000, imageHeight: 900, tags: "money, finance, bank" },
          { largeImageURL: "https://x/finance-wide.jpg", imageWidth: 1600, imageHeight: 900, tags: "money, finance, economy" },
          { largeImageURL: "https://x/irrelevant.jpg", imageWidth: 1280, imageHeight: 720, tags: "dog, forest, nature" },
        ],
      }), { status: 200 });
    });
    const cache = new Map<string, string>();
    const env: any = { PIXABAY_API_KEY: "k", KV: { get: async (k: string) => cache.get(k) ?? null, put: async (k: string, v: string) => { cache.set(k, v); } } };
    // query "finance money" — 相关分：finance-narrow=2, finance-wide=2, irrelevant=0（被过滤）；
    // finance-narrow(2) 与 finance-wide(2) 同分 → 按 16:9 接近度，wide 更接近 → 应排最前
    const urls = await searchPixabay(env, "finance money", "illustration", "en");
    expect(urls).toHaveLength(2);
    expect(urls?.[0]).toBe("https://x/finance-wide.jpg");
    expect(urls?.[1]).toBe("https://x/finance-narrow.jpg");
  });

  it("无 tags 的 hit 不干扰排序（score=0 被过滤）", async () => {
    vi.stubGlobal("fetch", async () => {
      return new Response(JSON.stringify({
        hits: [
          { largeImageURL: "https://x/tagged.jpg", imageWidth: 1280, imageHeight: 720, tags: "stock, market" },
          { largeImageURL: "https://x/untagged.jpg", imageWidth: 1600, imageHeight: 900 },
        ],
      }), { status: 200 });
    });
    const cache = new Map<string, string>();
    const env: any = { PIXABAY_API_KEY: "k", KV: { get: async (k: string) => cache.get(k) ?? null, put: async (k: string, v: string) => { cache.set(k, v); } } };
    const urls = await searchPixabay(env, "stock market", "illustration", "en");
    expect(urls).toEqual(["https://x/tagged.jpg"]);
  });

  it("query 与所有候选 tags 零相关时返回 null（降级策略）", async () => {
    vi.stubGlobal("fetch", async () => {
      return new Response(JSON.stringify({
        hits: [
          { largeImageURL: "https://x/dog.jpg", imageWidth: 1280, imageHeight: 720, tags: "dog, nature" },
          { largeImageURL: "https://x/unicorn.jpg", imageWidth: 1600, imageHeight: 900, tags: "bunny, cartoon" },
        ],
      }), { status: 200 });
    });
    const cache = new Map<string, string>();
    const env: any = { PIXABAY_API_KEY: "k", KV: { get: async (k: string) => cache.get(k) ?? null, put: async (k: string, v: string) => { cache.set(k, v); } } };
    const urls = await searchPixabay(env, "aristotle philosophy virtue", "illustration", "en");
    expect(urls).toBeNull();
  });

  it("兼容旧缓存格式（单 URL 字符串）", async () => {
    const cache = new Map<string, string>([["pixabay:v2:illustration:en:old%20query", "https://legacy/old.jpg"]]);
    const env: any = { PIXABAY_API_KEY: "k", KV: { get: async (k: string) => cache.get(k) ?? null, put: async () => {} } };
    const urls = await searchPixabay(env, "old query", "illustration", "en");
    expect(urls).toEqual(["https://legacy/old.jpg"]);
  });

  it("无 API key 返回 null", async () => {
    const env: any = { KV: { get: async () => null, put: async () => {} } };
    expect(await searchPixabay(env, "query", "illustration", "en")).toBeNull();
  });
});

describe("illustrateFromStock 中文兜底", () => {
  it("中文标题 zh 搜索失败时用中文兜底词重试（lang=zh）", async () => {
    const requests: string[] = [];
    vi.stubGlobal("fetch", async (input: any) => {
      const url = String(input);
      requests.push(url);
      if (url.includes("pixabay.com/api")) {
        if (url.includes("q=%E7%BD%91%E7%BB%9C%E5%AE%89%E5%85%A8")) return new Response(JSON.stringify({ hits: [] }), { status: 200 });
        return new Response(JSON.stringify({ hits: [{ largeImageURL: "https://cdn.pixabay.com/zh.jpg", imageWidth: 1280, imageHeight: 720, tags: "科技, 电脑" }] }), { status: 200 });
      }
      return new Response(new Uint8Array(10 * 1024), { status: 200, headers: { "Content-Type": "image/jpeg" } });
    });
    const env: any = { PIXABAY_API_KEY: "k", KV: { get: async () => null, put: async () => {} }, R2_IMAGES: { put: async () => {} } };
    const proxy = await illustrateFromStock(env, 77, "网络安全新规发布", "tech");
    expect(proxy).toContain("r2%3A%2F%2Fstock%2F77.");
    const zhCalls = requests.filter((u) => u.includes("lang=zh"));
    expect(zhCalls.length).toBeGreaterThan(0);
    const fallbackCall = zhCalls.find((u) => decodeURIComponent(u).includes("科技"));
    expect(fallbackCall).toBeTruthy();
  });

  it("英文标题不触发中文兜底", async () => {
    const requests: string[] = [];
    vi.stubGlobal("fetch", async (input: any) => {
      const url = String(input);
      requests.push(url);
      if (url.includes("pixabay.com/api")) return new Response(JSON.stringify({ hits: [{ largeImageURL: "https://cdn.pixabay.com/en.jpg", imageWidth: 1280, imageHeight: 720 }] }), { status: 200 });
      return new Response(new Uint8Array(10 * 1024), { status: 200, headers: { "Content-Type": "image/jpeg" } });
    });
    const env: any = { PIXABAY_API_KEY: "k", KV: { get: async () => null, put: async () => {} }, R2_IMAGES: { put: async () => {} } };
    await illustrateFromStock(env, 78, "Fed raises rates", "finance");
    expect(requests.every((u) => !u.includes("lang=zh"))).toBe(true);
  });
});

describe("storeStockImageToR2 黑图防护", () => {
  it("字节数小于 8KB 的图片被拒绝（返回 null）", async () => {
    vi.stubGlobal("fetch", async () => new Response(new Uint8Array(100), { status: 200, headers: { "Content-Type": "image/png" } }));
    const env: any = { R2_IMAGES: { put: async () => {} } };
    expect(await storeStockImageToR2(env, 1, "https://x/tiny.png")).toBeNull();
  });

  it("正常图片成功存储到 R2", async () => {
    vi.stubGlobal("fetch", async () => new Response(new Uint8Array(20 * 1024), { status: 200, headers: { "Content-Type": "image/jpeg" } }));
    const putMock = vi.fn(async () => {});
    const env: any = { R2_IMAGES: { put: putMock } };
    const proxy = await storeStockImageToR2(env, 2, "https://x/ok.jpg");
    expect(proxy).toContain("r2%3A%2F%2Fstock%2F2.");
    expect(putMock).toHaveBeenCalledOnce();
  });
});
