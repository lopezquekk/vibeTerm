import express from "express";
import path from "path";

export function createStaticRouter() {
  const distPath = path.resolve(__dirname,
    process.env.NODE_ENV === "production" ? "../../../dist" : "../../dist");
  return express.static(distPath, { index: "index.html" });
}
