import assert from "node:assert/strict";
import test from "node:test";
import { parseSupportedLink } from "../src/main/adapters/platform.js";

test("parses a Bilibili URL from sharing text", () => {
  const parsed = parseSupportedLink("分享视频 https://b23.tv/AbCd12 复制打开");
  assert.equal(parsed.platform, "bilibili");
  assert.equal(parsed.url, "https://b23.tv/AbCd12");
});

test("rejects a Douyin sharing URL", () => {
  assert.throws(
    () => parseSupportedLink("看看这个：https://v.douyin.com/abc123/，很好听"),
    /目前只支持哔哩哔哩链接/
  );
});

test("rejects unsupported hosts that only contain a supported name", () => {
  assert.throws(
    () => parseSupportedLink("https://bilibili.com.evil.example/video/1"),
    /目前只支持哔哩哔哩链接/
  );
});

test("rejects text without a URL", () => {
  assert.throws(() => parseSupportedLink("BV1xx411c7mD"), /没有找到有效网址/);
});
