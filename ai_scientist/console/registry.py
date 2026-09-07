"""ModuleRegistry — каталог модулей (search / show / use).

Автодискавери: сканирует `ai_scientist.console.modules.*`, импортирует каждый
модуль и читает его `MANIFEST`. Имя модуля — путь без `.py`, напр. `pipeline/run`.

Модуль считается «настоящим», только если экспортирует `MANIFEST` (dict) с
полем `type` и (для исполнения) функцию `run`. Всё остальное пропускается.
"""
import importlib
import os
import pkgutil

from ai_scientist.console import modules as _pkg

MODULE_TYPES = ("auxiliary", "generate", "pipeline", "review", "report")


class Module:
    def __init__(self, name, manifest):
        self.name = name
        self.type = manifest.get("type", "auxiliary")
        self.description = manifest.get("description", "")
        self.options = dict(manifest.get("options", {}))
        self.manifest = manifest
        self._run = None
        self._loaded = False

    def load(self):
        if self._loaded:
            return self
        mod_name = "ai_scientist.console.modules." + self.name.replace("/", ".")
        mod = importlib.import_module(mod_name)
        self._run = getattr(mod, "run", None)
        self.manifest = getattr(mod, "MANIFEST", self.manifest) or {}
        self.description = self.manifest.get("description", self.description)
        self.options = dict(self.manifest.get("options", self.options))
        self.type = self.manifest.get("type", self.type)
        self._loaded = True
        return self

    def run(self, options, job, emit, stop_event=None):
        self.load()
        if self._run is None:
            raise RuntimeError(f"модуль {self.name}: нет функции run()")
        return self._run(options, job, emit, stop_event)


class ModuleRegistry:
    def __init__(self):
        self._modules = {}
        self.scan()

    def scan(self):
        self._modules = {}
        pkg_dir = os.path.dirname(_pkg.__file__)
        prefix = _pkg.__name__ + "."
        for _importer, modname, ispkg in pkgutil.walk_packages([pkg_dir], prefix=prefix):
            if ispkg:
                continue
            try:
                mod = importlib.import_module(modname)
            except Exception:
                continue
            manifest = getattr(mod, "MANIFEST", None)
            if not isinstance(manifest, dict) or not manifest.get("type"):
                continue
            rel = modname[len(prefix):].replace(".", "/")
            self._modules[rel] = Module(rel, manifest)

    def list(self):
        return sorted(self._modules.values(), key=lambda m: m.name)

    def search(self, query):
        q = (query or "").lower()
        return [m for m in self.list()
                if q in m.name.lower() or q in m.description.lower() or q in m.type]

    def get(self, name):
        return self._modules.get(name)

    def __len__(self):
        return len(self._modules)
