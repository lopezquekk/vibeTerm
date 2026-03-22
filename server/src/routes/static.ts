import express from "express";
import path from "path";

export function createStaticRouter() {
  // __dirname here is server/dist/routes/ — need 3 levels up to reach project dist/
  const distPath = path.resolve(__dirname, "../../../dist");
  return express.static(distPath, { index: "index.html" });
}
