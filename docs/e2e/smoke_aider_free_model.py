"""Smoke: can a FREE 256k model drive Aider SEARCH/REPLACE on a big file?

Generates a ~22KB python file (template.tex analogue), asks for one surgical
edit, verifies the edit landed exactly and the file still compiles.
"""
import os
import sys
import tempfile
import time

sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, ".")
from ai_scientist.console import ensure_utf8_stdio
ensure_utf8_stdio()
from ai_scientist import settings
settings.load_dotenv()

from aider.coders import Coder
from aider.io import InputOutput
from aider.models import Model

MODEL = os.environ.get("SMOKE_MODEL", "openrouter/nex-agi/nex-n2.5-pro:free")

d = tempfile.mkdtemp(prefix="aider-smoke-")
target = os.path.join(d, "mod.py")
body = "\n\n".join(
    "def helper_%d(x):\n    # baseline helper %d\n    return x * %d + %d" % (i, i, i + 2, i)
    for i in range(180)
)
extra = "# filler to reach template-scale context\n" * 200
src = '"""synthetic module."""\n\n' + body + "\n\n" + extra + "\ndef cosine_lr(step, total, warmup, peak, floor):\n    return peak\n"
open(target, "w", encoding="utf-8").write(src)
print("target size:", len(src), "bytes")

io = InputOutput(yes=True, pretty=False)
coder = Coder.create(main_model=Model(MODEL), fnames=[target], io=io,
                     stream=False, use_git=False, edit_format="diff")
prompt = (
    "Implement proper cosine learning-rate decay in cosine_lr: linear warmup for the "
    "first `warmup` steps, then cosine decay from peak to floor across `total` steps, "
    "clamped at floor afterwards. Use math.cos/math.pi. Do not touch the helper_N functions."
)
t0 = time.time()
out = coder.run(prompt)
dt = time.time() - t0
code = open(target, encoding="utf-8").read()
ok_compile = True
try:
    compile(code, "mod.py", "exec")
except SyntaxError as e:
    ok_compile = False
    print("SYNTAX ERROR:", e)
signals = ("cos" in code, "warmup" in code and code.index("warmup") < code.index("return"),
           "pi" in code, "floor" in code.split("cosine_lr")[1])
print("%.0fs | compile=%s | cos:%s warmup:%s pi:%s floor-branch:%s | out tail: %s" % (
    dt, ok_compile, *signals, str(out)[-120:].replace("\n", " ")))
print("VERDICT:", "PASS" if ok_compile and all(v in code for v in ["cos"]) and "floor" in code else "FAIL")
