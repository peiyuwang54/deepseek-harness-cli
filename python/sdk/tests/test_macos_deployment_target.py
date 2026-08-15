"""Tests for macOS runtime wheel deployment-target validation."""

from __future__ import annotations

import runpy
from pathlib import Path
from types import SimpleNamespace

import pytest


ROOT = Path(__file__).resolve().parents[3]
SCRIPT = ROOT / "scripts" / "check-macos-deployment-target.py"
checker = SimpleNamespace(**runpy.run_path(str(SCRIPT)))


def test_otool_parser_uses_the_newest_macho_slice() -> None:
    output = """
      cmd LC_BUILD_VERSION
    minos 11.0
      cmd LC_BUILD_VERSION
    minos 13.5
    """

    assert checker.parse_otool_deployment_target(output) == (13, 5)


def test_otool_parser_accepts_the_legacy_macos_load_command() -> None:
    output = """
      cmd LC_VERSION_MIN_MACOSX
  cmdsize 16
  version 10.13
      sdk 10.14.1
    """

    assert checker.parse_otool_deployment_target(output) == (10, 13)


def test_otool_parser_requires_a_deployment_target() -> None:
    with pytest.raises(ValueError, match="contains no LC_BUILD_VERSION or LC_VERSION_MIN_MACOSX"):
        checker.parse_otool_deployment_target("Load command 0\n")


def test_wheel_tag_rejects_a_newer_executable_target() -> None:
    checker.ensure_compatible(Path("runtime"), (13, 5), "macosx_14_0_arm64")

    with pytest.raises(RuntimeError, match="requires macOS 14.1"):
        checker.ensure_compatible(Path("spawn-helper"), (14, 1), "macosx_14_0_arm64")
