#!/usr/bin/env bash
set -e

wasm-pack build --release --out-name gen -d pkg.web -t web gen
wasm-pack build --release --out-name gen -d pkg.nodejs -t nodejs gen
npm i
npm run build-web
