"""Test configuration: make the api/ modules importable from the repo root."""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "api"))
