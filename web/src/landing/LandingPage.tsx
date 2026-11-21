import "@fontsource-variable/geist"
import "@fontsource-variable/geist-mono"
import { useEffect } from "react"
import "./landing.css"
import { Hero } from "./Hero"
import { Nav } from "./Nav"
import { Capabilities, Final, Footer, Gap, Hardware, Journey, Product, Security, Start } from "./Sections"

export default function LandingPage() {
  useEffect(() => {
    const prev = document.title
    document.title = "Flashlink — From AI to actual hardware"
    const root = document.documentElement
    const bg = root.style.backgroundColor
    root.style.backgroundColor = "#08090a"
    root.style.scrollBehavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"
    return () => { document.title = prev; root.style.backgroundColor = bg; root.style.scrollBehavior = "" }
  }, [])
  return (
    <div className="lp">
      <Nav />
      <main>
        <Hero />
        <Gap />
        <Journey />
        <Product />
        <Capabilities />
        <Hardware />
        <Security />
        <Start />
        <Final />
      </main>
      <Footer />
    </div>
  )
}
