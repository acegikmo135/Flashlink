export const REPO = "https://github.com/acegikmo135/Flashlink"
export const DOCS = `${REPO}/blob/main/docs/setup.md`
export const DOCS_ARCH = `${REPO}/blob/main/docs/architecture.md`
export const DOCS_BOARDS = `${REPO}/blob/main/docs/supported-boards.md`
export const DOCS_SECURITY = `${REPO}/blob/main/docs/security.md`
export const README_START = `${REPO}#get-started`

export const BOARDS = [
  { name: "ESP32", sub: "DevKit · WROOM-32", tier: 1, note: "Flashed and verified on a real board, with a full bootloader-to-app image." },
  { name: "Arduino Uno", sub: "ATmega328P", tier: 2, note: "Implemented, with automatic detection of the exact board. Awaiting hardware confirmation." },
  { name: "Arduino Nano", sub: "ATmega328P", tier: 2, note: "Implemented, including the old-bootloader variant. Awaiting hardware confirmation." },
  { name: "STM32", sub: "Blue Pill · F103", tier: 3, note: "Command construction is unit-tested only. Needs an ST-Link." },
]
export const TIER = ["", "Verified on real hardware", "Implemented, awaiting validation", "Unit-tested only"]

export const HASH_SENT = "9f2c41b7e08a5d13c6f4a0b92e7d58c3a1046fb8d2e9753c0a4b61f8e3d7295c"
