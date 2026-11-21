import { readFileSync, writeFileSync } from "node:fs"
import { Resvg } from "@resvg/resvg-js"
const keys = ["trace", "pinf", "split", "flbridge", "signal"]
const nest = (f, x, y, w, h) => { const s = readFileSync(f, "utf8"); const vb = /viewBox="([^"]+)"/.exec(s)[1]; return `<svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="${vb}" preserveAspectRatio="xMidYMid meet">${s.replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "")}</svg>` }
let body = ""
keys.forEach((k, i) => {
  const y = i * 230
  body += `<rect x="0" y="${y}" width="900" height="230" fill="#F4F6F8"/><rect x="900" y="${y}" width="900" height="230" fill="#07090D"/>`
  body += nest(`out/${k}/flashlink-${k}-primary.svg`, 30, y + 40, 520, 150)
  body += nest(`out/${k}/flashlink-${k}-stacked.svg`, 640, y + 15, 200, 200)
  body += nest(`out/${k}/flashlink-${k}-primary-on-dark.svg`, 930, y + 40, 520, 150)
  body += nest(`out/${k}/flashlink-${k}-stacked-on-dark.svg`, 1560, y + 15, 200, 200)
})
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1800 1150">${body}</svg>`
writeFileSync(process.argv[2], new Resvg(svg, { fitTo: { mode: "width", value: 1800 } }).render().asPng())
