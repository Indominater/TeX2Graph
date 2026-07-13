import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const htmlFiles = ["index.html", "proof-dependency-map.html"];

function extractDownloadFunction(html) {
  const start = html.indexOf("    function download(");
  const end = html.indexOf("\n    function supportsFileSystemAccess(", start);
  assert.notEqual(start, -1, "download() should exist");
  assert.notEqual(end, -1, "download() should have a recognizable boundary");
  return html.slice(start, end).trim();
}

for (const htmlFile of htmlFiles) {
  test(`${htmlFile} keeps its Blob URL alive after starting a download`, async () => {
    const html = await readFile(new URL(`../${htmlFile}`, import.meta.url), "utf8");
    const downloadSource = extractDownloadFunction(html);
    const events = [];
    let cleanup;

    const context = {
      Blob: class Blob {
        constructor(parts, options) {
          events.push(["blob", parts, options]);
        }
      },
      URL: {
        createObjectURL() {
          events.push(["create"]);
          return "blob:test-export";
        },
        revokeObjectURL(url) {
          events.push(["revoke", url]);
        }
      },
      document: {
        body: {
          appendChild() {
            events.push(["append"]);
          }
        },
        createElement(tagName) {
          assert.equal(tagName, "a");
          return {
            click() {
              events.push(["click"]);
            },
            remove() {
              events.push(["remove"]);
            }
          };
        }
      },
      setTimeout(callback, delay) {
        events.push(["schedule-cleanup", delay]);
        cleanup = callback;
      }
    };

    vm.runInNewContext(
      `${downloadSource}\ndownload("graph.html", "text/html;charset=utf-8", "<html></html>");`,
      context
    );

    const eventNamesBeforeCleanup = events.map(([name]) => name);
    assert.deepEqual(eventNamesBeforeCleanup, [
      "blob",
      "create",
      "append",
      "click",
      "remove",
      "schedule-cleanup"
    ]);
    assert.equal(events.at(-1)[1], 60_000);
    assert.equal(typeof cleanup, "function");

    cleanup();
    assert.deepEqual(events.at(-1), ["revoke", "blob:test-export"]);
  });
}
