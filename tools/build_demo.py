#!/usr/bin/env python3
"""Gera docs/index.html a partir de docs/src/ig-ao-vivo.html, injetando os blobs:
wasm do engine (compile antes com:
  RUSTFLAGS="-C panic=abort" cargo build --release --target wasm32-unknown-unknown --no-default-features)
+ as 44 instâncias MaScLib gzipadas + melhores conhecidos do benchmark.json."""
import base64, gzip, json, pathlib, re

root = pathlib.Path(__file__).resolve().parent.parent  # raiz do repo
html_path = root / "docs/src/ig-ao-vivo.html"
wasm_path = root / "engine/target/wasm32-unknown-unknown/release/ig_core.wasm"
masclib = root / "masclib"
bench = json.loads((root / "benchmark.json").read_text())

wasm_b64 = base64.b64encode(wasm_path.read_bytes()).decode()

insts = {p.stem: p.read_text() for p in sorted(masclib.glob("*.csv"))}
gpu_dir = root / "masclib-gpu"
if gpu_dir.is_dir():
    insts.update({p.stem: p.read_text() for p in sorted(gpu_dir.glob("*.csv"))})
gz = gzip.compress(json.dumps(insts).encode(), mtime=0)
insts_b64 = base64.b64encode(gz).decode()

best = {name: [row[0], row[1]] for name, row in bench.items()}  # [n_jobs, melhor conhecido]
for name, text in insts.items():
    if name not in best:
        n = sum(1 for l in text.splitlines() if l.startswith("MODE,"))
        best[name] = [n, None]

blob = (
    "/* IG-BLOBS-START (gerado por build_demo.py — não editar à mão) */\n"
    f'window.IG_WASM_B64 = "{wasm_b64}";\n'
    f'window.IG_MASCLIB_GZ_B64 = "{insts_b64}";\n'
    f"window.IG_BEST_KNOWN = {json.dumps(best)};\n"
    "/* IG-BLOBS-END */"
)

# Production artwork for the four explanatory lenses. The source keeps a valid
# empty object so it can still be parsed before a build; this step turns the
# public asset pack into data URIs and preserves the single-file contract.
theater_assets = {
    "factoryPlate": ("docs/assets/theater/factory-plate.jpg", "image/jpeg"),
    "factoryParts": ("docs/assets/theater/factory-parts.png", "image/png"),
    "factoryOperator": ("docs/assets/theater/factory-operator.webp", "image/webp"),
    "factorySetups": ("docs/assets/theater/factory-setups.png", "image/png"),
    "factoryRobot": ("docs/assets/theater/factory-robot.png", "image/png"),
    "aiPlate": ("docs/assets/theater/ai-plate.jpg", "image/jpeg"),
    "aiCartridges": ("docs/assets/theater/ai-cartridges.webp", "image/webp"),
    "aiArm": ("docs/assets/theater/ai-arm.webp", "image/webp"),
    "kitchenPlate": ("docs/assets/theater/kitchen-plate.jpg", "image/jpeg"),
    "kitchenTickets": ("docs/assets/theater/kitchen-tickets.webp", "image/webp"),
    "kitchenStaff": ("docs/assets/theater/kitchen-staff.webp", "image/webp"),
    "surgeryCards": ("docs/assets/theater/surgery-cards.webp", "image/webp"),
    "surgeryClinicians": ("docs/assets/theater/surgery-clinicians.webp", "image/webp"),
    "surgerySetups": ("docs/assets/theater/surgery-setups.webp", "image/webp"),
}
asset_data = {}
for key, (rel_path, mime) in theater_assets.items():
    raw = (root / rel_path).read_bytes()
    asset_data[key] = f"data:{mime};base64,{base64.b64encode(raw).decode()}"
asset_blob = (
    "/* IG-THEATER-ASSETS-START (gerado por build_demo.py — não editar à mão) */\n"
    f"window.IG_THEATER_ASSETS = {json.dumps(asset_data, separators=(',', ':'))};\n"
    "/* IG-THEATER-ASSETS-END */"
)

# The approved Studio remains an isolated application.  Embed its standalone
# build as compressed base64 so the home stays one offline file, but do not
# decode or execute it until the visitor opens the experiment section.
studio_path = root / "studio/dist/index.html"
studio_gz = gzip.compress(studio_path.read_bytes(), mtime=0)
studio_b64 = base64.b64encode(studio_gz).decode()
studio_blob = (
    "/* IG-STUDIO-PAYLOAD-START (gerado por build_demo.py — não editar à mão) */\n"
    f'window.IG_STUDIO_GZ_B64 = "{studio_b64}";\n'
    "/* IG-STUDIO-PAYLOAD-END */"
)

html = html_path.read_text()
html, n = re.subn(
    r"/\* IG-BLOBS-START.*?IG-BLOBS-END \*/", blob, html, flags=re.S
)
assert n == 1, "marcadores de blob não encontrados"
html, n = re.subn(
    r"/\* IG-THEATER-ASSETS-START.*?IG-THEATER-ASSETS-END \*/",
    asset_blob,
    html,
    flags=re.S,
)
assert n == 1, "marcadores dos assets do teatro não encontrados"
html, n = re.subn(
    r"/\* IG-STUDIO-PAYLOAD-START.*?IG-STUDIO-PAYLOAD-END \*/",
    studio_blob,
    html,
    flags=re.S,
)
assert n == 1, "marcadores do payload do Studio não encontrados"
html_path.write_text(html)

docs = root / "docs/index.html"
docs.write_text(
    '<!doctype html>\n<html lang="en" data-theme="light">\n'
    "<style>html,body{margin:0;padding:0}</style>\n" + html + "\n</html>\n"
)
print(
    f"ok: wasm {len(wasm_b64)//1024}KB b64, masclib {len(insts_b64)//1024}KB b64 "
    f"({len(insts)} instâncias), assets {sum(len(v) for v in asset_data.values())//1024}KB b64, "
    f"studio {len(studio_b64)//1024}KB b64, "
    f"html total {len(html)//1024}KB"
)
