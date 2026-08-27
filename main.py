"""Render root compatibility entry point for the secure RetroStudio Python service."""

from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
import sys

SERVICE_DIR = Path(__file__).resolve().parent / "retrostudio-secure"
sys.path.insert(0, str(SERVICE_DIR))
spec = spec_from_file_location("retrostudio_secure_service", SERVICE_DIR / "main.py")
if spec is None or spec.loader is None:
    raise RuntimeError("RetroStudio service module could not be loaded.")
module = module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)
app = module.app
